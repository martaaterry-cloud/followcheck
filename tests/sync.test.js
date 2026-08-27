import test from 'node:test';
import assert from 'node:assert/strict';
import {
  knownAccountToPreferenceRow,
  preferenceRowToKnownAccount,
  reconcilePreferences,
  deduplicateActivity,
  hasLocalDataToMigrate
} from '../src/sync.js';

test('knownAccountToPreferenceRow convierte correctamente a formato Supabase', () => {
  const row = knownAccountToPreferenceRow('user-123', 'nike', {
    famous: true,
    famousSource: 'auto',
    autoFamousConfidence: 0.98,
    autoFamousReason: 'Marca oficial',
    ignored: false,
    deleted: false
  });

  assert.equal(row.user_id, 'user-123');
  assert.equal(row.username, 'nike');
  assert.equal(row.famous, true);
  assert.equal(row.famous_source, 'auto');
  assert.equal(row.auto_famous_confidence, 0.98);
  assert.equal(row.auto_famous_reason, 'Marca oficial');
});

test('preferenceRowToKnownAccount convierte fila de Supabase a knownAccount local', () => {
  const acc = preferenceRowToKnownAccount({
    username: 'nike',
    famous: true,
    famous_source: 'manual',
    ignored: false,
    deleted: false,
    auto_famous_confidence: 0,
    auto_famous_reason: '',
    updated_at: '2026-08-27T10:00:00.000Z'
  });

  assert.equal(acc.status, 'normal');
  assert.equal(acc.famous, true);
  assert.equal(acc.famousSource, 'manual');
  assert.equal(acc.updatedAt, '2026-08-27T10:00:00.000Z');
});

test('reconcilePreferences resuelve conflictos favoreciendo el updated_at más reciente', () => {
  const localKnown = {
    spotify: {
      famous: true,
      famousSource: 'manual',
      updatedAt: '2026-08-27T12:00:00.000Z'
    },
    nike: {
      famous: false,
      updatedAt: '2026-08-27T08:00:00.000Z'
    }
  };

  const remoteRows = [
    {
      username: 'spotify',
      famous: false,
      updated_at: '2026-08-27T09:00:00.000Z' // Más antiguo que local
    },
    {
      username: 'nike',
      famous: true,
      famous_source: 'manual',
      updated_at: '2026-08-27T11:00:00.000Z' // Más nuevo que local
    },
    {
      username: 'adidas',
      famous: true,
      famous_source: 'auto',
      updated_at: '2026-08-27T10:00:00.000Z' // Solo en remoto
    }
  ];

  const { mergedKnownAccounts, pendingPushRows } = reconcilePreferences(localKnown, remoteRows, 'user-123');

  // Spotify debe conservar el valor local (más nuevo)
  assert.equal(mergedKnownAccounts.spotify.famous, true);
  assert.equal(pendingPushRows.some(r => r.username === 'spotify'), true);

  // Nike debe adoptar el valor remoto (más nuevo)
  assert.equal(mergedKnownAccounts.nike.famous, true);

  // Adidas debe incorporarse desde remoto
  assert.equal(mergedKnownAccounts.adidas.famous, true);
});

test('deduplicateActivity unifica y elimina eventos duplicados conservando orden descendente', () => {
  const localAct = [
    { username: 'user1', type: 'unfollowed', createdAt: '2026-08-27T10:00:00.000Z' },
    { username: 'user2', type: 'followed', createdAt: '2026-08-27T09:00:00.000Z' }
  ];

  const remoteAct = [
    { username: 'user1', type: 'unfollowed', createdAt: '2026-08-27T10:00:00.000Z' }, // Duplicado exacto
    { username: 'user3', type: 'unfollowed', createdAt: '2026-08-27T11:00:00.000Z' }
  ];

  const merged = deduplicateActivity(localAct, remoteAct);

  assert.equal(merged.length, 3);
  assert.equal(merged[0].username, 'user3'); // 11:00
  assert.equal(merged[1].username, 'user1'); // 10:00
  assert.equal(merged[2].username, 'user2'); // 09:00
});

test('hasLocalDataToMigrate detecta si hay datos locales antes del primer login', () => {
  assert.equal(hasLocalDataToMigrate(null, [], {}), false);
  assert.equal(hasLocalDataToMigrate({ followers: ['a'] }, [], {}), true);
  assert.equal(hasLocalDataToMigrate(null, [{ username: 'a' }], {}), true);
  assert.equal(hasLocalDataToMigrate(null, [], { user1: {} }), true);
});
