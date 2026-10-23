import { config } from '../config/config.js';
import { searchMany } from './searchService.js';

const API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const VALID_VERDICTS = new Set([
  'Supported',
  'Partially Supported',
  'Insufficient Evidence',
  'Contradicted',
  'Misleading Context',
  'Unverifiable',
]);

const EXTRACTION_PROMPT = `You are VERI, a neutral video-claim extraction assistant. You are given a YouTube video's title, channel, description, and (when available) its transcript with timestamps.

Identify the video's distinct, important, checkable factual claims (not opinions, jokes, or pure subjective statements). Pick at most ${config.maxClaimsPerVideo} of the most significant/central claims. Do not invent claims that weren't actually stated.

IMPORTANT: educational, explanatory, tutorial, revision, review and news videos DO make checkable claims even when they sound general. Definitions, explanations of how something works, stated facts, figures, dates, named studies, and "X causes Y" or "X is Y" teaching points all count as claims. For such videos, extract the 3-6 most central teaching points as claims. Only return an empty array for content that is purely personal opinion, entertainment, or music with no factual statements at all.

For each claim, give:
- The claim as stated or closely paraphrased.
- Its approximate timestamp in seconds from the start, if determinable from the transcript (null otherwise).
- Its domain (e.g. health, statistical, historical, product, scientific, general).
- 1-2 specific, well-formed web search queries that would help find authoritative evidence for or against this exact claim (not generic topic queries - make them specific enough to find real evidence, e.g. include the specific number/entity/study subject from the claim itself).

If there is no transcript, derive the claims from what the title and description clearly state about the topic; return an empty claims array only if they state nothing factual at all.

Respond with ONLY a single JSON object (no markdown fences, no prose before or after):
{
  "claims": [
    {
      "claim": "<string>",
      "timestampSeconds": <number or null>,
      "domain": "<string>",
      "searchQueries": ["<string>", "<string>"]
    }
  ]
}`;

const VERIFICATION_PROMPT = `You are VERI, a rigorous, neutral video-credibility analyst. You are given a YouTube video's basic info and a list of claims it makes, each with search evidence that was already retrieved for you (title, URL, and extracted page content for each result).

CORE PRINCIPLE: You are not an all-knowing truth detector. Every verdict must be traceable to the evidence actually provided below - do not use outside knowledge to override what the evidence shows, but you may use general knowledge to help interpret ambiguous or technical evidence. If the evidence for a claim is empty, thin, or irrelevant, that is a normal, expected outcome - use "Insufficient Evidence" or "Unverifiable" rather than guessing. Never fabricate a source that isn't in the evidence you were given.

For each claim, using ONLY the evidence provided for it:

Verdict - EXACTLY one of these six values:
- "Supported": the provided evidence supports the claim as stated.
- "Partially Supported": a meaningful part is supported, but the claim as worded is broader or stronger than the evidence justifies.
- "Insufficient Evidence": the evidence is too weak, limited, or conflicting to establish the claim either way (including "no evidence was found").
- "Contradicted": the provided evidence conflicts with the claim.
- "Misleading Context": the underlying fact may be technically correct per the evidence, but material context is missing that changes the impression it creates.
- "Unverifiable": not objectively checkable by nature.

Also give per claim:
- evidenceStrength (0-100): how strong is the evidence itself (independent of which way it points). Be strict and use the full range:
    90-100 ONLY when a primary, official or peer-reviewed source directly and explicitly confirms the exact claim;
    70-89 when reputable sources clearly support it but not as a primary source or not word for word;
    50-69 for revision guides, tutorials, blogs, forums or indirect/partial support;
    below 50 when evidence is thin, off-topic, conflicting, or only restates the claim.
  Do NOT give 100 casually. Most claims should land between 55 and 90.
- sourceQuality (0-100): authority, independence and relevance of the sources actually provided. Official/academic sources 80-95, reputable news 65-80, general websites or study guides 45-65, unknown or commercial pages below 45.
- A short (1-3 sentence) neutral explanation.
- sources: for each source you actually used from what was provided, give title, url (must be one of the provided URLs, never invented), publisher (if determinable), credibility tier ("official/government", "academic/research", "reputable secondary reporting", or "low credibility / unverified"), and a 1-sentence paraphrase of what it shows (never a verbatim quote longer than a few words).

Then, reasoned holistically across all claims (not a simple average, weight by how central each claim is to the video's main point):
Be calibrated, not generous: an ordinary, well-supported video should score around 65-80 overall; scores above 90 are rare and need strong primary sources for every key claim.
- dimensions.accuracy (0-100): are the important claims supported by the evidence found?
- dimensions.evidence (0-100): how strong is the evidence base overall?
- dimensions.sources (0-100): how authoritative/independent/relevant were the sources used overall?
- dimensions.context (0-100): are facts represented with material context intact (vs cherry-picked/stripped of caveats), based on what the evidence shows?
Claims verdicted "Unverifiable" should generally be excluded from dragging dimension scores down - that's what evidence coverage below is for.

Supporting indicators:
- evidenceCoveragePct (0-100): % of claims for which real, relevant evidence was found (i.e. not "Unverifiable" and not "Insufficient Evidence" purely because nothing was found).
- unverifiableClaimsPct (0-100): % of claims that are inherently not verifiable.
- scientificSupport (0-100 or null): only if the video makes scientific/medical claims, else null.
- commercialContext: { "present": boolean, "note": "<short neutral note>" } - only true with a real signal (sponsorship, affiliate links, the video promoting a product it also makes claims about).

Finally, a 2-4 sentence neutral summary of the video's factual reliability based on this analysis. Do not speculate about the creator's intent, honesty, or character.

Respond with ONLY a single JSON object (no markdown fences, no prose before or after) matching exactly this shape:

{
  "summary": "<string>",
  "dimensions": { "accuracy": <0-100>, "evidence": <0-100>, "sources": <0-100>, "context": <0-100> },
  "evidenceCoveragePct": <0-100>,
  "unverifiableClaimsPct": <0-100>,
  "scientificSupport": <0-100 or null>,
  "commercialContext": { "present": <boolean>, "note": "<string>" },
  "claims": [
    {
      "claim": "<string, copy from input>",
      "timestampSeconds": <number or null, copy from input>,
      "domain": "<string, copy from input>",
      "verdict": "Supported" | "Partially Supported" | "Insufficient Evidence" | "Contradicted" | "Misleading Context" | "Unverifiable",
      "evidenceStrength": <0-100>,
      "sourceQuality": <0-100>,
      "explanation": "<string>",
      "sources": [ { "title": "<string>", "url": "<string>", "publisher": "<string or null>", "credibility": "official/government" | "academic/research" | "reputable secondary reporting" | "low credibility / unverified", "note": "<string>" } ]
    }
  ]
}`;

function buildVideoHeader(videoData) {
  const parts = [
    `Title: ${videoData.title}`,
    `Channel: ${videoData.channel || 'Unknown'}`,
    `URL: ${videoData.url}`,
    '',
    `Description:\n${videoData.description || '(none provided)'}`,
    '',
  ];
  if (videoData.hasTranscript) {
    const withTimestamps = (videoData.transcriptSegments || [])
      .map((s) => `[${Math.floor(s.start)}s] ${s.text}`)
      .join(' ')
      .slice(0, config.maxTranscriptChars);
    parts.push(`Transcript with approximate timestamps (${videoData.transcriptLanguage || 'unknown language'}):\n${withTimestamps || videoData.transcript}`);
  } else {
    parts.push('Transcript: NOT AVAILABLE for this video. Base analysis only on the title and description.');
  }
  return parts.join('\n');
}

function buildEvidenceBlock(claimsWithEvidence) {
  return claimsWithEvidence
    .map((c, i) => {
      const evidenceText = c.evidence.length
        ? c.evidence.map((e) => `  - [${e.title}](${e.url}): ${e.content}`).join('\n')
        : '  (No search results found for this claim.)';
      return `Claim ${i + 1}: "${c.claim}" (domain: ${c.domain}, timestamp: ${c.timestampSeconds ?? 'unknown'}s)\nEvidence found:\n${evidenceText}`;
    })
    .join('\n\n');
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function stripCodeFences(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function parseJsonLoosely(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (e2) {
      return null;
    }
  }
}

// Free-tier quota is tracked per model, so if one is exhausted (429) or not
// available to this key (404) we move on to the next.
// Fast lite models first (this is structured extraction, speed matters more than depth).
const MODEL_CHAIN = [...new Set(['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', config.model])];

// Remember the last model that worked so later calls skip ones that are slow or out of quota.
let preferredModelIdx = 0;

async function callGemini(prompt, userContent, attempt = 1, useThinkingOff = true, modelIdx = preferredModelIdx) {
  if (!config.geminiApiKey) {
    throw new Error('Server is not configured with a GEMINI_API_KEY.');
  }

  let response;
  try {
  response = await fetch(`${API_URL_BASE}/${MODEL_CHAIN[modelIdx]}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(40000),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.geminiApiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        // Skip the slow "thinking" phase - this is structured extraction, not reasoning-heavy.
        ...(useThinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
  });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      if (modelIdx < MODEL_CHAIN.length - 1) {
        console.warn(`[gemini] ${MODEL_CHAIN[modelIdx]} timed out, trying ${MODEL_CHAIN[modelIdx + 1]}...`);
        return callGemini(prompt, userContent, 1, true, modelIdx + 1);
      }
      throw new Error('The analysis model took too long to respond. Please try again.');
    }
    throw err;
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || '';
    } catch (e) {
      // ignore
    }
    if (response.status === 400 && useThinkingOff) {
      return callGemini(prompt, userContent, attempt, false, modelIdx);
    }
    if (response.status === 503 && attempt < 3) {
      const delayMs = attempt * 4000;
      console.warn(`[gemini] 503 (overloaded), retrying in ${delayMs}ms (attempt ${attempt + 1}/3)...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return callGemini(prompt, userContent, attempt + 1, useThinkingOff, modelIdx);
    }
    if ((response.status === 429 || response.status === 404) && modelIdx < MODEL_CHAIN.length - 1) {
      console.warn(`[gemini] ${MODEL_CHAIN[modelIdx]} returned ${response.status}, trying ${MODEL_CHAIN[modelIdx + 1]}...`);
      return callGemini(prompt, userContent, 1, true, modelIdx + 1);
    }
    if (response.status === 429) {
      throw new Error(`Rate limited by the Gemini API free tier (429). ${detail || 'Wait a moment and try again.'}`);
    }
    if (response.status === 503) {
      throw new Error('Gemini is currently experiencing high demand and stayed unavailable after retrying. Please try again in a minute or two.');
    }
    throw new Error(`Analysis provider error (${response.status}). ${detail}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (!candidate) {
    const blockReason = data.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Request was blocked by the provider (${blockReason}).` : 'Analysis provider returned no result.');
  }
  if (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
    throw new Error(`Analysis stopped unexpectedly (${candidate.finishReason}).`);
  }

  const textParts = (candidate.content?.parts || []).filter((p) => typeof p.text === 'string').map((p) => p.text);
  const rawText = textParts.join('\n').trim();
  if (!rawText) throw new Error('Analysis provider returned no result text.');

  preferredModelIdx = modelIdx;
  const parsed = parseJsonLoosely(stripCodeFences(rawText));
  if (!parsed) throw new Error('Could not parse the analysis result.');
  return parsed;
}

async function callFallbackProvider(prompt, userContent) {
  const res = await fetch(`${config.fallbackBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.fallbackApiKey}` },
    body: JSON.stringify({
      model: config.fallbackModel,
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch (e) { /* ignore */ }
    throw new Error(`Backup provider error (${res.status}). ${detail}`.trim());
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const parsed = parseJsonLoosely(stripCodeFences(text));
  if (!parsed) throw new Error('Could not parse the backup provider result.');
  return parsed;
}

// Gemini first; if it is exhausted, slow or down, use the backup provider (if configured).
let geminiCooldownUntil = 0;
async function callModel(prompt, userContent) {
  if (config.fallbackApiKey && Date.now() < geminiCooldownUntil) {
    return callFallbackProvider(prompt, userContent);
  }
  try {
    return await callGemini(prompt, userContent);
  } catch (err) {
    if (!config.fallbackApiKey) throw err;
    geminiCooldownUntil = Date.now() + 2 * 60 * 1000; // skip Gemini for 2 min after it fails
    console.warn(`[analysis] Gemini failed (${err.message}). Switching to backup provider ${config.fallbackModel}.`);
    return callFallbackProvider(prompt, userContent);
  }
}

export function computeOverallScore(dimensions, weights = config.scoringWeights) {
  const a = clampInt(dimensions.accuracy, 0, 100, 0);
  const e = clampInt(dimensions.evidence, 0, 100, 0);
  const s = clampInt(dimensions.sources, 0, 100, 0);
  const c = clampInt(dimensions.context, 0, 100, 0);
  const overall = a * weights.accuracy + e * weights.evidence + s * weights.sources + c * weights.context;
  return Math.round(overall);
}

export function ratingLabel(score) {
  if (score >= 75) return 'High';
  if (score >= 45) return 'Moderate';
  return 'Low';
}

const STRONG_TIERS = new Set(['official/government', 'academic/research']);

function calibrateClaim(claim) {
  const tiers = claim.sources.map((x) => x.credibility);
  let cap = 100;
  if (claim.sources.length === 0) cap = 40;
  else if (!tiers.some((t) => STRONG_TIERS.has(t))) cap = tiers.some((t) => t === 'reputable secondary reporting') ? 82 : 55;
  else if (claim.sources.length === 1) cap = 92;
  claim.evidenceStrength = Math.min(claim.evidenceStrength, cap);
  claim.sourceQuality = Math.min(claim.sourceQuality, cap);
  return claim;
}

function normalizeClaim(c) {
  return {
    claim: String(c.claim || '').slice(0, 500),
    timestampSeconds: c.timestampSeconds !== null && c.timestampSeconds !== undefined && Number.isFinite(Number(c.timestampSeconds)) && Number(c.timestampSeconds) > 0 ? Math.round(Number(c.timestampSeconds)) : null,
    domain: String(c.domain || 'general').slice(0, 60),
    verdict: VALID_VERDICTS.has(c.verdict) ? c.verdict : 'Unverifiable',
    evidenceStrength: clampInt(c.evidenceStrength, 0, 100, 0),
    sourceQuality: clampInt(c.sourceQuality, 0, 100, 0),
    explanation: String(c.explanation || '').slice(0, 800),
    sources: Array.isArray(c.sources)
      ? c.sources.slice(0, 6).map((s) => ({
          title: String(s.title || 'Source').slice(0, 200),
          url: typeof s.url === 'string' && /^https?:\/\//.test(s.url) ? s.url : null,
          publisher: s.publisher ? String(s.publisher).slice(0, 120) : null,
          credibility: s.credibility || 'low credibility / unverified',
          note: String(s.note || '').slice(0, 300),
        }))
      : [],
  };
}

function normalizeResult(parsed) {
  const claims = Array.isArray(parsed.claims) ? parsed.claims.map((c) => calibrateClaim(normalizeClaim(c))) : [];

  if (claims.length === 0) {
    return {
      summary: String(parsed.summary || 'No checkable factual claims were identified for this video.').slice(0, 1500),
      overallScore: null,
      ratingLabel: 'Not enough claims to score',
      dimensions: { accuracy: 0, evidence: 0, sources: 0, context: 0 },
      evidenceCoveragePct: 0,
      unverifiableClaimsPct: 0,
      scientificSupport: null,
      commercialContext: { present: false, note: '' },
      claimCount: 0,
      claims: [],
    };
  }

  const dimensions = {
    accuracy: clampInt(parsed.dimensions?.accuracy, 0, 100, 0),
    evidence: clampInt(parsed.dimensions?.evidence, 0, 100, 0),
    sources: clampInt(parsed.dimensions?.sources, 0, 100, 0),
    context: clampInt(parsed.dimensions?.context, 0, 100, 0),
  };
  // Overall dimensions cannot be rosier than the per-claim evidence they rest on.
  const avg = (key) => Math.round(claims.reduce((sum, c) => sum + c[key], 0) / claims.length);
  dimensions.accuracy = Math.min(dimensions.accuracy, 96);
  dimensions.context = Math.min(dimensions.context, 96);
  dimensions.evidence = Math.min(dimensions.evidence, avg('evidenceStrength') + 8);
  dimensions.sources = Math.min(dimensions.sources, avg('sourceQuality') + 8);
  const overallScore = Math.min(computeOverallScore(dimensions), 95);

  const scientificSupportRaw = parsed.scientificSupport;
  const scientificSupport =
    scientificSupportRaw === null || scientificSupportRaw === undefined
      ? null
      : clampInt(scientificSupportRaw, 0, 100, null);

  return {
    summary: String(parsed.summary || '').slice(0, 1500),
    overallScore,
    ratingLabel: ratingLabel(overallScore),
    dimensions,
    evidenceCoveragePct: clampInt(parsed.evidenceCoveragePct, 0, 100, 0),
    unverifiableClaimsPct: clampInt(parsed.unverifiableClaimsPct, 0, 100, 0),
    scientificSupport,
    commercialContext: {
      present: !!parsed.commercialContext?.present,
      note: String(parsed.commercialContext?.note || '').slice(0, 300),
    },
    claimCount: claims.length,
    claims,
  };
}

export async function runAnalysis(videoData) {
  const t0 = Date.now();
  const lap = (label) => console.log(`[analysis] ${videoData.videoId} ${label} (+${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  const videoHeader = buildVideoHeader(videoData);

  const extraction = await callModel(EXTRACTION_PROMPT, videoHeader);
  lap('claims extracted');
  let rawClaims = Array.isArray(extraction.claims) ? extraction.claims.slice(0, config.maxClaimsPerVideo) : [];

  // Fallback so general-content videos still get a reference-based score:
  // check the video's overall subject as one claim against trusted sources.
  if (rawClaims.length === 0 && videoData.title) {
    rawClaims = [{
      claim: `The video's central subject, "${videoData.title}", is presented accurately.`,
      timestampSeconds: null,
      domain: 'general',
      searchQueries: [videoData.title, `${videoData.title} explained overview`],
    }];
  }

  if (rawClaims.length === 0) {
    return normalizeResult({
      summary: 'No checkable factual claims could be identified for this video (likely because it is conversational/opinion-based rather than making concrete factual statements, or because no transcript was available).',
      claims: [],
    });
  }

  const claimsWithEvidence = await Promise.all(
    rawClaims.map(async (c) => {
      const evidence = await searchMany(c.searchQueries || [], {
        apiKey: config.tavilyApiKey,
        maxQueries: config.maxSearchQueriesPerClaim,
        maxResultsPerQuery: config.maxResultsPerQuery,
      });
      return {
        claim: c.claim,
        timestampSeconds: c.timestampSeconds ?? null,
        domain: c.domain || 'general',
        evidence,
      };
    })
  );

  lap('evidence retrieved');
  const evidenceBlock = buildEvidenceBlock(claimsWithEvidence);
  const verificationInput = `${videoHeader}\n\n---\n\nClaims and retrieved evidence:\n\n${evidenceBlock}`;
  const verification = await callModel(VERIFICATION_PROMPT, verificationInput);
  lap('verification done');

  return normalizeResult(verification);
}
