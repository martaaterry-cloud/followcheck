import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRelevantAccount, CONFIDENCE_THRESHOLDS } from '../src/detector.js';

test('detectRelevantAccount: detecta cuenta presente en el catálogo curado', () => {
  const res = detectRelevantAccount('spotify');
  assert.equal(res.isMatch, true);
  assert.ok(res.confidence >= CONFIDENCE_THRESHOLDS.AUTO_CLASSIFY);
  assert.equal(res.name, 'Spotify');
  assert.equal(res.category, 'marcas');
});

test('detectRelevantAccount: cuenta desconocida devuelve confianza 0', () => {
  const res = detectRelevantAccount('mi_amigo_de_clase_123');
  assert.equal(res.isMatch, false);
  assert.equal(res.confidence, 0.0);
  assert.equal(res.name, null);
});

test('detectRelevantAccount: normaliza mayúsculas y espacios', () => {
  const res = detectRelevantAccount('  RealMadrid  ');
  assert.equal(res.isMatch, true);
  assert.equal(res.name, 'Real Madrid C.F.');
});
