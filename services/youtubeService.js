const WATCH_URL = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`;
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function isValidVideoId(id) {
  return typeof id === 'string' && VIDEO_ID_RE.test(id);
}

export function extractPlayerResponse(html) {
  const marker = 'ytInitialPlayerResponse';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const braceStart = html.indexOf('{', idx);
  if (braceStart === -1) return null;

  let depth = 0;
  let end = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return null;

  try {
    return JSON.parse(html.slice(braceStart, end));
  } catch (e) {
    return null;
  }
}

function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchTranscriptText(captionTracks, maxChars) {
  if (!captionTracks || captionTracks.length === 0) return null;

  const track = captionTracks.find((t) => (t.languageCode || '').startsWith('en')) || captionTracks[0];
  const url = `${track.baseUrl}&fmt=json3`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  const lines = [];
  for (const event of data.events || []) {
    if (!event.segs) continue;
    const text = event.segs.map((seg) => seg.utf8).join('');
    if (text.trim()) {
      lines.push({ start: (event.tStartMs || 0) / 1000, text: text.trim() });
    }
  }

  const fullText = lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
  return {
    language: track.languageCode,
    text: fullText.slice(0, maxChars),
    segments: lines,
  };
}

export async function fetchVideoData(videoId, { maxTranscriptChars } = {}) {
  const res = await fetch(WATCH_URL(videoId), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`Could not fetch YouTube page for ${videoId} (HTTP ${res.status}).`);
  }
  const html = await res.text();

  const playerResponse = extractPlayerResponse(html);
  const videoDetails = playerResponse?.videoDetails;

  const title = videoDetails?.title || extractMeta(html, 'og:title') || null;
  const channel = videoDetails?.author || null;
  const description = videoDetails?.shortDescription || extractMeta(html, 'og:description') || '';
  const lengthSeconds = videoDetails?.lengthSeconds ? Number(videoDetails.lengthSeconds) : null;

  if (!title) {
    throw new Error(`Could not read video metadata for ${videoId} - the page may be unavailable, private, or region-locked.`);
  }

  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
  const transcript = await fetchTranscriptText(captionTracks, maxTranscriptChars || 20000).catch(() => null);

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    channel,
    description: description.slice(0, 4000),
    lengthSeconds,
    hasTranscript: !!transcript && transcript.text.length > 0,
    transcript: transcript?.text || null,
    transcriptLanguage: transcript?.language || null,
    transcriptSegments: transcript?.segments || [],
  };
}
