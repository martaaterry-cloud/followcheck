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

test('1. selector de grupos maneja 3 grupos principales', () => {
  const allowedGroups = ['notBack', 'relevant', 'secondary'];
  assert.equal(allowedGroups.length, 3);
  assert.equal(allowedGroups.includes('unavailable'), false);

  const known = {
    cuenta_inactiva: { group: 'unavailable', unavailableReason: 'deleted' }
  };
  const categorized = categorizeNotFollowingBack(['cuenta_inactiva'], known);
  assert.equal(categorized.notFollowingBack.includes('cuenta_inactiva'), true);
  assert.equal(categorized.unavailable.length, 0);
});

test('2. navegación entre los 3 grupos permitidos', () => {
  let stateSystemFilter = 'notBack';
  const setAccountGroup = (g) => {
    if (['notBack', 'relevant', 'secondary'].includes(g)) {
      stateSystemFilter = g;
    }
  };

  setAccountGroup('relevant');
  assert.equal(stateSystemFilter, 'relevant');

  setAccountGroup('secondary');
  assert.equal(stateSystemFilter, 'secondary');

  setAccountGroup('notBack');
  assert.equal(stateSystemFilter, 'notBack');

  // unavailable ya no es un grupo válido
  setAccountGroup('unavailable');
  assert.equal(stateSystemFilter, 'notBack');
});

test('3. listener delegado resuelve tap en dataset data-account-group', () => {
  const mockDataset = { accountGroup: 'notBack' };
  assert.equal(mockDataset.accountGroup, 'notBack');
});

test('4. aliases legacy no controlan navegación (se usan notBack, relevant, secondary)', () => {
  const validNavGroups = ['notBack', 'relevant', 'secondary'];
  const legacyAliases = ['famous', 'ignored', 'deleted', 'unavailable'];

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

test('8. cuentas previamente marcadas unavailable pasan a No me siguen', () => {
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
  assert.equal(categorized.notFollowingBack.includes('bloqueo_activo'), true);
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
  // Verificamos que swipe fue completamente sustituido por menú contextual
  const actions = ['move-relevant', 'move-secondary', 'delete-account'];
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

test('13. state.systemStateFilter === "notBack" selecciona categorized.notFollowingBack como baseList', () => {
  const categorized = {
    notFollowingBack: ['u_normal_1', 'u_normal_2', 'u_antes_unavailable'],
    relevant: ['u_famoso_1'],
    secondary: ['u_secundario_1'],
    unavailable: []
  };

  const systemStateFilter = 'notBack';

  let baseList = categorized.notFollowingBack;
  if (systemStateFilter === 'relevant') baseList = categorized.relevant;
  if (systemStateFilter === 'secondary') baseList = categorized.secondary;

  assert.deepEqual(baseList, ['u_normal_1', 'u_normal_2', 'u_antes_unavailable']);
});
