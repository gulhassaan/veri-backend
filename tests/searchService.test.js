import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchMany } from '../services/searchService.js';

test('searchMany caps the number of queries actually attempted', async () => {
  await assert.rejects(
    () => searchMany(['q1', 'q2', 'q3', 'q4'], { apiKey: '', maxQueries: 2, maxResultsPerQuery: 4 }),
    /TAVILY_API_KEY/
  );
});

test('searchMany filters out empty/falsy queries before deduping', async () => {
  await assert.rejects(
    () => searchMany(['', null, undefined, 'real query'], { apiKey: '', maxQueries: 2, maxResultsPerQuery: 4 }),
    /TAVILY_API_KEY/
  );
});
