import test from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage para entorno Node si no está presente
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] || null
  };
}

import { AUTH_ENABLED, APP_VERSION, BUILD_ID } from '../src/config.js';
import { supabase, supabaseReady } from '../src/supabase.js';
import { getAuthUser, getAuthSession, logoutUser } from '../src/auth.js';
import {
  loadLocalSnapshot, saveLocalSnapshot,
  loadLocalActivity, saveLocalActivity,
  loadLocalKnownAccounts, saveLocalKnownAccounts,
  loadLocalCategories, saveLocalCategories,
  loadLocalCategoryMemberships, saveLocalCategoryMemberships,
  loadLocalProfile, saveLocalProfile
} from '../src/storage.js';
import {
  getLatestSnapshot, saveSnapshot,
  getActivity, appendActivity,
  getRemotePreferences, getRemoteCategories
} from '../src/repository.js';
import {
  createFollowCheckBackupJson,
  parseAndValidateBackupJson
} from '../src/sync.js';

test('1. AUTH_ENABLED está configurado en false (Modo Local-First)', () => {
  assert.equal(AUTH_ENABLED, false);
});

test('2. Supabase está completamente aislado y supabaseReady() retorna false', () => {
  assert.equal(supabaseReady(), false);
  assert.equal(supabase, null);
});

test('3. getAuthSession y getAuthUser retornan null sin lanzar errores ni hacer llamadas', async () => {
  const session = await getAuthSession();
  const user = await getAuthUser();
  assert.equal(session, null);
  assert.equal(user, null);
});

test('4. logoutUser no falla en modo local', async () => {
  await assert.doesNotReject(async () => {
    await logoutUser();
  });
});

test('5. Presencia de tokens antiguos de Supabase en localStorage no bloquea ni afecta datos', async () => {
  localStorage.setItem('followcheck_auth_session_v1', JSON.stringify({ access_token: 'fake_old_token', user: { id: 'old-user' } }));
  localStorage.setItem('sb-test-auth-token', 'dummy');

  // Supabase sigue sin estar listo y session sigue siendo null
  assert.equal(supabaseReady(), false);
  const session = await getAuthSession();
  assert.equal(session, null);
});

test('6. getLatestSnapshot y saveSnapshot operan 100% sobre almacenamiento local', async () => {
  const dummySnapshot = {
    id: 12345,
    importedAt: '2026-09-01T12:00:00.000Z',
    followers: ['alice', 'bob'],
    following: ['alice', 'bob', 'charlie']
  };

  const saved = await saveSnapshot(dummySnapshot);
  assert.ok(saved);
  assert.deepEqual(saved.followers, ['alice', 'bob']);
  assert.deepEqual(saved.following, ['alice', 'bob', 'charlie']);

  const loaded = await getLatestSnapshot();
  assert.deepEqual(loaded.followers, ['alice', 'bob']);
  assert.deepEqual(loaded.following, ['alice', 'bob', 'charlie']);
});

test('7. getActivity y appendActivity operan 100% sobre almacenamiento local', async () => {
  const events = [
    { type: 'unfollowed', username: 'charlie', createdAt: '2026-09-02T10:00:00.000Z' }
  ];

  await appendActivity(events);
  const act = await getActivity();
  assert.ok(act.length >= 1);
  assert.equal(act[0].username, 'charlie');
  assert.equal(act[0].type, 'unfollowed');
});

test('8. Funciones remotas retornan defaults seguros y no hacen llamadas de red', async () => {
  const prefs = await getRemotePreferences('any-user-id');
  assert.deepEqual(prefs, []);

  const cats = await getRemoteCategories('any-user-id');
  assert.deepEqual(cats, []);
});

test('9. Exportación e importación de backup JSON funciona íntegramente en local', () => {
  const snapshot = {
    id: 999,
    importedAt: '2026-09-03T00:00:00.000Z',
    followers: ['user1'],
    following: ['user1', 'user2']
  };
  const knownAccounts = {
    user2: { accountGroup: 'relevant', famousSource: 'manual' }
  };
  const categories = [
    { id: 'cat-1', name: 'Amigos', sortOrder: 0 }
  ];
  const memberships = {
    user2: ['cat-1']
  };

  const backup = createFollowCheckBackupJson({
    snapshot,
    activity: [],
    knownAccounts,
    categories,
    categoryMemberships: memberships,
    profile: { instagramUsername: 'mi_cuenta', displayName: 'Mi Cuenta' },
    exportState: {},
    appVersion: APP_VERSION
  });

  assert.equal(backup.followcheck_backup, true);
  assert.equal(backup.version, APP_VERSION);
  assert.deepEqual(backup.data.knownAccounts, knownAccounts);

  assert.deepEqual(backup.data.categories, categories);
  assert.deepEqual(backup.data.categoryMemberships, memberships);

  const jsonStr = JSON.stringify(backup);
  const validated = parseAndValidateBackupJson(jsonStr);

  assert.equal(validated.valid, true);
  assert.deepEqual(validated.data.knownAccounts, knownAccounts);
  assert.deepEqual(validated.data.categories, categories);
});
