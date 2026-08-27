import test from 'node:test';
import assert from 'node:assert/strict';
import { isExportPending } from '../src/exportState.js';

test('isExportPending: devuelve false si no hay fecha de solicitud', () => {
  assert.equal(isExportPending(null, null), false);
  assert.equal(isExportPending(null, '2026-08-27T10:00:00.000Z'), false);
});

test('isExportPending: devuelve true si hay solicitud y no hay importación previa', () => {
  assert.equal(isExportPending('2026-08-27T10:00:00.000Z', null), true);
});

test('isExportPending: devuelve true si la solicitud es posterior a la última importación', () => {
  const req = '2026-08-27T11:00:00.000Z';
  const lastImp = '2026-08-27T10:00:00.000Z';
  assert.equal(isExportPending(req, lastImp), true);
});

test('isExportPending: devuelve false si la importación es posterior a la solicitud', () => {
  const req = '2026-08-27T09:00:00.000Z';
  const lastImp = '2026-08-27T10:00:00.000Z';
  assert.equal(isExportPending(req, lastImp), false);
});
