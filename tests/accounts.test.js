import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUsername,
  isAutoDeleted,
  createAccountRecord,
  syncKnownAccounts,
  classifyAccount,
  categorizeNotFollowingBack
} from '../src/accounts.js';
import { compareSnapshots, calculateNotFollowingBack } from '../src/compare.js';

test('1. __deleted__ se clasifica automáticamente como deleted', () => {
  const username = '__deleted__987654';
  assert.equal(isAutoDeleted(username), true);

  const record = createAccountRecord(username);
  assert.equal(record.deleted, true);

  const snapshot = {
    followers: ['alice'],
    following: ['alice', '__deleted__987654', 'bob']
  };
  const synced = syncKnownAccounts({}, snapshot);
  assert.equal(synced['__deleted__987654']?.deleted, true);

  const notBack = calculateNotFollowingBack(snapshot);
  const categorized = categorizeNotFollowingBack(notBack, synced);

  assert.ok(categorized.deleted.includes('__deleted__987654'));
  assert.ok(!categorized.notFollowingBack.includes('__deleted__987654'));
});

test('2. Una cuenta marcada ignored sigue ignorada tras nueva importación', () => {
  let knownAccounts = {
    'pepito': createAccountRecord('pepito', { ignored: true })
  };

  // Nuevo ZIP con snapshot nuevo
  const newSnapshot = {
    followers: ['ana'],
    following: ['ana', 'pepito', 'carlos']
  };

  knownAccounts = syncKnownAccounts(knownAccounts, newSnapshot);

  assert.equal(knownAccounts['pepito'].ignored, true);
  assert.equal(knownAccounts['pepito'].deleted, false);

  const notBack = calculateNotFollowingBack(newSnapshot);
  const categorized = categorizeNotFollowingBack(notBack, knownAccounts);

  assert.deepEqual(categorized.ignored, ['pepito']);
  assert.ok(!categorized.notFollowingBack.includes('pepito'));
});

test('3. Una cuenta famous permanece famous tras nueva importación', () => {
  let knownAccounts = {
    'elonmusk': createAccountRecord('elonmusk', { famous: true })
  };

  const newSnapshot = {
    followers: ['amigo1'],
    following: ['amigo1', 'elonmusk', 'amigo2']
  };

  knownAccounts = syncKnownAccounts(knownAccounts, newSnapshot);

  assert.equal(knownAccounts['elonmusk'].famous, true);

  const notBack = calculateNotFollowingBack(newSnapshot);
  const categorized = categorizeNotFollowingBack(notBack, knownAccounts);

  assert.deepEqual(categorized.famous, ['elonmusk']);
  assert.ok(!categorized.notFollowingBack.includes('elonmusk'));
});

test('4. Restaurar una cuenta vuelve a No me siguen cuando corresponde', () => {
  let knownAccounts = {
    'amigo_perdido': createAccountRecord('amigo_perdido', { ignored: true })
  };

  const snapshot = {
    followers: ['persona1'],
    following: ['persona1', 'amigo_perdido']
  };

  let categorized = categorizeNotFollowingBack(['amigo_perdido'], knownAccounts);
  assert.deepEqual(categorized.ignored, ['amigo_perdido']);
  assert.deepEqual(categorized.notFollowingBack, []);

  // Restaurar
  knownAccounts = classifyAccount(knownAccounts, 'amigo_perdido', { restore: true });
  assert.equal(knownAccounts['amigo_perdido'].ignored, false);
  assert.equal(knownAccounts['amigo_perdido'].famous, false);
  assert.equal(knownAccounts['amigo_perdido'].deleted, false);

  categorized = categorizeNotFollowingBack(['amigo_perdido'], knownAccounts);
  assert.deepEqual(categorized.notFollowingBack, ['amigo_perdido']);
  assert.deepEqual(categorized.ignored, []);
});

test('5. Clasificar una cuenta no genera activity followed/unfollowed', () => {
  const previous = {
    followers: ['userA', 'userB'],
    following: ['userA', 'userB', 'userC']
  };
  const current = {
    followers: ['userA', 'userB'],
    following: ['userA', 'userB', 'userC']
  };

  // Clasificación manual de userC
  let knownAccounts = {};
  knownAccounts = classifyAccount(knownAccounts, 'userC', { famous: true });

  // Comparación de snapshots sigue intacta
  const comparison = compareSnapshots(previous, current);
  assert.deepEqual(comparison.unfollowed, []);
  assert.deepEqual(comparison.newFollowers, []);
  assert.equal(comparison.isInitial, false);
});

test('6. Datos antiguos sin knownAccounts siguen cargando correctamente', () => {
  const oldSnapshot = {
    followers: ['user1'],
    following: ['user1', 'user2', '__deleted__legacy']
  };

  const emptyKnownAccounts = null;
  const notBack = calculateNotFollowingBack(oldSnapshot);

  // Maneja null/undefined gracefully
  const categorized = categorizeNotFollowingBack(notBack, emptyKnownAccounts);
  assert.ok(categorized.notFollowingBack.includes('user2'));
  assert.ok(categorized.deleted.includes('__deleted__legacy'));

  const synced = syncKnownAccounts(emptyKnownAccounts, oldSnapshot);
  assert.ok(synced['user1']);
  assert.ok(synced['user2']);
  assert.equal(synced['__deleted__legacy'].deleted, true);
});
