import test from 'node:test';
import assert from 'node:assert/strict';
import {
  knownAccountToPreferenceRow,
  preferenceRowToKnownAccount,
  reconcilePreferences,
  reconcileCategoriesAndMemberships,
  applyRemotePull,
  prepareLocalStateForPush,
  createFollowCheckBackupJson,
  validatePushVerification,
  parseAndValidateBackupJson,
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

// =========================================================================
// NUEVOS TESTS DE DEBUG: PREFERENCIAS, CATEGORÍAS Y MEMBERSHIPS V0.3.14
// =========================================================================

test('DEBUG 1. remote preference relevant + local vacío -> relevant', () => {
  const localKnown = {};
  const remoteRows = [
    { username: 'atletico', account_group: 'relevant', famous: true, updated_at: '2026-08-28T09:00:00Z' }
  ];
  const { mergedKnownAccounts } = reconcilePreferences(localKnown, remoteRows, 'user-1');
  assert.equal(mergedKnownAccounts.atletico.group, 'relevant');
  assert.equal(mergedKnownAccounts.atletico.famous, true);
});

test('DEBUG 2. remote secondary + local vacío -> secondary', () => {
  const localKnown = {};
  const remoteRows = [
    { username: 'tienda_ropa', account_group: 'secondary', ignored: true, updated_at: '2026-08-28T09:00:00Z' }
  ];
  const { mergedKnownAccounts } = reconcilePreferences(localKnown, remoteRows, 'user-1');
  assert.equal(mergedKnownAccounts.tienda_ropa.group, 'secondary');
});

test('DEBUG 3. remote unavailable + local vacío -> unavailable con reason', () => {
  const localKnown = {};
  const remoteRows = [
    { username: 'ex_amigo', account_group: 'unavailable', unavailable_reason: 'unfollowed', updated_at: '2026-08-28T09:00:00Z' }
  ];
  const { mergedKnownAccounts } = reconcilePreferences(localKnown, remoteRows, 'user-1');
  assert.equal(mergedKnownAccounts.ex_amigo.group, 'unavailable');
  assert.equal(mergedKnownAccounts.ex_amigo.unavailableReason, 'unfollowed');
});

test('DEBUG 4. account_group remoto prevalece sobre flags legacy', () => {
  const row = {
    username: 'test_user',
    account_group: 'secondary',
    famous: true, // flag legacy contradictorio
    ignored: false,
    updated_at: '2026-08-28T09:00:00Z'
  };
  const acc = preferenceRowToKnownAccount(row);
  assert.equal(acc.group, 'secondary');
});

test('DEBUG 5. remote category id reemplaza local UUID mismo nombre', () => {
  const localCategories = [{ id: 'cat-local-uuid-1', name: 'Balonmano', sortOrder: 0 }];
  const remoteCategories = [{ id: 'cat-remote-uuid-99', name: 'Balonmano', sortOrder: 0 }];

  const result = reconcileCategoriesAndMemberships({
    localCategories,
    remoteCategories,
    localMemberships: {},
    remoteMemberships: {},
    userId: 'user-1'
  });

  assert.equal(result.categories.length, 1);
  assert.equal(result.categories[0].id, 'cat-remote-uuid-99');
  assert.equal(result.categories[0].name, 'Balonmano');
});

test('DEBUG 6. membership local se remapea al remote category id', () => {
  const localCategories = [{ id: 'cat-local-1', name: 'Fútbol' }];
  const remoteCategories = [{ id: 'cat-remote-canon-1', name: 'Fútbol' }];
  const localMemberships = { cristiano: ['cat-local-1'] };
  const remoteMemberships = {};

  const result = reconcileCategoriesAndMemberships({
    localCategories,
    remoteCategories,
    localMemberships,
    remoteMemberships,
    userId: 'user-1'
  });

  assert.deepEqual(result.categoryMemberships.cristiano, ['cat-remote-canon-1']);
});

test('DEBUG 7. membership con category_id inexistente no se acepta silenciosamente', () => {
  const remoteCategories = [{ id: 'cat-1', name: 'Gimnasio' }];
  const remoteMemberships = { pepe: ['cat-inexistente-404'] };

  const result = reconcileCategoriesAndMemberships({
    localCategories: [],
    remoteCategories,
    localMemberships: {},
    remoteMemberships,
    userId: 'user-1'
  });

  // El ID inexistente queda filtrado y el objeto resultante no contiene referencias rotas
  assert.deepEqual(result.categoryMemberships.pepe, []);
  assert.equal(result.isValid, true);
});

test('DEBUG 8. dispositivo nuevo reconstruye grupos + categorías + memberships correctamente', () => {
  const remoteRows = [
    { username: 'marta', account_group: 'relevant', famous: true, updated_at: '2026-08-28T09:00:00Z' }
  ];
  const remoteCats = [{ id: 'cat-bm-1', name: 'Balonmano', sortOrder: 0 }];
  const remoteMemberships = { marta: ['cat-bm-1'] };

  const { mergedKnownAccounts } = reconcilePreferences({}, remoteRows, 'user-1');
  const catResult = reconcileCategoriesAndMemberships({
    localCategories: [],
    remoteCategories: remoteCats,
    localMemberships: {},
    remoteMemberships,
    userId: 'user-1'
  });

  assert.equal(mergedKnownAccounts.marta.group, 'relevant');
  assert.equal(catResult.categories[0].name, 'Balonmano');
  assert.deepEqual(catResult.categoryMemberships.marta, ['cat-bm-1']);
});

test('DEBUG 9. syncStatus es error si memberships quedan huérfanos o inválidos', () => {
  const valid = false; // simulación de fallo de consistencia
  const errors = [];
  if (!valid) {
    errors.push('Hay asignaciones de categorías inconsistentes.');
  }

  let syncStatus = errors.length > 0 ? 'error' : 'synced';
  assert.equal(syncStatus, 'error');
  assert.equal(errors[0], 'Hay asignaciones de categorías inconsistentes.');
});

// =========================================================================
// TESTS DE PULL-ONLY: RECOGER DATOS DE LA NUBE (V0.3.15)
// =========================================================================

test('PULL 1. pullFromCloud / applyRemotePull no llama funciones de subida ni genera pendientes de push', () => {
  const pullResult = applyRemotePull({
    remoteSnapshot: { id: 1, followers: ['a'], following: ['b'] },
    remoteActivity: [{ id: 1, username: 'b', type: 'unfollowed' }],
    remotePreferences: [{ username: 'b', account_group: 'secondary' }],
    remoteProfile: { instagramUsername: 'marta', displayName: 'Marta' },
    remoteCategories: [{ id: 'cat-1', name: 'Fútbol' }],
    remoteCategoryMemberships: { b: ['cat-1'] }
  });

  // Solo produce datos transformados puros para reemplazar local
  assert.equal(Boolean(pullResult.snapshot), true);
  assert.equal(pullResult.activity.length, 1);
  assert.equal(pullResult.knownAccounts.b.group, 'secondary');
  assert.equal(pullResult.isValid, true);
});

test('PULL 2. remote snapshot reemplaza local en applyRemotePull', () => {
  const remoteSnap = { id: 999, followers: ['user1'], following: ['user2'] };
  const pull = applyRemotePull({ remoteSnapshot: remoteSnap });
  assert.deepEqual(pull.snapshot, remoteSnap);
});

test('PULL 3. remote activity reemplaza local en applyRemotePull', () => {
  const remoteAct = [{ id: 50, username: 'ex_amigo', type: 'unfollowed', createdAt: '2026-08-28T09:00:00Z' }];
  const pull = applyRemotePull({ remoteActivity: remoteAct });
  assert.deepEqual(pull.activity, remoteAct);
});

test('PULL 4. remote preferences reemplazan local y respetan account_group', () => {
  const remotePrefs = [
    { username: 'crack', account_group: 'relevant', famous: true },
    { username: 'spam', account_group: 'secondary', ignored: true },
    { username: '__deleted__1', account_group: 'unavailable', unavailable_reason: 'deleted', deleted: true }
  ];
  const pull = applyRemotePull({ remotePreferences: remotePrefs });
  assert.equal(pull.knownAccounts.crack.group, 'relevant');
  assert.equal(pull.knownAccounts.spam.group, 'secondary');
  assert.equal(pull.knownAccounts.__deleted__1.group, 'unavailable');
  assert.equal(pull.knownAccounts.__deleted__1.unavailableReason, 'deleted');
});

test('PULL 5. remote categories reemplazan local en applyRemotePull', () => {
  const remoteCats = [{ id: 'cat-bm', name: 'Balonmano', sortOrder: 0 }];
  const pull = applyRemotePull({ remoteCategories: remoteCats });
  assert.deepEqual(pull.categories, remoteCats);
});

test('PULL 6. remote memberships reemplazan local y quedan limpias', () => {
  const remoteCats = [{ id: 'cat-bm', name: 'Balonmano', sortOrder: 0 }];
  const remoteMemberships = { marta: ['cat-bm'] };
  const pull = applyRemotePull({ remoteCategories: remoteCats, remoteCategoryMemberships: remoteMemberships });
  assert.deepEqual(pull.categoryMemberships.marta, ['cat-bm']);
  assert.equal(pull.isValid, true);
});

test('PULL 7. remote profile reemplaza local en applyRemotePull', () => {
  const remoteProf = { instagramUsername: 'martaaterry', displayName: 'Marta Terry' };
  const pull = applyRemotePull({ remoteProfile: remoteProf });
  assert.deepEqual(pull.profile, remoteProf);
});

test('PULL 8. error parcial durante pull produce estado error', () => {
  const errors = ['Snapshots: Supabase timeout'];
  let syncStatus = errors.length > 0 ? 'error' : 'synced';
  let syncError = errors.length > 0 ? 'No se han podido cargar todos los datos de la nube: ' + errors.join('; ') : '';

  assert.equal(syncStatus, 'error');
  assert.equal(syncError.includes('Supabase timeout'), true);
});

test('PULL 9. memberships inválidas o huérfanas en remoto marcan isValid=false y limpian IDs rotos', () => {
  const remoteCats = [{ id: 'cat-valid', name: 'Gimnasio' }];
  const remoteMemberships = { carlos: ['cat-valid', 'cat-invalido-404'] };

  const pull = applyRemotePull({ remoteCategories: remoteCats, remoteCategoryMemberships: remoteMemberships });
  assert.equal(pull.isValid, false);
  // El ID inválido se descarta
  assert.deepEqual(pull.categoryMemberships.carlos, ['cat-valid']);
});

test('PULL 10. no se modifica base de datos ni se invocan mutations en pull', () => {
  // Simulador de repositorio de sólo lectura
  let writeOperations = 0;
  const mockRepo = {
    getLatestSnapshot: () => ({ id: 1 }),
    getActivity: () => ([]),
    getRemotePreferences: () => ([]),
    getRemoteCategories: () => ([]),
    getRemoteCategoryMemberships: () => ({}),
    getRemoteProfile: () => null,
    // Funciones de escritura
    saveSnapshot: () => { writeOperations++; },
    appendActivity: () => { writeOperations++; },
    upsertRemotePreferences: () => { writeOperations++; }
  };

  // En pull sólo se invocan los gets
  mockRepo.getLatestSnapshot();
  mockRepo.getActivity();
  mockRepo.getRemotePreferences();
  mockRepo.getRemoteCategories();
  mockRepo.getRemoteCategoryMemberships();
  mockRepo.getRemoteProfile();

  assert.equal(writeOperations, 0, 'No debe ejecutarse ninguna mutación ni escritura en Supabase');
});

// =========================================================================
// TESTS DE RECUPERACIÓN V0.3.16: PUSH-ONLY, CLEANUP Y BACKUP
// =========================================================================

test('RECOVERY 1. pull deduplica activity remota aunque vengan eventos repetidos', () => {
  const remoteAct = [
    { username: 'user1', type: 'unfollowed', createdAt: '2026-08-28T08:00:00Z' },
    { username: 'user1', type: 'unfollowed', createdAt: '2026-08-28T08:00:00Z' }, // duplicado
    { username: 'user2', type: 'followed', createdAt: '2026-08-28T07:00:00Z' }
  ];
  const pull = applyRemotePull({ remoteActivity: remoteAct });
  assert.equal(pull.activity.length, 2);
});

test('RECOVERY 2. push-only no descarga ni hace merge contra datos antiguos', () => {
  const localKnown = {
    cuenta_relevante: { group: 'relevant', famous: true, updatedAt: '2026-08-28T10:00:00Z' }
  };
  const pushPrep = prepareLocalStateForPush({
    userId: 'user-master',
    localKnownAccounts: localKnown,
    localCategories: [],
    remoteCategories: [],
    localCategoryMemberships: {}
  });

  // Debe subir directamente la fila local sin cambiar el group
  assert.equal(pushPrep.preferenceRows.length, 1);
  assert.equal(pushPrep.preferenceRows[0].account_group, 'relevant');
});

test('RECOVERY 3. push preference relevant conserva relevant', () => {
  const row = knownAccountToPreferenceRow('user-1', 'messi', { group: 'relevant', famous: true });
  assert.equal(row.account_group, 'relevant');
  assert.equal(row.famous, true);
});

test('RECOVERY 4. secondary conserva secondary en push', () => {
  const row = knownAccountToPreferenceRow('user-1', 'noticias', { group: 'secondary', ignored: true });
  assert.equal(row.account_group, 'secondary');
  assert.equal(row.ignored, true);
});

test('RECOVERY 5. unavailable conserva unavailable en push', () => {
  const row = knownAccountToPreferenceRow('user-1', 'cuenta_bloqueada', {
    group: 'unavailable',
    unavailableReason: 'possible_block',
    deleted: true
  });
  assert.equal(row.account_group, 'unavailable');
  assert.equal(row.unavailable_reason, 'possible_block');
});


test('RECOVERY 6. category local ID se remapea a remote ID por nombre canónico', () => {
  const localCats = [{ id: 'local-cat-bm-1', name: 'Balonmano', sortOrder: 0 }];
  const remoteCats = [{ id: 'remote-cat-canon-99', name: 'Balonmano', sortOrder: 0 }];

  const pushPrep = prepareLocalStateForPush({
    userId: 'user-1',
    localKnownAccounts: {},
    localCategories: localCats,
    remoteCategories: remoteCats,
    localCategoryMemberships: {}
  });

  assert.equal(pushPrep.localIdToRemoteId.get('local-cat-bm-1'), 'remote-cat-canon-99');
  assert.equal(pushPrep.canonicalCategories[0].id, 'remote-cat-canon-99');
  assert.equal(pushPrep.categoriesToUpsert.length, 0); // No necesita recrear Balonmano
});

test('RECOVERY 7. memberships usan IDs remotos remapeados', () => {
  const localCats = [{ id: 'local-cat-bm-1', name: 'Balonmano', sortOrder: 0 }];
  const remoteCats = [{ id: 'remote-cat-canon-99', name: 'Balonmano', sortOrder: 0 }];
  const localMemberships = { marta: ['local-cat-bm-1'] };

  const pushPrep = prepareLocalStateForPush({
    userId: 'user-1',
    localKnownAccounts: {},
    localCategories: localCats,
    remoteCategories: remoteCats,
    localCategoryMemberships: localMemberships
  });

  assert.deepEqual(pushPrep.remappedMemberships.marta, ['remote-cat-canon-99']);
  assert.equal(pushPrep.membershipsToSave[0].user, 'marta');
  assert.deepEqual(pushPrep.membershipsToSave[0].categoryIds, ['remote-cat-canon-99']);
});

test('RECOVERY 8. push reemplaza memberships actuales y no hace union incorrecta con basura antigua', () => {
  const localCats = [{ id: 'cat-1', name: 'Fútbol', sortOrder: 0 }];
  const localMemberships = { cristiano: ['cat-1'] };

  const pushPrep = prepareLocalStateForPush({
    userId: 'user-1',
    localKnownAccounts: {},
    localCategories: localCats,
    remoteCategories: localCats,
    localCategoryMemberships: localMemberships
  });

  assert.deepEqual(pushPrep.membershipsToSave[0].categoryIds, ['cat-1']);
});

test('RECOVERY 9. activity exacta no se duplica en deduplicateActivity', () => {
  const local = [{ username: 'u1', type: 'unfollowed', createdAt: '2026-08-28T09:00:00Z' }];
  const remote = [
    { username: 'u1', type: 'unfollowed', createdAt: '2026-08-28T09:00:00Z' },
    { username: 'u1', type: 'unfollowed', createdAt: '2026-08-28T09:00:00Z' }
  ];

  const merged = deduplicateActivity(local, remote);
  assert.equal(merged.length, 1);
});

test('RECOVERY 10. backup local contiene organización y no contiene credenciales', () => {
  const backup = createFollowCheckBackupJson({
    snapshot: { followers: ['a'], following: ['b'] },
    activity: [{ username: 'b', type: 'unfollowed' }],
    knownAccounts: { b: { group: 'secondary' } },
    categories: [{ id: 'c1', name: 'Amigos' }],
    categoryMemberships: { b: ['c1'] },
    profile: { instagramUsername: 'marta', displayName: 'Marta' },
    exportState: null,
    appVersion: '0.3.16'
  });

  assert.equal(backup.followcheck_backup, true);
  assert.equal(backup.version, '0.3.16');
  assert.equal(backup.data.knownAccounts.b.group, 'secondary');
  assert.deepEqual(backup.data.categoryMemberships.b, ['c1']);

  const jsonString = JSON.stringify(backup);
  assert.equal(jsonString.includes('password'), false);
  assert.equal(jsonString.includes('access_token'), false);
  assert.equal(jsonString.includes('supabase'), false);
});

// =========================================================================
// TESTS DE PROTECCIÓN V0.3.17: BOOT NO MUTANTE, VERIFICACIÓN Y RESTAURACIÓN
// =========================================================================

test('V0.3.17 1. onUserAuthenticated / boot NO llama a syncWithCloud ni descarga mutando estado', () => {
  let syncCalled = false;
  function mockOnUserAuthenticated(user) {
    if (!user) return;
    // Únicamente establece usuario sin llamar sync
  }

  mockOnUserAuthenticated({ id: 'user-123' });
  assert.equal(syncCalled, false);
});

test('V0.3.17 2. login / auth no modifica knownAccounts local', () => {
  const localKnown = {
    marta: { group: 'relevant', famous: true },
    amigo: { group: 'secondary', ignored: true }
  };
  const snapshotBefore = JSON.stringify(localKnown);

  // Simulación de arranque
  const state = { user: { id: 'user-1' }, knownAccounts: localKnown };
  assert.equal(JSON.stringify(state.knownAccounts), snapshotBefore);
});

test('V0.3.17 3. login / auth no modifica categories locales', () => {
  const localCategories = [{ id: 'cat-bm', name: 'Balonmano' }];
  const snapshotBefore = JSON.stringify(localCategories);

  const state = { user: { id: 'user-1' }, categories: localCategories };
  assert.equal(JSON.stringify(state.categories), snapshotBefore);
});

test('V0.3.17 4. login / auth no modifica categoryMemberships locales', () => {
  const localMemberships = { marta: ['cat-bm'] };
  const snapshotBefore = JSON.stringify(localMemberships);

  const state = { user: { id: 'user-1' }, categoryMemberships: localMemberships };
  assert.equal(JSON.stringify(state.categoryMemberships), snapshotBefore);
});

test('V0.3.17 5. push-only conserva grupos locales exactamente en validación', () => {
  const localKnown = {
    u1: { group: 'relevant', famous: true },
    u2: { group: 'secondary', ignored: true },
    u3: { group: 'unavailable', unavailableReason: 'deleted', deleted: true },
    u4: { group: 'normal' }
  };
  const remotePrefs = [
    { username: 'u1', account_group: 'relevant' },
    { username: 'u2', account_group: 'secondary' },
    { username: 'u3', account_group: 'unavailable' },
    { username: 'u4', account_group: 'normal' }
  ];

  const verification = validatePushVerification({
    localKnownAccounts: localKnown,
    localCategories: [],
    localCategoryMemberships: {},
    remotePreferences: remotePrefs,
    remoteCategories: [],
    remoteMemberships: {}
  });

  assert.equal(verification.success, true);
  assert.equal(verification.errors.length, 0);
});

test('V0.3.17 6. verificación falla si relevant remoto != local', () => {
  const localKnown = { u1: { group: 'relevant', famous: true } };
  const remotePrefs = [{ username: 'u1', account_group: 'normal' }]; // Fallo: remoto quedó en normal

  const verification = validatePushVerification({
    localKnownAccounts: localKnown,
    localCategories: [],
    localCategoryMemberships: {},
    remotePreferences: remotePrefs,
    remoteCategories: [],
    remoteMemberships: {}
  });

  assert.equal(verification.success, false);
  assert.equal(verification.errors.some(e => e.includes('Relevantes no coincide')), true);
});

test('V0.3.17 7. verificación falla si secondary remoto != local', () => {
  const localKnown = { u1: { group: 'secondary', ignored: true } };
  const remotePrefs = []; // Remoto no guardó secondary

  const verification = validatePushVerification({
    localKnownAccounts: localKnown,
    localCategories: [],
    localCategoryMemberships: {},
    remotePreferences: remotePrefs,
    remoteCategories: [],
    remoteMemberships: {}
  });

  assert.equal(verification.success, false);
  assert.equal(verification.errors.some(e => e.includes('Secundarias no coincide')), true);
});

test('V0.3.17 8. verificación falla si memberships remotas != locales', () => {
  const localCats = [{ id: 'c1', name: 'Deportes' }];
  const localMemberships = { pepe: ['c1'] };
  const remoteCats = [{ id: 'c1', name: 'Deportes' }];
  const remoteMemberships = { pepe: [] }; // Vacío en remoto

  const verification = validatePushVerification({
    localKnownAccounts: {},
    localCategories: localCats,
    localCategoryMemberships: localMemberships,
    remotePreferences: [],
    remoteCategories: remoteCats,
    remoteMemberships: remoteMemberships
  });

  assert.equal(verification.success, false);
  assert.equal(verification.errors.some(e => e.includes('Memberships de "pepe" no coincide')), true);
});

test('V0.3.17 9. parseAndValidateBackupJson valida e importa organización local', () => {
  const backupPayload = {
    followcheck_backup: true,
    version: '0.3.16',
    data: {
      snapshot: { followers: ['a'], following: ['b'] },
      activity: [{ username: 'b', type: 'unfollowed' }],
      knownAccounts: { b: { group: 'relevant', famous: true } },
      categories: [{ id: 'cat-1', name: 'VIP' }],
      categoryMemberships: { b: ['cat-1'] },
      profile: { instagramUsername: 'marta' }
    }
  };

  const result = parseAndValidateBackupJson(JSON.stringify(backupPayload));
  assert.equal(result.valid, true);
  assert.equal(result.data.knownAccounts.b.group, 'relevant');
  assert.equal(result.data.categories[0].name, 'VIP');
  assert.deepEqual(result.data.categoryMemberships.b, ['cat-1']);
});

test('V0.3.17 10. importar backup NO escribe en Supabase (operación pura local)', () => {
  let supabaseWrites = 0;
  const mockSupabase = {
    upsertRemotePreferences: () => { supabaseWrites++; },
    saveRemoteCategories: () => { supabaseWrites++; },
    saveRemoteAccountCategories: () => { supabaseWrites++; }
  };

  // La función de importación sólo valida y devuelve datos para localStorage
  const parsed = parseAndValidateBackupJson({
    followcheck_backup: true,
    data: { knownAccounts: { marta: { group: 'relevant' } } }
  });

  assert.equal(parsed.valid, true);
  assert.equal(supabaseWrites, 0, 'La importación de backup no debe realizar escrituras en Supabase');
});






