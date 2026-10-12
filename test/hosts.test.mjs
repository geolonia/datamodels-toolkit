// The files for hosts other than GitHub Pages (hosts.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirectsFile, redirectsNote, CLOUDFLARE_REDIRECTS } from '../src/build/hosts.mjs';

test('redirectsNote: a note only when Cloudflare would ignore redirects', () => {
  assert.equal(redirectsNote(0), null);
  assert.equal(redirectsNote(CLOUDFLARE_REDIRECTS), null);
  const note = redirectsNote(CLOUDFLARE_REDIRECTS + 1);
  assert.match(note, /2001 IRI redirects/);
  assert.match(note, /at most 2000/);
  assert.match(note, /Bulk Redirects/);
});

test('redirectsFile: one 302 line per redirect, none without redirects', () => {
  assert.equal(redirectsFile([]), null);
  const lines = redirectsFile([['/ns/a/', '/models/a/']]).split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, ['/ns/a/ /models/a/ 302']);
});
