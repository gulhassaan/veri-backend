import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { nanoid } from 'nanoid';
import { config } from '../config/config.js';

const dbDir = dirname(config.dbPath);
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

const defaultData = { analyses: {}, feedback: [] };
const adapter = new JSONFile(config.dbPath);
const db = new Low(adapter, defaultData);

let ready = false;
async function ensureReady() {
  if (!ready) {
    await db.read();
    db.data ||= structuredClone(defaultData);
    ready = true;
  }
}

export async function getAnalysis(videoId) {
  await ensureReady();
  return db.data.analyses[videoId] || null;
}

export async function upsertAnalysis(videoId, patch) {
  await ensureReady();
  const existing = db.data.analyses[videoId] || { videoId };
  db.data.analyses[videoId] = { ...existing, ...patch, videoId };
  await db.write();
  return db.data.analyses[videoId];
}

export async function addFeedback({ videoId, message, category }) {
  await ensureReady();
  const entry = {
    id: nanoid(10),
    videoId,
    message: String(message || '').slice(0, 2000),
    category: category || 'other',
    createdAt: new Date().toISOString(),
  };
  db.data.feedback.push(entry);
  await db.write();
  return entry;
}

export async function isStale(record) {
  if (!record?.analyzedAt) return true;
  const age = Date.now() - new Date(record.analyzedAt).getTime();
  return age > config.cacheTtlMs;
}
