import test from 'node:test';
import assert from 'node:assert/strict';

function calculateSnapshotsToDelete(snapshots, maxKeep = 10) {
  if (!snapshots || snapshots.length <= maxKeep) return [];
  // Asumiendo ordenados DESC por created_at
  return snapshots.slice(maxKeep).map(s => s.id);
}

test('Política de retención: mantiene los 10 más recientes y marca los sobrantes para eliminar', () => {
  const snapshots = Array.from({ length: 15 }, (_, i) => ({
    id: 100 + i,
    created_at: new Date(2026, 0, 15 - i).toISOString()
  }));

  const toDelete = calculateSnapshotsToDelete(snapshots, 10);
  assert.equal(toDelete.length, 5);
  assert.deepEqual(toDelete, [110, 111, 112, 113, 114]);
});

test('Política de retención: no elimina nada si hay 10 o menos snapshots', () => {
  const snapshots = Array.from({ length: 10 }, (_, i) => ({
    id: 100 + i,
    created_at: new Date(2026, 0, 10 - i).toISOString()
  }));

  const toDelete = calculateSnapshotsToDelete(snapshots, 10);
  assert.equal(toDelete.length, 0);
});
