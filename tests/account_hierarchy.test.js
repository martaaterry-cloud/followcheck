import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccountRecord,
  classifyAccount,
  categorizeNotFollowingBack,
  resolveAccountGroup,
  isAutoDeleted,
  instagramProfileUrl
} from '../src/accounts.js';
import {
  knownAccountToPreferenceRow,
  preferenceRowToKnownAccount,
  reconcilePreferences
} from '../src/sync.js';
import {
  getAccountCategories,
  setAccountCategories,
  toggleAccountCategory,
  isAccountUncategorized,
  countAccountsPerCategory
} from '../src/categories.js';

test('1. famous antiguo migra a relevant', () => {
  const legacyFamous = {
    famous: true,
    famousSource: 'manual',
    ignored: false,
    deleted: false
  };

  assert.equal(resolveAccountGroup(legacyFamous), 'relevant');

  const rec = createAccountRecord('usuario_famoso', legacyFamous);
  assert.equal(rec.group, 'relevant');
  assert.equal(rec.famous, true);

  const row = knownAccountToPreferenceRow('u1', 'usuario_famoso', legacyFamous);
  assert.equal(row.account_group, 'relevant');

  const loaded = preferenceRowToKnownAccount(row);
  assert.equal(loaded.group, 'relevant');
  assert.equal(loaded.famous, true);
});

test('2. ignored antiguo migra a secondary', () => {
  const legacyIgnored = {
    famous: false,
    ignored: true,
    deleted: false
  };

  assert.equal(resolveAccountGroup(legacyIgnored), 'secondary');

  const rec = createAccountRecord('usuario_ignorado', legacyIgnored);
  assert.equal(rec.group, 'secondary');
  assert.equal(rec.ignored, true);

  const row = knownAccountToPreferenceRow('u1', 'usuario_ignorado', legacyIgnored);
  assert.equal(row.account_group, 'secondary');

  const loaded = preferenceRowToKnownAccount(row);
  assert.equal(loaded.group, 'secondary');
});

test('3. deleted antiguo migra a unavailable', () => {
  const legacyDeleted = {
    famous: false,
    ignored: false,
    deleted: true
  };

  assert.equal(resolveAccountGroup(legacyDeleted), 'unavailable');

  const rec = createAccountRecord('usuario_eliminado', legacyDeleted);
  assert.equal(rec.group, 'unavailable');
  assert.equal(rec.deleted, true);

  const row = knownAccountToPreferenceRow('u1', 'usuario_eliminado', legacyDeleted);
  assert.equal(row.account_group, 'unavailable');

  const loaded = preferenceRowToKnownAccount(row);
  assert.equal(loaded.group, 'unavailable');
});

test('4. normal permanece normal', () => {
  const normalAcc = {
    famous: false,
    ignored: false,
    deleted: false
  };

  assert.equal(resolveAccountGroup(normalAcc), 'normal');

  const rec = createAccountRecord('usuario_normal', normalAcc);
  assert.equal(rec.group, 'normal');

  const row = knownAccountToPreferenceRow('u1', 'usuario_normal', normalAcc);
  assert.equal(row.account_group, 'normal');
  assert.equal(row.unavailable_reason, null);

  const loaded = preferenceRowToKnownAccount(row);
  assert.equal(loaded.group, 'normal');
});

test('5. relevant puede tener múltiples subcategorías', () => {
  let memberships = {};
  memberships = setAccountCategories(memberships, 'atleta_top', ['cat_futbol', 'cat_fitness', 'cat_influencers']);

  const cats = getAccountCategories(memberships, 'atleta_top');
  assert.deepEqual(cats, ['cat_futbol', 'cat_fitness', 'cat_influencers']);
});

test('6. secondary no aparece en No me siguen', () => {
  let known = {
    cuenta_secundaria: { group: 'secondary' }
  };

  const categorized = categorizeNotFollowingBack(['cuenta_secundaria', 'cuenta_normal'], known);
  assert.deepEqual(categorized.secondary, ['cuenta_secundaria']);
  assert.deepEqual(categorized.notFollowingBack, ['cuenta_normal']);
  assert.equal(categorized.notFollowingBack.includes('cuenta_secundaria'), false);
});

test('7. cuentas antes en unavailable o deleted pasan a No me siguen', () => {
  let known = {
    cuenta_baja: { group: 'unavailable' }
  };

  const categorized = categorizeNotFollowingBack(['cuenta_baja', 'cuenta_normal'], known);
  assert.deepEqual(categorized.notFollowingBack, ['cuenta_baja', 'cuenta_normal']);
});

test('8. __deleted__ se clasifica y pasa a No me siguen al no haber pestaña unavailable', () => {
  const username = '__deleted__999';
  assert.equal(isAutoDeleted(username), true);

  const categorized = categorizeNotFollowingBack([username], {});
  assert.deepEqual(categorized.notFollowingBack, [username]);
});


test('9. possible_block se guarda solo manualmente', () => {
  let known = {};
  known = classifyAccount(known, 'usuario_sospechoso', { group: 'unavailable', possibleBlock: true });

  assert.equal(known.usuario_sospechoso.group, 'unavailable');
  assert.equal(known.usuario_sospechoso.unavailableReason, 'possible_block');
});

test('10. no se afirma bloqueo automáticamente en el detector o creación inicial', () => {
  const rec = createAccountRecord('usuario_nuevo');
  assert.equal(rec.unavailableReason, null);

  const recDel = createAccountRecord('__deleted__123');
  assert.equal(recDel.unavailableReason, 'deleted'); // No possible_block
});

test('11. memberships existentes sobreviven a la migración', () => {
  const existingMemberships = {
    usuario_pro: ['cat_balonmano', 'cat_marcas']
  };

  const cats = getAccountCategories(existingMemberships, 'usuario_pro');
  assert.deepEqual(cats, ['cat_balonmano', 'cat_marcas']);
  assert.equal(isAccountUncategorized(existingMemberships, 'usuario_pro'), false);
});

test('12. subcategorías se contabilizan y filtran correctamente en el grupo Relevantes', () => {
  const categories = [
    { id: 'cat_futbol', name: 'Fútbol' },
    { id: 'cat_balonmano', name: 'Balonmano' }
  ];

  const relevantList = ['jugador1', 'jugador2', 'sin_cat'];
  const memberships = {
    jugador1: ['cat_futbol'],
    jugador2: ['cat_balonmano', 'cat_futbol']
  };

  const counts = countAccountsPerCategory(relevantList, memberships, categories);
  assert.equal(counts.all, 3);
  assert.equal(counts.uncategorized, 1);
  assert.equal(counts.cat_futbol, 2);
  assert.equal(counts.cat_balonmano, 1);
});

// NUEVOS TESTS UX FASE E.1

test('13. cambiar activeGroup actualiza grupo entre los 3 grupos principales', () => {
  let known = {};
  known = classifyAccount(known, 'user_a', { group: 'relevant' });
  known = classifyAccount(known, 'user_b', { group: 'secondary' });
  known = classifyAccount(known, 'user_c', { group: 'unavailable' });
  known = classifyAccount(known, 'user_d', { group: 'normal' });

  const allUsers = ['user_a', 'user_b', 'user_c', 'user_d'];
  const categorized = categorizeNotFollowingBack(allUsers, known);

  assert.deepEqual(categorized.relevant, ['user_a']);
  assert.deepEqual(categorized.secondary, ['user_b']);
  assert.deepEqual(categorized.notFollowingBack, ['user_c', 'user_d']);

  // Mover user_a de vuelta a 'normal' (No me siguen)
  known = classifyAccount(known, 'user_a', { group: 'normal' });
  const reCategorized = categorizeNotFollowingBack(allUsers, known);
  assert.equal(reCategorized.notFollowingBack.includes('user_a'), true);
  assert.equal(reCategorized.relevant.includes('user_a'), false);
});


test('14. cuenta relevante sin membership aparece en Sin categoría', () => {
  const memberships = {};
  assert.equal(isAccountUncategorized(memberships, 'celebrity_1'), true);

  const categories = [{ id: 'cat_fit', name: 'Gimnasio' }];
  const counts = countAccountsPerCategory(['celebrity_1'], memberships, categories);
  assert.equal(counts.uncategorized, 1);
  assert.equal(counts.cat_fit, 0);
});

test('15. asignar subcategoría mueve contador y permite asignar múltiples subcategorías', () => {
  const categories = [
    { id: 'cat_balonmano', name: 'Balonmano' },
    { id: 'cat_influencers', name: 'Influencers' }
  ];

  let memberships = {};
  // Asignar Balonmano
  memberships = toggleAccountCategory(memberships, 'estrella', 'cat_balonmano');
  assert.equal(isAccountUncategorized(memberships, 'estrella'), false);

  let counts = countAccountsPerCategory(['estrella'], memberships, categories);
  assert.equal(counts.cat_balonmano, 1);
  assert.equal(counts.cat_influencers, 0);
  assert.equal(counts.uncategorized, 0);

  // Asignar también Influencers
  memberships = toggleAccountCategory(memberships, 'estrella', 'cat_influencers');
  counts = countAccountsPerCategory(['estrella'], memberships, categories);
  assert.equal(counts.cat_balonmano, 1);
  assert.equal(counts.cat_influencers, 1);
  assert.equal(counts.uncategorized, 0);
});

test('16. quitar todas las subcategorías vuelve a Sin categoría', () => {
  const categories = [{ id: 'cat_futbol', name: 'Fútbol' }];
  let memberships = {
    jugador: ['cat_futbol']
  };

  assert.equal(isAccountUncategorized(memberships, 'jugador'), false);

  // Desmarcar
  memberships = toggleAccountCategory(memberships, 'jugador', 'cat_futbol');
  assert.equal(isAccountUncategorized(memberships, 'jugador'), true);

  const counts = countAccountsPerCategory(['jugador'], memberships, categories);
  assert.equal(counts.uncategorized, 1);
  assert.equal(counts.cat_futbol, 0);
});

test('17. organizar no cambia account_group', () => {
  let known = {
    jugador: { group: 'relevant', famous: true }
  };
  let memberships = {};

  memberships = toggleAccountCategory(memberships, 'jugador', 'cat_futbol');
  assert.equal(known.jugador.group, 'relevant');
  assert.deepEqual(getAccountCategories(memberships, 'jugador'), ['cat_futbol']);
});

test('18. username sigue abriendo Instagram con instagramProfileUrl', () => {
  assert.equal(instagramProfileUrl('marta_terry'), 'https://www.instagram.com/marta_terry/');
  assert.equal(instagramProfileUrl('__deleted__abc'), null);
});
