import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword } from '../src/auth.js';

test('validatePassword: valida contraseña correcta', () => {
  const res = validatePassword('123456', '123456');
  assert.equal(res.valid, true);
  assert.equal(res.message, '');
});

test('validatePassword: exige longitud mínima de 6 caracteres', () => {
  const res = validatePassword('12345', '12345');
  assert.equal(res.valid, false);
  assert.match(res.message, /6 caracteres/i);
});

test('validatePassword: detecta no coincidencia en confirmación', () => {
  const res = validatePassword('password123', 'password456');
  assert.equal(res.valid, false);
  assert.match(res.message, /no coinciden/i);
});

test('validatePassword: no exige confirmación si no se pasa', () => {
  const res = validatePassword('password123');
  assert.equal(res.valid, true);
});
