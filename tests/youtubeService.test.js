import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractPlayerResponse, isValidVideoId } from '../services/youtubeService.js';

const fixtureHtml = readFileSync(
  fileURLToPath(new URL('../fixtures/sample-watch-page.html', import.meta.url)),
  'utf8'
);

test('extractPlayerResponse parses the embedded JSON correctly', () => {
  const parsed = extractPlayerResponse(fixtureHtml);
  assert.ok(parsed, 'should find and parse a player response object');
  assert.equal(parsed.videoDetails.title, 'Does Drinking Cold Water Slow Digestion?');
  assert.equal(parsed.videoDetails.author, 'Test Channel');
  assert.equal(parsed.videoDetails.lengthSeconds, '300');
});

test('extractPlayerResponse is not confused by braces inside quoted strings', () => {
  const parsed = extractPlayerResponse(fixtureHtml);
  assert.match(parsed.videoDetails.shortDescription, /brace inside a string/);
});

test('extractPlayerResponse does not pick up an unrelated JSON blob that appears first', () => {
  const parsed = extractPlayerResponse(fixtureHtml);
  assert.equal(parsed.unrelated, undefined);
});

test('extractPlayerResponse stops at the correct closing brace, ignoring what follows', () => {
  const parsed = extractPlayerResponse(fixtureHtml);
  assert.equal(parsed.shouldNotBeParsed, undefined);
  assert.ok(parsed.captions.playerCaptionsTracklistRenderer.captionTracks.length === 1);
});

test('extractPlayerResponse returns null when no player response is present', () => {
  const parsed = extractPlayerResponse('<html><body>no player data here</body></html>');
  assert.equal(parsed, null);
});

test('isValidVideoId accepts well-formed 11-character YouTube IDs', () => {
  assert.equal(isValidVideoId('dQw4w9WgXcQ'), true);
  assert.equal(isValidVideoId('abc12345678'), true);
});

test('isValidVideoId rejects malformed input (injection/path-traversal guard)', () => {
  assert.equal(isValidVideoId(''), false);
  assert.equal(isValidVideoId('short'), false);
  assert.equal(isValidVideoId('../../etc/passwd'), false);
  assert.equal(isValidVideoId('has spaces!!'), false);
  assert.equal(isValidVideoId(null), false);
  assert.equal(isValidVideoId(undefined), false);
});
