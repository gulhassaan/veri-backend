import { Router } from 'express';
import { config } from '../config/config.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { isValidVideoId, fetchVideoData } from '../services/youtubeService.js';
import { runAnalysis } from '../services/analysisService.js';
import { getAnalysis, upsertAnalysis, addFeedback, isStale } from '../store/analysisStore.js';

const router = Router();
const inFlight = new Set();

function publicRecord(record) {
  if (!record) return null;
  return {
    videoId: record.videoId,
    status: record.status,
    analysisVersion: record.analysisVersion || config.analysisVersion,
    requestedAt: record.requestedAt || null,
    analyzedAt: record.analyzedAt || null,
    videoMeta: record.videoMeta || null,
    result: record.status === 'completed' ? record.result : null,
    message: record.status === 'unavailable' || record.status === 'error' ? record.errorMessage : null,
  };
}

async function runAnalysisJob(videoId) {
  if (inFlight.has(videoId)) return;
  inFlight.add(videoId);

  try {
    let videoData;
    try {
      videoData = await fetchVideoData(videoId, { maxTranscriptChars: config.maxTranscriptChars });
    } catch (err) {
      console.error(`[youtube] fetch failed for ${videoId}:`, err.message);
      await upsertAnalysis(videoId, {
        status: 'error',
        errorMessage: 'Could not load this video\'s page or metadata. It may be private, deleted, or region-locked.',
        analyzedAt: new Date().toISOString(),
      });
      return;
    }

    if (!videoData.hasTranscript && (!videoData.description || videoData.description.trim().length < 40)) {
      await upsertAnalysis(videoId, {
        status: 'unavailable',
        errorMessage: 'Not enough evidence to score - this video has no captions and only a minimal description.',
        analyzedAt: new Date().toISOString(),
        videoMeta: { title: videoData.title, channel: videoData.channel, url: videoData.url },
      });
      return;
    }

    let result;
    try {
      result = await runAnalysis(videoData);
    } catch (err) {
      await upsertAnalysis(videoId, {
        status: 'error',
        errorMessage: 'Analysis failed. Please try again.',
        analyzedAt: new Date().toISOString(),
        videoMeta: { title: videoData.title, channel: videoData.channel, url: videoData.url },
      });
      console.error(`[analysis] failed for ${videoId}:`, err.message);
      return;
    }

    await upsertAnalysis(videoId, {
      status: 'completed',
      analysisVersion: config.analysisVersion,
      analyzedAt: new Date().toISOString(),
      videoMeta: { title: videoData.title, channel: videoData.channel, url: videoData.url },
      result,
      errorMessage: null,
    });
  } finally {
    inFlight.delete(videoId);
  }
}

function requireValidVideoId(req, res, next) {
  if (!isValidVideoId(req.params.videoId)) {
    return next(new AppError('Invalid video ID.', 400));
  }
  next();
}

router.get('/:videoId', requireValidVideoId, asyncHandler(async (req, res) => {
  const record = await getAnalysis(req.params.videoId);
  if (!record) {
    return res.status(404).json({ status: 'not_requested', message: 'No analysis exists yet for this video.' });
  }
  res.json(publicRecord(record));
}));

router.post('/:videoId/analyze', requireValidVideoId, asyncHandler(async (req, res) => {
  const videoId = req.params.videoId;
  const existing = await getAnalysis(videoId);

  if (existing?.status === 'processing') {
    return res.status(202).json(publicRecord(existing));
  }
  if (existing?.status === 'completed' && !(await isStale(existing))) {
    return res.status(200).json(publicRecord(existing));
  }

  const record = await upsertAnalysis(videoId, {
    status: 'processing',
    requestedAt: new Date().toISOString(),
    errorMessage: null,
  });

  runAnalysisJob(videoId).catch((err) => console.error('[analysis] unhandled job error:', err));

  res.status(202).json(publicRecord(record));
}));

router.post('/:videoId/feedback', requireValidVideoId, asyncHandler(async (req, res) => {
  const { message, category } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new AppError('Feedback message is required.', 400);
  }
  const entry = await addFeedback({ videoId: req.params.videoId, message, category });
  res.status(201).json({ ok: true, id: entry.id });
}));

export default router;
