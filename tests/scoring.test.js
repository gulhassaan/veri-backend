import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverallScore, ratingLabel } from '../services/analysisService.js';

const DEFAULT_WEIGHTS = { accuracy: 0.4, evidence: 0.25, sources: 0.2, context: 0.15 };

test('computeOverallScore applies the configured weights (spec default: 40/25/20/15)', () => {
  const score = computeOverallScore({ accuracy: 100, evidence: 100, sources: 100, context: 100 }, DEFAULT_WEIGHTS);
  assert.equal(score, 100);
});

test('computeOverallScore weights accuracy most heavily by default', () => {
  const highAccuracy = computeOverallScore({ accuracy: 100, evidence: 0, sources: 0, context: 0 }, DEFAULT_WEIGHTS);
  const highContext = computeOverallScore({ accuracy: 0, evidence: 0, sources: 0, context: 100 }, DEFAULT_WEIGHTS);
  assert.ok(highAccuracy > highContext);
  assert.equal(highAccuracy, 40);
  assert.equal(highContext, 15);
});

test('computeOverallScore is a pure weighted sum, matches hand calculation', () => {
  const score = computeOverallScore({ accuracy: 80, evidence: 60, sources: 90, context: 40 }, DEFAULT_WEIGHTS);
  assert.equal(score, 71);
});

test('computeOverallScore respects custom/recalibrated weights without code changes', () => {
  const equalWeights = { accuracy: 0.25, evidence: 0.25, sources: 0.25, context: 0.25 };
  const score = computeOverallScore({ accuracy: 100, evidence: 0, sources: 0, context: 0 }, equalWeights);
  assert.equal(score, 25);
});

test('computeOverallScore clamps and defaults invalid/missing dimension values to 0', () => {
  const score = computeOverallScore({ accuracy: 'not-a-number', evidence: -50, sources: 200, context: undefined }, DEFAULT_WEIGHTS);
  assert.equal(score, 20);
});

test('ratingLabel thresholds match the spec (High/Moderate/Low)', () => {
  assert.equal(ratingLabel(100), 'High');
  assert.equal(ratingLabel(75), 'High');
  assert.equal(ratingLabel(74), 'Moderate');
  assert.equal(ratingLabel(45), 'Moderate');
  assert.equal(ratingLabel(44), 'Low');
  assert.equal(ratingLabel(0), 'Low');
});
