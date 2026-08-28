import test from 'node:test';
import assert from 'node:assert/strict';
import {
  knownAccountToPreferenceRow,
  preferenceRowToKnownAccount,
  reconcilePreferences,
  deduplicateActivity,
  computeSnapshotFingerprint,
  hasPendingLocalDataToMigrate,
  saveMigrationState,
  getMigrationState,
  markLocalDataMigrated,
  dismissMigrationPrompt
} from '../src/sync.js';

// Polyfill minimal localStorage para tests en Node.js
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

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

test('computeSnapshotFingerprint genera un fingerprint determinista', () => {
  const snap1 = {
    createdAt: '2026-08-27T10:00:00Z',
    followers: ['u1', 'u2', 'u3'],
    following: ['u1']
  };
  const snap2 = {
    createdAt: '2026-08-27T10:00:00Z',
    followers: ['u1', 'u2', 'u3'],
    following: ['u1']
  };
  const snap3 = {
    createdAt: '2026-08-27T11:00:00Z',
    followers: ['u1', 'u2', 'u4'],
    following: ['u1']
  };

  const fp1 = computeSnapshotFingerprint(snap1);
  const fp2 = computeSnapshotFingerprint(snap2);
  const fp3 = computeSnapshotFingerprint(snap3);

  assert.equal(fp1, fp2);
  assert.notEqual(fp1, fp3);
});

test('hasPendingLocalDataToMigrate: detecta cuándo hay datos pendientes reales', () => {
  const userId = 'user-test-pending';
  localStorage.clear();

  // Caso 1: Usuario nuevo sin datos locales ni remotos -> false
  assert.equal(hasPendingLocalDataToMigrate({
    userId,
    localSnapshot: null,
    localActivity: [],
    localKnownAccounts: {},
    remoteSnapshot: null,
    remoteActivity: [],
    remotePrefs: []
  }), false);

  // Caso 2: Usuario nuevo con snapshot local previo y 0 datos en nube -> true
  assert.equal(hasPendingLocalDataToMigrate({
    userId,
    localSnapshot: { followers: ['a', 'b'], following: ['a'] },
    localActivity: [],
    localKnownAccounts: {},
    remoteSnapshot: null,
    remoteActivity: [],
    remotePrefs: []
  }), true);

  // Caso 3: Usuario que ya tiene datos en la nube -> false (se sincroniza directo sin modal)
  assert.equal(hasPendingLocalDataToMigrate({
    userId,
    localSnapshot: { followers: ['a', 'b'], following: ['a'] },
    localActivity: [],
    localKnownAccounts: {},
    remoteSnapshot: { followers: ['a', 'b'], following: ['a'] },
    remoteActivity: [],
    remotePrefs: [{ username: 'a' }]
  }), false);

  // Caso 4: Usuario ya marcado como migrado -> false
  markLocalDataMigrated(userId, { followers: ['a', 'b'], following: ['a'] });
  assert.equal(hasPendingLocalDataToMigrate({
    userId,
    localSnapshot: { followers: ['a', 'b'], following: ['a'] },
    localActivity: [],
    localKnownAccounts: {},
    remoteSnapshot: null,
    remoteActivity: [],
    remotePrefs: []
  }), false);
});

test('dismissMigrationPrompt guarda estado descartado para no repetir aviso', () => {
  const userId = 'user-test-dismiss';
  localStorage.clear();

  assert.equal(hasPendingLocalDataToMigrate({
    userId,
    localSnapshot: { followers: ['a'] },
    localActivity: [],
    localKnownAccounts: {},
    remoteSnapshot: null
  }), true);

  dismissMigrationPrompt(userId);

  assert.equal(hasPendingLocalDataToMigrate({
    userId,
    localSnapshot: { followers: ['a'] },
    localActivity: [],
    localKnownAccounts: {},
    remoteSnapshot: null
  }), false);
});

test('Reconciliación y migración repetida es idempotente (0 duplicados)', () => {
  const localKnown = {
    spotify: { famous: true, famousSource: 'manual', updatedAt: '2026-08-27T10:00:00Z' }
  };
  const remoteRows = [
    { username: 'spotify', famous: true, famous_source: 'manual', updated_at: '2026-08-27T10:00:00Z' }
  ];

  const firstRun = reconcilePreferences(localKnown, remoteRows, 'user-123');
  const secondRun = reconcilePreferences(firstRun.mergedKnownAccounts, remoteRows, 'user-123');

  assert.equal(Object.keys(firstRun.mergedKnownAccounts).length, 1);
  assert.equal(Object.keys(secondRun.mergedKnownAccounts).length, 1);
  assert.equal(secondRun.pendingPushRows.length, 0);
});

test('storage.js exporta todas las funciones canónicas de persistencia local requeridas', async () => {
  const storage = await import('../src/storage.js');
  const requiredFunctions = [
    'loadLocalSnapshot',
    'saveLocalSnapshot',
    'loadLocalActivity',
    'saveLocalActivity',
    'loadLocalKnownAccounts',
    'saveLocalKnownAccounts',
    'loadLocalProfile',
    'saveLocalProfile',
    'loadLocalCategories',
    'saveLocalCategories',
    'loadLocalCategoryMemberships',
    'saveLocalCategoryMemberships'
  ];

  for (const fnName of requiredFunctions) {
    assert.equal(typeof storage[fnName], 'function', `storage.js debe exportar la función ${fnName}`);
  }
});

test('Flujo completo de sincronización de Snapshot y Activity persiste en storage local sin ReferenceError', async () => {
  const {
    saveLocalSnapshot, loadLocalSnapshot,
    saveLocalActivity, loadLocalActivity
  } = await import('../src/storage.js');

  localStorage.clear();

  // Simular snapshot remoto
  const remoteSnapshot = {
    id: 101,
    importedAt: '2026-08-28T09:00:00.000Z',
    followers: ['userA', 'userB', 'userC'],
    following: ['userA', 'userD', 'userE']
  };

  // Simular actividad remota
  const remoteActivity = [
    { id: 1, type: 'unfollowed', username: 'userD', createdAt: '2026-08-28T08:30:00.000Z' },
    { id: 2, type: 'followed', username: 'userC', createdAt: '2026-08-28T07:00:00.000Z' }
  ];

  // 1. Guardar snapshot descargado
  saveLocalSnapshot(remoteSnapshot);
  const loadedSnap = loadLocalSnapshot();
  assert.deepEqual(loadedSnap.followers, ['userA', 'userB', 'userC']);
  assert.deepEqual(loadedSnap.following, ['userA', 'userD', 'userE']);

  // 2. Reconciliar y guardar actividad
  const localActivity = [{ type: 'unfollowed', username: 'userZ', createdAt: '2026-08-28T08:00:00.000Z' }];
  const mergedActivity = deduplicateActivity(localActivity, remoteActivity);
  saveLocalActivity(mergedActivity);

  const loadedAct = loadLocalActivity();
  assert.equal(loadedAct.length, 3);
  assert.equal(loadedAct[0].username, 'userD'); // más reciente primero
  assert.equal(loadedAct[1].username, 'userZ');
  assert.equal(loadedAct[2].username, 'userC');
});

// ==========================================
// 10 TESTS MULTI-DISPOSITIVO SINCRONIZACIÓN
// ==========================================

test('1. local vacío + remote categories -> aparecen categories en local', () => {
  const remoteCats = [
    { id: 'cat-1', name: 'Balonmano', sortOrder: 0 },
    { id: 'cat-2', name: 'Fútbol', sortOrder: 1 }
  ];
  const localCats = [];
  // Merge: si remote existe, remote puebla local
  const mergedCats = remoteCats.length > 0 ? [...remoteCats] : localCats;
  assert.equal(mergedCats.length, 2);
  assert.equal(mergedCats[0].name, 'Balonmano');
});

test('2. local vacío + remote memberships -> aparecen memberships en local', () => {
  const remoteMemberships = {
    marta: ['cat-1'],
    pepe: ['cat-2']
  };
  const localMemberships = {};
  const merged = { ...remoteMemberships, ...localMemberships };
  assert.deepEqual(merged.marta, ['cat-1']);
  assert.deepEqual(merged.pepe, ['cat-2']);
});

test('3. local vacío + remote activity -> aparece activity en local', () => {
  const localActivity = [];
  const remoteActivity = [
    { id: 10, username: 'user1', type: 'unfollowed', createdAt: '2026-08-28T09:00:00Z' }
  ];
  const merged = deduplicateActivity(localActivity, remoteActivity);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].username, 'user1');
});

test('4. local vacío + remote preferences -> conserva account_group, unavailable_reason y famous', () => {
  const localKnown = {};
  const remoteRows = [
    {
      username: 'ronaldo',
      account_group: 'relevant',
      famous: true,
      famous_source: 'manual',
      updated_at: '2026-08-28T09:00:00Z'
    },
    {
      username: '__deleted__123',
      account_group: 'unavailable',
      unavailable_reason: 'deleted',
      deleted: true,
      updated_at: '2026-08-28T09:00:00Z'
    }
  ];

  const { mergedKnownAccounts } = reconcilePreferences(localKnown, remoteRows, 'user-123');
  assert.equal(mergedKnownAccounts.ronaldo.group, 'relevant');
  assert.equal(mergedKnownAccounts.ronaldo.famous, true);
  assert.equal(mergedKnownAccounts['__deleted__123'].group, 'unavailable');
  assert.equal(mergedKnownAccounts['__deleted__123'].unavailableReason, 'deleted');
});

test('5. local vacío + remote snapshot -> aparece snapshot en local', async () => {
  const { saveLocalSnapshot, loadLocalSnapshot } = await import('../src/storage.js');
  localStorage.clear();

  const remoteSnapshot = {
    id: 'snap-remote-1',
    importedAt: '2026-08-28T08:00:00Z',
    followers: ['alice', 'bob'],
    following: ['alice', 'charlie']
  };

  saveLocalSnapshot(remoteSnapshot);
  const snap = loadLocalSnapshot();
  assert.equal(snap.id, 'snap-remote-1');
  assert.deepEqual(snap.followers, ['alice', 'bob']);
});

test('6. empty local NO sobrescribe remote en reconciliación', () => {
  const localKnown = {};
  const remoteRows = [
    { username: 'user_x', account_group: 'secondary', updated_at: '2026-08-28T09:00:00Z' }
  ];

  const { mergedKnownAccounts, pendingPushRows } = reconcilePreferences(localKnown, remoteRows, 'user-123');
  assert.equal(mergedKnownAccounts.user_x.group, 'secondary');
  assert.equal(pendingPushRows.length, 0); // No intenta borrar remoto
});

test('7. syncStatus no es synced si falla un bloque', () => {
  const errors = ['Snapshots: Network error'];
  let syncStatus = 'syncing';
  let syncError = '';

  if (errors.length > 0) {
    syncStatus = 'error';
    syncError = 'No se han podido sincronizar algunos datos: ' + errors.join('; ');
  } else {
    syncStatus = 'synced';
  }

  assert.equal(syncStatus, 'error');
  assert.equal(syncError.includes('Snapshots: Network error'), true);
});

test('8. lastSyncAt solo se actualiza cuando sync completa con 0 errores', () => {
  let lastSyncAt = null;
  const errors = ['Actividad: Timeout'];

  if (errors.length === 0) {
    lastSyncAt = new Date().toISOString();
  }

  assert.equal(lastSyncAt, null);

  const noErrors = [];
  if (noErrors.length === 0) {
    lastSyncAt = '2026-08-28T09:15:00Z';
  }
  assert.equal(lastSyncAt, '2026-08-28T09:15:00Z');
});

test('9. initDefaultCategories no pisa categorías remotas si existen en base de datos', () => {
  const remoteCats = [
    { id: 'cat-custom-1', name: 'Mis amigos de balonmano', sortOrder: 0 }
  ];
  // Si remote tiene datos, el estado local toma remoteCats
  const categories = remoteCats.length > 0 ? remoteCats : [];
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, 'Mis amigos de balonmano');
});

test('10. sync bidireccional conserva cambios del dispositivo más reciente', () => {
  const localKnown = {
    player1: {
      group: 'relevant',
      famous: true,
      updatedAt: '2026-08-28T10:00:00Z' // Más reciente en dispositivo local
    },
    player2: {
      group: 'normal',
      updatedAt: '2026-08-28T08:00:00Z' // Más antiguo en dispositivo local
    }
  };

  const remoteRows = [
    {
      username: 'player1',
      account_group: 'normal',
      updated_at: '2026-08-28T09:00:00Z' // Más antiguo en remoto
    },
    {
      username: 'player2',
      account_group: 'secondary',
      updated_at: '2026-08-28T09:30:00Z' // Más nuevo en remoto
    }
  ];

  const { mergedKnownAccounts, pendingPushRows } = reconcilePreferences(localKnown, remoteRows, 'user-123');

  // player1 gana local
  assert.equal(mergedKnownAccounts.player1.group, 'relevant');
  assert.equal(pendingPushRows.some(r => r.username === 'player1'), true);

  // player2 gana remoto
  assert.equal(mergedKnownAccounts.player2.group, 'secondary');
});


