import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config/config.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import videoRoutes from './routes/videoRoutes.js';

const app = express();

// Render (and most PaaS hosts) sit behind a reverse proxy that sets
// X-Forwarded-For. Without this, express-rate-limit throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR instead of correctly identifying
// clients by IP for rate limiting.
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

const allowExtensionOrigins = config.clientOrigins.includes('chrome-extension://*');
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowExtensionOrigins && origin.startsWith('chrome-extension://')) return callback(null, true);
    if (config.clientOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
}));

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', (req, res) => res.json({ ok: true, analysisVersion: config.analysisVersion }));
app.use('/api/videos', videoRoutes);

app.use(notFound);
app.use(errorHandler);

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  app.listen(config.port, () => {
    console.log(`[server] VERI backend listening on port ${config.port}`);
    console.log(`[server] Analysis version: ${config.analysisVersion}`);
    console.log(`[server] Scoring weights: ${JSON.stringify(config.scoringWeights)}`);
  });
}

export default app;
