import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUsername,
  isAutoDeleted,
  createAccountRecord,
  syncKnownAccounts,
  classifyAccount,
  categorizeNotFollowingBack,
  evaluateAccountAutoFamous
} from '../src/accounts.js';
import { compareSnapshots, calculateNotFollowingBack } from '../src/compare.js';

test('1. Cuenta de lista conocida → famous automático (famousSource = auto)', () => {
  const snapshot = {
    followers: ['ana'],
    following: ['ana', 'spotify']
  };

  const synced = syncKnownAccounts({}, snapshot);
  assert.equal(synced['spotify']?.famous, true);
  assert.equal(synced['spotify']?.famousSource, 'auto');
  assert.ok(synced['spotify']?.autoFamousConfidence >= 0.90);
  assert.ok(synced['spotify']?.autoFamousReason.includes('Spotify'));

  const notBack = calculateNotFollowingBack(snapshot);
  const categorized = categorizeNotFollowingBack(notBack, synced);
  assert.deepEqual(categorized.famous, ['spotify']);
  assert.deepEqual(categorized.notFollowingBack, []);
});

test('2. Cuenta desconocida → normal (famous = false, confidence = 0)', () => {
  const snapshot = {
    followers: ['ana'],
    following: ['ana', 'persona_desconocida_xyz']
  };

  const synced = syncKnownAccounts({}, snapshot);
  assert.equal(synced['persona_desconocida_xyz']?.famous, false);
  assert.equal(synced['persona_desconocida_xyz']?.famousSource, null);
  assert.equal(synced['persona_desconocida_xyz']?.autoFamousConfidence, 0.0);

  const notBack = calculateNotFollowingBack(snapshot);
  const categorized = categorizeNotFollowingBack(notBack, synced);
  assert.deepEqual(categorized.notFollowingBack, ['persona_desconocida_xyz']);
  assert.deepEqual(categorized.famous, []);
});

test('3. Famous manual prevalece sobre automático', () => {
  let knownAccounts = {
    'nike': createAccountRecord('nike', {
      famous: true,
      famousSource: 'manual'
    })
  };

  const snapshot = {
    followers: ['user1'],
    following: ['user1', 'nike']
  };

  const synced = syncKnownAccounts(knownAccounts, snapshot);
  assert.equal(synced['nike']?.famous, true);
  assert.equal(synced['nike']?.famousSource, 'manual');
});

test('4. Ignored prevalece sobre famous automático', () => {
  let knownAccounts = {
    'netflix': createAccountRecord('netflix', {
      ignored: true
    })
  };

  const snapshot = {
    followers: ['user1'],
    following: ['user1', 'netflix']
  };

  const synced = syncKnownAccounts(knownAccounts, snapshot);
  assert.equal(synced['netflix']?.ignored, true);
  assert.equal(synced['netflix']?.famous, false);

  const notBack = calculateNotFollowingBack(snapshot);
  const categorized = categorizeNotFollowingBack(notBack, synced);
  assert.deepEqual(categorized.ignored, ['netflix']);
  assert.deepEqual(categorized.famous, []);
});

test('5. Deleted prevalece y pasa a No me siguen', () => {
  let knownAccounts = {
    'badbunnypr': createAccountRecord('badbunnypr', {
      deleted: true
    })
  };

  const snapshot = {
    followers: ['user1'],
    following: ['user1', 'badbunnypr', '__deleted__artist']
  };

  const synced = syncKnownAccounts(knownAccounts, snapshot);
  assert.equal(synced['badbunnypr']?.deleted, true);
  assert.equal(synced['badbunnypr']?.famous, false);
  assert.equal(synced['__deleted__artist']?.deleted, true);

  const notBack = calculateNotFollowingBack(snapshot);
  const categorized = categorizeNotFollowingBack(notBack, synced);
  assert.ok(categorized.notFollowingBack.includes('badbunnypr'));
  assert.ok(categorized.notFollowingBack.includes('__deleted__artist'));
  assert.deepEqual(categorized.famous, []);
});


test('6. autoFamousDismissed evita reclasificación futura', () => {
  let knownAccounts = {
    'zara': createAccountRecord('zara', {
      famous: true,
      famousSource: 'auto'
    })
  };

  // El usuario la restaura a No me siguen
  knownAccounts = classifyAccount(knownAccounts, 'zara', { restore: true });
  assert.equal(knownAccounts['zara'].famous, false);
  assert.equal(knownAccounts['zara'].autoFamousDismissed, true);

  // Nueva importación con nuevo snapshot
  const nextSnapshot = {
    followers: ['amigo'],
    following: ['amigo', 'zara']
  };

  const synced = syncKnownAccounts(knownAccounts, nextSnapshot);
  assert.equal(synced['zara'].famous, false);
  assert.equal(synced['zara'].autoFamousDismissed, true);

  const notBack = calculateNotFollowingBack(nextSnapshot);
  const categorized = categorizeNotFollowingBack(notBack, synced);
  assert.deepEqual(categorized.notFollowingBack, ['zara']);
  assert.deepEqual(categorized.famous, []);
});

test('7. Confianza media no mueve automáticamente a famosas pero genera sugerencia', () => {
  // Creamos una cuenta con confianza 0.70 (rango 0.60 .. 0.89)
  let knownAccounts = {
    'cuenta_intermedia': createAccountRecord('cuenta_intermedia', {
      autoFamousConfidence: 0.70,
      autoFamousReason: 'Posible creador relevante',
      autoFamousCheckedAt: new Date().toISOString()
    })
  };

  const notBack = ['cuenta_intermedia'];
  const categorized = categorizeNotFollowingBack(notBack, knownAccounts);

  assert.deepEqual(categorized.notFollowingBack, ['cuenta_intermedia']);
  assert.deepEqual(categorized.famous, []);
  assert.deepEqual(categorized.suggestions, ['cuenta_intermedia']);

  // Descartar sugerencia
  knownAccounts = classifyAccount(knownAccounts, 'cuenta_intermedia', { dismissSuggestion: true });
  assert.equal(knownAccounts['cuenta_intermedia'].autoFamousDismissed, true);

  const categorizedAfterDismiss = categorizeNotFollowingBack(notBack, knownAccounts);
  assert.deepEqual(categorizedAfterDismiss.suggestions, []);
});

test('8. syncKnownAccounts conserva resultados anteriores y sólo evalúa no analizadas', () => {
  const previousCheckedDate = '2026-08-20T10:00:00.000Z';
  let knownAccounts = {
    'shakira': createAccountRecord('shakira', {
      famous: true,
      famousSource: 'auto',
      autoFamousCheckedAt: previousCheckedDate
    })
  };

  const newSnapshot = {
    followers: ['fan1'],
    following: ['fan1', 'shakira', 'leomessi']
  };

  const synced = syncKnownAccounts(knownAccounts, newSnapshot);
  // Shakira mantuvo su checkedAt anterior
  assert.equal(synced['shakira'].autoFamousCheckedAt, previousCheckedDate);
  // Leo Messi fue evaluado ahora
  assert.equal(synced['leomessi'].famous, true);
  assert.equal(synced['leomessi'].famousSource, 'auto');
  assert.ok(synced['leomessi'].autoFamousCheckedAt !== null);
});

test('9. Datos antiguos de Fase A sin campos de Fase B siguen cargando correctamente', () => {
  // Formato Fase A: sin famousSource, sin autoFamousConfidence, etc.
  const phaseAAccounts = {
    'usuario_viejo': {
      status: 'normal',
      famous: false,
      ignored: false,
      deleted: false,
      note: '',
      firstSeen: '2026-08-01T00:00:00.000Z',
      lastSeen: '2026-08-01T00:00:00.000Z'
    },
    'famosa_vieja': {
      status: 'normal',
      famous: true,
      ignored: false,
      deleted: false,
      note: '',
      firstSeen: '2026-08-01T00:00:00.000Z',
      lastSeen: '2026-08-01T00:00:00.000Z'
    }
  };

  const notBack = ['usuario_viejo', 'famosa_vieja', 'adidas'];
  const snapshot = {
    followers: ['u1'],
    following: ['u1', ...notBack]
  };

  const synced = syncKnownAccounts(phaseAAccounts, snapshot);
  assert.equal(synced['usuario_viejo'].famous, false);
  assert.equal(synced['famosa_vieja'].famous, true);
  assert.equal(synced['adidas'].famous, true);
  assert.equal(synced['adidas'].famousSource, 'auto');

  const categorized = categorizeNotFollowingBack(notBack, synced);
  assert.ok(categorized.famous.includes('famosa_vieja'));
  assert.ok(categorized.famous.includes('adidas'));
  assert.ok(categorized.notFollowingBack.includes('usuario_viejo'));
});
