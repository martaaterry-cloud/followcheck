import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, calculateNotFollowingBack } from '../src/compare.js';

test('Primera importación: snapshot inicial sin generar eventos falsos', () => {
  const current = {
    followers: ['user1', 'user2', 'user3'],
    following: ['user2', 'user4']
  };

  const res = compareSnapshots(null, current);
  assert.equal(res.isInitial, true);
  assert.deepEqual(res.unfollowed, []);
  assert.deepEqual(res.newFollowers, []);
});

test('Segunda importación: detecta bajas y altas correctamente', () => {
  const previous = {
    followers: ['a', 'b', 'c'],
    following: ['b', 'c']
  };
  const current = {
    followers: ['b', 'c', 'd'],
    following: ['b', 'c']
  };

  const res = compareSnapshots(previous, current);
  assert.equal(res.isInitial, false);
  assert.deepEqual(res.unfollowed, ['a']);
  assert.deepEqual(res.newFollowers, ['d']);
});

test('Mismo snapshot dos veces: 0 altas y 0 bajas', () => {
  const previous = {
    followers: ['alice', 'bob'],
    following: ['alice', 'bob', 'carol']
  };
  const current = {
    followers: ['alice', 'bob'],
    following: ['alice', 'bob', 'carol']
  };

  const res = compareSnapshots(previous, current);
  assert.equal(res.isInitial, false);
  assert.deepEqual(res.unfollowed, []);
  assert.deepEqual(res.newFollowers, []);
});

test('calculateNotFollowingBack calcula correctamente los seguidos que no te siguen', () => {
  const snapshot = {
    followers: ['bob', 'charlie'],
    following: ['alice', 'bob', 'david']
  };

  const notBack = calculateNotFollowingBack(snapshot);
  assert.deepEqual(notBack, ['alice', 'david']);
});
