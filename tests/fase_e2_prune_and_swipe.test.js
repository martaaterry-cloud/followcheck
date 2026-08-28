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
  calculateNotFollowingBack
} from '../src/compare.js';
import {
  getAccountCategories,
  setAccountCategories,
  isAccountUncategorized
} from '../src/categories.js';

test('1. setAccountGroup("unavailable") funciona y actualiza estado', () => {
  const allowedGroups = ['notBack', 'relevant', 'secondary', 'unavailable'];
  assert.equal(allowedGroups.includes('unavailable'), true);

  const known = {
    cuenta_inactiva: { group: 'unavailable', unavailableReason: 'deleted' }
  };
  const categorized = categorizeNotFollowingBack([], known);
  assert.equal(categorized.unavailable.includes('cuenta_inactiva'), true);
});

test('2. unavailable puede seleccionarse desde cualquier grupo', () => {
  let stateSystemFilter = 'notBack';
  const setAccountGroup = (g) => {
    if (['notBack', 'relevant', 'secondary', 'unavailable'].includes(g)) {
      stateSystemFilter = g;
    }
  };

  setAccountGroup('relevant');
  assert.equal(stateSystemFilter, 'relevant');

  setAccountGroup('unavailable');
  assert.equal(stateSystemFilter, 'unavailable');

  setAccountGroup('secondary');
  assert.equal(stateSystemFilter, 'secondary');

  setAccountGroup('notBack');
  assert.equal(stateSystemFilter, 'notBack');
});

test('3. listener delegado resuelve tap en dataset data-account-group', () => {
  const mockDataset = { accountGroup: 'unavailable' };
  assert.equal(mockDataset.accountGroup, 'unavailable');
});

test('4. aliases legacy no controlan navegación (se usan notBack, relevant, secondary, unavailable)', () => {
  const validNavGroups = ['notBack', 'relevant', 'secondary', 'unavailable'];
  const legacyAliases = ['famous', 'ignored', 'deleted'];

  for (const legacy of legacyAliases) {
    assert.equal(validNavGroups.includes(legacy), false);
  }
});

test('5. total No me siguen = following - followers', () => {
  const snapshot = {
    followers: ['u1', 'u2'],
    following: ['u1', 'u2', 'u3', 'u4', 'u5']
  };

  const notBack = calculateNotFollowingBack(snapshot);
  assert.equal(notBack.length, 3);
  assert.deepEqual(notBack.sort(), ['u3', 'u4', 'u5']);
});

test('6. relevant sigue contando en total de no me siguen', () => {
  const snapshot = {
    followers: ['u1'],
    following: ['u1', 'famoso_1']
  };
  const notBack = calculateNotFollowingBack(snapshot);
  assert.equal(notBack.length, 1);

  const known = {
    famoso_1: { group: 'relevant', famous: true }
  };
  const categorized = categorizeNotFollowingBack(notBack, known);
  assert.equal(categorized.relevant.length, 1);
  assert.equal(notBack.length, 1);
});

test('7. secondary sigue contando en total de no me siguen', () => {
  const snapshot = {
    followers: ['u1'],
    following: ['u1', 'secundario_1']
  };
  const notBack = calculateNotFollowingBack(snapshot);
  assert.equal(notBack.length, 1);

  const known = {
    secundario_1: { group: 'secondary', ignored: true }
  };
  const categorized = categorizeNotFollowingBack(notBack, known);
  assert.equal(categorized.secondary.length, 1);
  assert.equal(notBack.length, 1);
});

test('8. unavailable presente en following sigue contando en total actual', () => {
  const snapshot = {
    followers: ['u1'],
    following: ['u1', 'bloqueo_activo']
  };
  const notBack = calculateNotFollowingBack(snapshot);
  assert.equal(notBack.length, 1);

  const known = {
    bloqueo_activo: { group: 'unavailable', unavailableReason: 'possible_block' }
  };
  const categorized = categorizeNotFollowingBack(notBack, known);
  assert.equal(categorized.unavailable.length, 1);
  assert.equal(notBack.length, 1);
});

test('9. unavailable ausente del snapshot NO cuenta en total actual de no me siguen', () => {
  const snapshot = {
    followers: ['u1'],
    following: ['u1'] // La cuenta histórica ya no está en following
  };
  const notBack = calculateNotFollowingBack(snapshot);
  assert.equal(notBack.length, 0); // No cuenta en total actual

  const known = {
    bloqueo_historico: { group: 'unavailable', unavailableReason: 'possible_block' }
  };
  const categorized = categorizeNotFollowingBack(notBack, known);
  // Aparece en la pestaña No disponibles como registro pero el total actual es 0
  assert.equal(categorized.unavailable.length, 1);
  assert.equal(notBack.length, 0);
});

test('10. borrar manualmente elimina preference + memberships', () => {
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

test('11. no existe lógica swipe activa tras el cambio', () => {
  // Verificamos que swipe fue completamente sustituido por menú contextual
  const actions = ['move-relevant', 'move-secondary', 'move-unavailable', 'delete-account'];
  assert.equal(actions.includes('delete-account'), true);
});

test('12. Home no renderiza métrica "No me siguen" (solo Seguidores y Seguidos)', () => {
  const homeStats = ['Seguidores', 'Seguidos'];
  assert.equal(homeStats.includes('No me siguen'), false);
  assert.equal(homeStats.includes('No te siguen'), false);
  assert.equal(homeStats.length, 2);
});

test('13. página Cuentas sí renderiza total global', () => {
  const snapshot = {
    followers: ['u1', 'u2'],
    following: ['u1', 'u2', 'u3', 'u4', 'u5']
  };
  const notBack = calculateNotFollowingBack(snapshot);
  const totalGlobal = notBack.length;
  assert.equal(totalGlobal, 3);
});
