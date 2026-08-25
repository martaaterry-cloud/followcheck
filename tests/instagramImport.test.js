import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractUsername, parseInstagramZip } from '../src/instagramImport.js';

test('extractUsername: extrae usuario de string_list_data value', () => {
  const entry = {
    title: '',
    string_list_data: [{ value: 'User_Test1', href: 'https://www.instagram.com/user_test1', timestamp: 123456789 }]
  };
  assert.equal(extractUsername(entry), 'user_test1');
});

test('extractUsername: extrae usuario desde href si value no está disponible', () => {
  const entry = {
    title: '',
    string_list_data: [{ href: 'https://www.instagram.com/_u/user_href_test?igsh=123', timestamp: 123456789 }]
  };
  assert.equal(extractUsername(entry), 'user_href_test');
});

test('extractUsername: preserva formato de cuentas __deleted__', () => {
  const entry = {
    string_list_data: [{ value: '__deleted__12345abc' }]
  };
  assert.equal(extractUsername(entry), '__deleted__12345abc');
});

test('parseInstagramZip: parsea ZIP con múltiples followers_*.json, deduplica y extrae seguidos', async () => {
  const zip = new JSZip();

  const followingJson = JSON.stringify({
    relationships_following: [
      { string_list_data: [{ value: 'seguido_1' }] },
      { string_list_data: [{ value: 'seguido_2' }] },
      { string_list_data: [{ value: '__deleted__user_99' }] }
    ]
  });

  const followers1Json = JSON.stringify([
    { string_list_data: [{ value: 'follower_1' }] },
    { string_list_data: [{ value: 'follower_2' }] },
    { string_list_data: [{ value: 'follower_1' }] } // duplicado intencionado
  ]);

  const followers2Json = JSON.stringify([
    { string_list_data: [{ value: 'follower_2' }] }, // duplicado entre archivos
    { string_list_data: [{ value: 'follower_3' }] },
    { string_list_data: [{ value: '__deleted__user_99' }] }
  ]);

  zip.file('connections/followers_and_following/following.json', followingJson);
  zip.file('connections/followers_and_following/followers_1.json', followers1Json);
  zip.file('connections/followers_and_following/followers_2.json', followers2Json);

  const zipBlob = await zip.generateAsync({ type: 'nodebuffer' });
  const result = await parseInstagramZip(zipBlob);

  assert.deepEqual(result.following, ['seguido_1', 'seguido_2', '__deleted__user_99']);
  assert.deepEqual(result.followers, ['follower_1', 'follower_2', 'follower_3', '__deleted__user_99']);
  assert.ok(result.importedAt);
});

test('parseInstagramZip: lanza error con ZIP inválido o sin JSONs requeridos', async () => {
  const zip = new JSZip();
  zip.file('other_file.txt', 'test');
  const zipBlob = await zip.generateAsync({ type: 'nodebuffer' });

  await assert.rejects(
    async () => {
      await parseInstagramZip(zipBlob);
    },
    /El ZIP no contiene Seguidores y seguidos en formato JSON/
  );
});
