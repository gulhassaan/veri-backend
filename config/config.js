import 'dotenv/config';
import { fileURLToPath } from 'node:url';

const rawWeights = {
  accuracy: Number(process.env.WEIGHT_ACCURACY ?? 40),
  evidence: Number(process.env.WEIGHT_EVIDENCE ?? 25),
  sources: Number(process.env.WEIGHT_SOURCES ?? 20),
  context: Number(process.env.WEIGHT_CONTEXT ?? 15),
};
const weightSum = Object.values(rawWeights).reduce((a, b) => a + b, 0) || 1;
const SCORING_WEIGHTS = Object.fromEntries(
  Object.entries(rawWeights).map(([k, v]) => [k, v / weightSum])
);

export const config = {
  port: Number(process.env.PORT || 8787),
  clientOrigins: (process.env.CLIENT_ORIGINS || 'chrome-extension://*').split(',').map((s) => s.trim()),

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  model: process.env.ANALYSIS_MODEL || 'gemini-flash-latest',

  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  maxSearchQueriesPerClaim: Number(process.env.MAX_SEARCH_QUERIES_PER_CLAIM || 2),
  maxResultsPerQuery: Number(process.env.MAX_RESULTS_PER_QUERY || 4),

  analysisVersion: process.env.ANALYSIS_VERSION || '1.0.0',
  scoringWeights: SCORING_WEIGHTS,
  cacheTtlMs: Number(process.env.CACHE_TTL_HOURS || 24 * 14) * 60 * 60 * 1000,
  maxTranscriptChars: Number(process.env.MAX_TRANSCRIPT_CHARS || 20000),
  maxClaimsPerVideo: Number(process.env.MAX_CLAIMS_PER_VIDEO || 8),

  dbPath: process.env.DB_PATH || fileURLToPath(new URL('../data/db.json', import.meta.url)),
};

if (!config.geminiApiKey) {
  console.warn('[config] GEMINI_API_KEY is not set - analysis requests will fail until it is configured in backend/.env');
}
if (!config.tavilyApiKey) {
  console.warn('[config] TAVILY_API_KEY is not set - claim searches will return no evidence until it is configured in backend/.env');
}
