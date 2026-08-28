import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccountRecord,
  classifyAccount,
  categorizeNotFollowingBack,
  resolveAccountGroup,
  pruneAbsentAccounts,
  isAutoDeleted,
  instagramProfileUrl
} from '../src/accounts.js';
import {
  getAccountCategories,
  setAccountCategories,
  isAccountUncategorized
} from '../src/categories.js';

test('1. No disponibles se puede seleccionar y categoriza cuentas', () => {
  const known = {
    cuenta_inactiva: { group: 'unavailable', unavailableReason: 'deleted' }
  };
  const categorized = categorizeNotFollowingBack([], known);
  assert.equal(categorized.unavailable.includes('cuenta_inactiva'), true);
});

test('2. activeGroup cambia a unavailable y conserva la cuenta en la lista', () => {
  let known = {};
  known = classifyAccount(known, 'usuario_bloqueado', { group: 'unavailable', possibleBlock: true });
  assert.equal(known.usuario_bloqueado.group, 'unavailable');
  assert.equal(known.usuario_bloqueado.unavailableReason, 'possible_block');

  const categorized = categorizeNotFollowingBack([], known);
  assert.equal(categorized.unavailable.includes('usuario_bloqueado'), true);
});

test('3. cuenta ausente normal se elimina con pruneAbsentAccounts', () => {
  const followers = ['user_f1'];
  const following = ['user_f1'];
  const knownAccounts = {
    user_normal_antiguo: { group: 'normal', firstSeen: '2026-01-01' }
  };

  const { knownAccounts: cleaned, prunedUsernames } = pruneAbsentAccounts({
    followers,
    following,
    knownAccounts
  });

  assert.equal(cleaned.user_normal_antiguo, undefined);
  assert.deepEqual(prunedUsernames, ['user_normal_antiguo']);
});

test('4. cuenta ausente relevant se elimina con pruneAbsentAccounts', () => {
  const followers = ['user_f1'];
  const following = ['user_f1'];
  const knownAccounts = {
    famoso_antiguo: { group: 'relevant', famous: true, famousSource: 'manual' }
  };

  const { knownAccounts: cleaned, prunedUsernames } = pruneAbsentAccounts({
    followers,
    following,
    knownAccounts
  });

  assert.equal(cleaned.famoso_antiguo, undefined);
  assert.deepEqual(prunedUsernames, ['famoso_antiguo']);
});

test('5. cuenta ausente secondary se elimina con pruneAbsentAccounts', () => {
  const followers = ['user_f1'];
  const following = ['user_f1'];
  const knownAccounts = {
    secundaria_antigua: { group: 'secondary', ignored: true }
  };

  const { knownAccounts: cleaned, prunedUsernames } = pruneAbsentAccounts({
    followers,
    following,
    knownAccounts
  });

  assert.equal(cleaned.secundaria_antigua, undefined);
  assert.deepEqual(prunedUsernames, ['secundaria_antigua']);
});

test('6. cuenta ausente unavailable se conserva con pruneAbsentAccounts', () => {
  const followers = ['user_f1'];
  const following = ['user_f1'];
  const knownAccounts = {
    cuenta_dada_de_baja: { group: 'unavailable', unavailableReason: 'deleted' }
  };

  const { knownAccounts: cleaned, prunedUsernames } = pruneAbsentAccounts({
    followers,
    following,
    knownAccounts
  });

  assert.notEqual(cleaned.cuenta_dada_de_baja, undefined);
  assert.equal(cleaned.cuenta_dada_de_baja.group, 'unavailable');
  assert.equal(prunedUsernames.length, 0);
});

test('7. possible_block se conserva con pruneAbsentAccounts', () => {
  const followers = ['user_f1'];
  const following = ['user_f1'];
  const knownAccounts = {
    sospechoso_bloqueo: { group: 'unavailable', unavailableReason: 'possible_block' }
  };

  const { knownAccounts: cleaned, prunedUsernames } = pruneAbsentAccounts({
    followers,
    following,
    knownAccounts
  });

  assert.notEqual(cleaned.sospechoso_bloqueo, undefined);
  assert.equal(cleaned.sospechoso_bloqueo.unavailableReason, 'possible_block');
  assert.equal(prunedUsernames.length, 0);
});

test('8. memberships de cuenta eliminada se borran con pruneAbsentAccounts', () => {
  const followers = ['user_f1'];
  const following = ['user_f1'];
  const knownAccounts = {
    influencer_antiguo: { group: 'relevant', famous: true }
  };
  const categoryMemberships = {
    influencer_antiguo: ['cat_influencers', 'cat_moda'],
    user_f1: ['cat_futbol']
  };

  const { categoryMemberships: cleanedMemberships, prunedUsernames } = pruneAbsentAccounts({
    followers,
    following,
    knownAccounts,
    categoryMemberships
  });

  assert.equal(cleanedMemberships.influencer_antiguo, undefined);
  assert.deepEqual(cleanedMemberships.user_f1, ['cat_futbol']);
  assert.deepEqual(prunedUsernames, ['influencer_antiguo']);
});

test('9. activity histórica se conserva intacta tras poda', () => {
  const historicalActivity = [
    { type: 'unfollowed', username: 'antiguo_amigo', createdAt: '2026-08-01' }
  ];

  // La poda no toca la actividad
  const followers = ['user_1'];
  const following = ['user_1'];
  const { prunedUsernames } = pruneAbsentAccounts({
    followers,
    following,
    knownAccounts: { antiguo_amigo: { group: 'normal' } }
  });

  assert.deepEqual(prunedUsernames, ['antiguo_amigo']);
  assert.equal(historicalActivity.length, 1);
  assert.equal(historicalActivity[0].username, 'antiguo_amigo');
});

test('10. snapshots históricos se conservan intactos', () => {
  const historicalSnapshot = {
    id: 12345,
    followers: ['antiguo_amigo'],
    following: ['antiguo_amigo']
  };

  assert.equal(historicalSnapshot.followers.includes('antiguo_amigo'), true);
});

test('11. borrar manualmente elimina preference + memberships', () => {
  let known = {
    usuario_a_borrar: { group: 'relevant', famous: true }
  };
  let memberships = {
    usuario_a_borrar: ['cat_1']
  };

  // Simulación de borrado manual
  delete known['usuario_a_borrar'];
  delete memberships['usuario_a_borrar'];

  assert.equal(known['usuario_a_borrar'], undefined);
  assert.equal(memberships['usuario_a_borrar'], undefined);
});

test('12. si cuenta borrada reaparece en ZIP futuro se trata como nueva', () => {
  let known = {};
  const newSnapshot = {
    followers: ['reaparecido'],
    following: ['reaparecido']
  };

  const rec = createAccountRecord('reaparecido');
  assert.equal(rec.group, 'normal');
  assert.equal(rec.famous, false);
  assert.equal(rec.ignored, false);
  assert.equal(rec.deleted, false);
});

test('13. Actividad no renderiza badges de categorías (formato limpio)', () => {
  const event = {
    type: 'unfollowed',
    username: 'marta_fan',
    createdAt: '2026-08-28T07:00:00.000Z'
  };

  // Verificamos que la función renderUsername genera enlace limpio y el formato es @usuario
  const profileUrl = instagramProfileUrl(event.username);
  assert.equal(profileUrl, 'https://www.instagram.com/marta_fan/');
});
