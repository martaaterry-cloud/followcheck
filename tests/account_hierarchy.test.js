import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccountRecord,
  classifyAccount,
  categorizeNotFollowingBack,
  resolveAccountGroup,
  isAutoDeleted
} from '../src/accounts.js';
import {
  knownAccountToPreferenceRow,
  preferenceRowToKnownAccount,
  reconcilePreferences
} from '../src/sync.js';
import {
  getAccountCategories,
  setAccountCategories,
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

test('7. unavailable no aparece en No me siguen', () => {
  let known = {
    cuenta_baja: { group: 'unavailable' }
  };

  const categorized = categorizeNotFollowingBack(['cuenta_baja', 'cuenta_normal'], known);
  assert.deepEqual(categorized.unavailable, ['cuenta_baja']);
  assert.deepEqual(categorized.notFollowingBack, ['cuenta_normal']);
  assert.equal(categorized.notFollowingBack.includes('cuenta_baja'), false);
});

test('8. __deleted__ entra automáticamente en unavailable con reason deleted', () => {
  const username = '__deleted__999';
  assert.equal(isAutoDeleted(username), true);

  const rec = createAccountRecord(username);
  assert.equal(rec.group, 'unavailable');
  assert.equal(rec.unavailableReason, 'deleted');

  const categorized = categorizeNotFollowingBack([username], {});
  assert.deepEqual(categorized.unavailable, [username]);
  assert.equal(categorized.notFollowingBack.length, 0);
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
