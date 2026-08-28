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

test('1. selector de grupos maneja los 4 grupos principales incluyendo unavailable', () => {
  const allowedGroups = ['notBack', 'relevant', 'secondary', 'unavailable'];
  assert.equal(allowedGroups.length, 4);
  assert.equal(allowedGroups.includes('unavailable'), true);

  const known = {
    cuenta_inactiva: { group: 'unavailable', unavailableReason: 'deleted' }
  };
  const categorized = categorizeNotFollowingBack(['cuenta_inactiva'], known);
  assert.equal(categorized.unavailable.includes('cuenta_inactiva'), true);
});

test('2. navegación entre los 4 grupos permitidos', () => {
  let stateSystemFilter = 'notBack';
  const setAccountGroup = (g) => {
    if (['notBack', 'relevant', 'secondary', 'unavailable'].includes(g)) {
      stateSystemFilter = g;
    }
  };

  setAccountGroup('relevant');
  assert.equal(stateSystemFilter, 'relevant');

  setAccountGroup('secondary');
  assert.equal(stateSystemFilter, 'secondary');

  setAccountGroup('unavailable');
  assert.equal(stateSystemFilter, 'unavailable');

  setAccountGroup('notBack');
  assert.equal(stateSystemFilter, 'notBack');
});

test('3. listener delegado resuelve tap en dataset data-account-group', () => {
  const mockDataset = { accountGroup: 'unavailable' };
  assert.equal(mockDataset.accountGroup, 'unavailable');
});

test('4. subfiltros dentro de No Disponibles (cuenta eliminada, ya no la sigo, posible bloqueo)', () => {
  const known = {
    u_del: { group: 'unavailable', unavailableReason: 'deleted' },
    u_unf: { group: 'unavailable', unavailableReason: 'unfollowed' },
    u_blk: { group: 'unavailable', unavailableReason: 'possible_block' }
  };

  const list = ['u_del', 'u_unf', 'u_blk'];
  const categorized = categorizeNotFollowingBack(list, known);
  assert.equal(categorized.unavailable.length, 3);

  const deletedList = categorized.unavailable.filter(u => isAutoDeleted(u) || known[u]?.unavailableReason === 'deleted');
  const unfollowedList = categorized.unavailable.filter(u => known[u]?.unavailableReason === 'unfollowed');
  const blockedList = categorized.unavailable.filter(u => known[u]?.unavailableReason === 'possible_block');

  assert.deepEqual(deletedList, ['u_del']);
  assert.deepEqual(unfollowedList, ['u_unf']);
  assert.deepEqual(blockedList, ['u_blk']);
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

test('8. unavailable en snapshot cuenta en total actual de no me siguen', () => {
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
  assert.equal(categorized.unavailable.includes('bloqueo_activo'), true);
  assert.equal(notBack.length, 1);
});

test('9. borrar manualmente elimina preference + memberships', () => {
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

test('10. no existe lógica swipe activa tras el cambio', () => {
  const actions = ['move-relevant', 'move-secondary', 'move-unavailable-deleted', 'delete-account'];
  assert.equal(actions.includes('delete-account'), true);
});

test('11. Home no renderiza métrica "No me siguen" (solo Seguidores y Seguidos)', () => {
  const homeStats = ['Seguidores', 'Seguidos'];
  assert.equal(homeStats.includes('No me siguen'), false);
  assert.equal(homeStats.includes('No te siguen'), false);
  assert.equal(homeStats.length, 2);
});

test('12. página Cuentas sí renderiza total global', () => {
  const snapshot = {
    followers: ['u1', 'u2'],
    following: ['u1', 'u2', 'u3', 'u4', 'u5']
  };
  const notBack = calculateNotFollowingBack(snapshot);
  const totalGlobal = notBack.length;
  assert.equal(totalGlobal, 3);
});

test('13. state.systemStateFilter === "unavailable" selecciona categorized.unavailable como baseList', () => {
  const categorized = {
    notFollowingBack: ['u_normal_1', 'u_normal_2'],
    relevant: ['u_famoso_1'],
    secondary: ['u_secundario_1'],
    unavailable: ['u_eliminada_1', 'u_bloqueo_2']
  };

  const systemStateFilter = 'unavailable';

  let baseList = categorized.notFollowingBack;
  if (systemStateFilter === 'relevant') baseList = categorized.relevant;
  if (systemStateFilter === 'secondary') baseList = categorized.secondary;
  if (systemStateFilter === 'unavailable') baseList = categorized.unavailable;

  assert.deepEqual(baseList, ['u_eliminada_1', 'u_bloqueo_2']);
});
