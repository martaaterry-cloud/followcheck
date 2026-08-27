import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramProfileUrl } from '../src/accounts.js';
import {
  initDefaultCategories,
  addCategory,
  renameCategory,
  deleteCategory,
  getAccountCategories,
  setAccountCategories,
  toggleAccountCategory,
  isAccountUncategorized,
  countAccountsPerCategory,
  DEFAULT_CATEGORY_NAMES
} from '../src/categories.js';
import {
  loadLocalProfile,
  saveLocalProfile,
  loadLocalCategories,
  saveLocalCategories,
  loadLocalCategoryMemberships,
  saveLocalCategoryMemberships
} from '../src/storage.js';

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

test('instagramProfileUrl genera URL oficial para cuentas válidas y null para __deleted__ o vacíos', () => {
  assert.equal(instagramProfileUrl('marta'), 'https://www.instagram.com/marta/');
  assert.equal(instagramProfileUrl('user.name_123'), 'https://www.instagram.com/user.name_123/');
  assert.equal(instagramProfileUrl('__deleted__abc'), null);
  assert.equal(instagramProfileUrl(''), null);
  assert.equal(instagramProfileUrl(null), null);
});

test('initDefaultCategories crea las categorías predeterminadas una sola vez', () => {
  const defaultCats = initDefaultCategories();
  assert.equal(defaultCats.length, 6);
  assert.deepEqual(defaultCats.map(c => c.name), DEFAULT_CATEGORY_NAMES);


  // Si ya existen categorías, no las sobreescribe
  const existing = [{ id: '1', name: 'Mi lista', sortOrder: 0 }];
  const kept = initDefaultCategories(existing);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].name, 'Mi lista');
});

test('addCategory añade una nueva categoría y previene nombres duplicados', () => {
  let cats = initDefaultCategories();
  cats = addCategory(cats, 'Gimnasio');

  assert.equal(cats.some(c => c.name === 'Gimnasio'), true);

  assert.throws(() => {
    addCategory(cats, 'gimnasio'); // Duplicado case-insensitive
  }, /Ya existe una categoría/i);

  assert.throws(() => {
    addCategory(cats, '   ');
  }, /Introduce un nombre/i);
});

test('renameCategory renombra correctamente y valida colisiones', () => {
  let cats = initDefaultCategories();
  const catId = cats[0].id;
  cats = renameCategory(cats, catId, 'Cuentas alternas');

  assert.equal(cats.find(c => c.id === catId).name, 'Cuentas alternas');

  assert.throws(() => {
    renameCategory(cats, catId, 'Balonmano'); // Ya existe en cats[1]
  }, /Ya existe otra categoría/i);
});

test('deleteCategory elimina la categoría y limpia memberships sin borrar cuentas', () => {
  let cats = initDefaultCategories();
  const catToDelete = cats[0].id;
  const otherCat = cats[1].id;

  let memberships = {
    usuario1: [catToDelete, otherCat],
    usuario2: [catToDelete]
  };

  const result = deleteCategory(cats, memberships, catToDelete);

  assert.equal(result.categories.some(c => c.id === catToDelete), false);
  assert.deepEqual(result.memberships.usuario1, [otherCat]); // Conserva la otra categoría
  assert.equal(result.memberships.usuario2, undefined); // Eliminada la clave vacía
});

test('setAccountCategories y toggleAccountCategory permiten clasificar una cuenta en múltiples categorías', () => {
  let memberships = {};
  memberships = setAccountCategories(memberships, 'atleta_1', ['cat_1', 'cat_2']);

  assert.deepEqual(getAccountCategories(memberships, 'atleta_1'), ['cat_1', 'cat_2']);

  // Toggle para quitar cat_1
  memberships = toggleAccountCategory(memberships, 'atleta_1', 'cat_1');
  assert.deepEqual(getAccountCategories(memberships, 'atleta_1'), ['cat_2']);

  // Toggle para volver a añadir cat_1
  memberships = toggleAccountCategory(memberships, 'atleta_1', 'cat_1');
  assert.deepEqual(getAccountCategories(memberships, 'atleta_1'), ['cat_2', 'cat_1']);
});

test('isAccountUncategorized detecta cuentas sin categorías asignadas', () => {
  const memberships = {
    user_con_cat: ['cat_1']
  };

  assert.equal(isAccountUncategorized(memberships, 'user_sin_cat'), true);
  assert.equal(isAccountUncategorized(memberships, 'user_con_cat'), false);
});

test('countAccountsPerCategory calcula totales correctos para all, uncategorized y categorías', () => {
  const categories = [
    { id: 'cat_futbol', name: 'Fútbol' },
    { id: 'cat_musica', name: 'Música' }
  ];

  const accounts = ['u1', 'u2', 'u3', 'u4'];
  const memberships = {
    u1: ['cat_futbol'],
    u2: ['cat_futbol', 'cat_musica'],
    u3: ['cat_musica']
    // u4 sin categoría
  };

  const counts = countAccountsPerCategory(accounts, memberships, categories);

  assert.equal(counts.all, 4);
  assert.equal(counts.uncategorized, 1); // u4
  assert.equal(counts.cat_futbol, 2); // u1, u2
  assert.equal(counts.cat_musica, 2); // u2, u3
});

test('loadLocalProfile y saveLocalProfile persisten los datos del perfil de Instagram', () => {
  localStorage.clear();
  const emptyProf = loadLocalProfile();
  assert.equal(emptyProf.instagramUsername, '');
  assert.equal(emptyProf.displayName, '');

  saveLocalProfile({ instagramUsername: 'marta_terry', displayName: 'Marta Terry' });
  const savedProf = loadLocalProfile();
  assert.equal(savedProf.instagramUsername, 'marta_terry');
  assert.equal(savedProf.displayName, 'Marta Terry');
});
