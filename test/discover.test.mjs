// datamodels nodes and search (geolonia/datamodels#222): following the links
// between indexes, and ranking the models they list. A stub stands in for fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { discoverNodes, searchModels, indexUrl, plain, words, MAX_NODES } from '../src/discover.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));

const A = 'https://a.example.org/catalog.json';
const B = 'https://b.example.org/catalog.json';
const C = 'https://c.example.org/models/catalog.json';
const link = (index) => ({ url: new URL('.', index).href, index });
const model = (type, more = {}) => ({ type, subject: 'test', kind: 'entity', typeIri: `https://x.example.org/ns/${type}`, title: { en: type }, description: { en: `A ${type}.` }, pageUrl: `https://x.example.org/${type}/`, ...more });

/** A fetch that serves `files` by URL; a function value is called instead (to fail). */
const stub = (files, seen = []) => async (url) => {
  seen.push(url);
  const f = files[url];
  if (typeof f === 'function') return f();
  return f === undefined ? new Response('not found', { status: 404 }) : new Response(JSON.stringify(f), { status: 200 });
};
const names = (r) => r.nodes.map((n) => n.name);

test('--depth: 0 reads the index alone, each further level follows the nodes it lists', async () => {
  const files = {
    [A]: { publisher: { name: { ja: 'エー', en: 'A' } }, license: 'CC0-1.0', nodes: [link(B)], models: [model('One')] },
    [B]: { publisher: { name: { ja: 'ビー' } }, nodes: [link(C)], models: [] },
    [C]: { models: [model('Two'), model('Three')] },
  };
  assert.deepEqual(names(await discoverNodes(A, { depth: 0, fetch: stub(files) })), ['A']);
  assert.deepEqual(names(await discoverNodes(A, { depth: 1, fetch: stub(files) })), ['A', 'ビー']);
  const all = await discoverNodes(A, { depth: 2, fetch: stub(files) });
  // A node without a publisher is named by its host.
  assert.deepEqual(names(all), ['A', 'ビー', 'c.example.org']);
  assert.deepEqual(all.nodes.map(({ url, index, license, depth, linkedFrom }) => ({ url, index, license, depth, linkedFrom })), [
    { url: 'https://a.example.org/', index: A, license: 'CC0-1.0', depth: 0, linkedFrom: null },
    { url: 'https://b.example.org/', index: B, license: null, depth: 1, linkedFrom: A },
    { url: 'https://c.example.org/models/', index: C, license: null, depth: 2, linkedFrom: B },
  ]);
  assert.deepEqual(all.notes, []);
});

test('the index of an extended model is followed like a listed node', async () => {
  const files = {
    [A]: { models: [model('Road', { extends: [{ typeIri: 'https://b.example.org/ns/Way', version: '1.0.0', index: B }] })] },
    [B]: { models: [model('Way')] },
  };
  assert.deepEqual(names(await discoverNodes(A, { fetch: stub(files) })), ['a.example.org', 'b.example.org']);
});

test('a cycle: every index is read once, however deep', async () => {
  const seen = [];
  const files = {
    [A]: { nodes: [link(B), link(A), link(`${B}#models`)], models: [] },
    // The same index written another way (dot segments, a #fragment, which is
    // not sent with a request) is the same index.
    [B]: { nodes: [link(A), link('https://a.example.org/x/../catalog.json'), link(`${A}#top`), link(`${B}#self`)], models: [] },
  };
  for (const start of [A, `${A}#top`]) {
    seen.length = 0;
    const r = await discoverNodes(start, { depth: 5, fetch: stub(files, seen) });
    assert.deepEqual(names(r), ['a.example.org', 'b.example.org']);
    assert.deepEqual(r.nodes.map((n) => n.index), [A, B]);
    assert.deepEqual(seen, [A, B]);
  }
});

test('a listed node keeps the address it declares, also when its index is elsewhere', async () => {
  const CDN = 'https://cdn.example.org/catalog.json';
  const files = {
    [A]: { nodes: [{ url: 'https://models.example.org/', index: CDN }, { url: 'not a URL', index: B }, { url: 'http://c.example.org/', index: C }], models: [] },
    [CDN]: { models: [model('Widget')] },
    [B]: { models: [] },
    [C]: { models: [] },
  };
  const r = await discoverNodes(A, { fetch: stub(files) });
  // Without a publisher a node is named by the host of its address; an address
  // that is not an https URL is left out, and the index's folder is used instead.
  assert.deepEqual(r.nodes.map(({ name, url, index }) => ({ name, url, index })), [
    { name: 'a.example.org', url: 'https://a.example.org/', index: A },
    { name: 'models.example.org', url: 'https://models.example.org/', index: CDN },
    { name: 'b.example.org', url: 'https://b.example.org/', index: B },
    { name: 'c.example.org', url: 'https://c.example.org/models/', index: C },
  ]);
  assert.deepEqual(searchModels('widget', r.nodes).results.map((x) => [x.site, x.nodeUrl]), [['models.example.org', 'https://models.example.org/']]);
});

test('a linked node that cannot be read is a note; the others are still read', async () => {
  const D = 'https://d.example.org/catalog.json';
  const files = {
    [A]: { nodes: [link(B), link(C), link(D), { url: 'http://e.example.org/', index: 'http://e.example.org/catalog.json' }, { url: 'https://f.example.org/', index: 'https://127.0.0.1/catalog.json' }], models: [] },
    [C]: () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); },
    [D]: { hello: 'not an index' },
  };
  const r = await discoverNodes(A, { fetch: stub(files) });
  assert.deepEqual(names(r), ['a.example.org']);
  assert.deepEqual(r.notes, [
    `${B}: HTTP 404; linked from ${A}, skipped`,
    `${C} could not be read (ENOTFOUND); linked from ${A}, skipped`,
    `${D}: not a catalog.json (no models list); linked from ${A}, skipped`,
    `http://e.example.org/catalog.json is not read: only https on a public host name; linked from ${A}, skipped`,
    `https://127.0.0.1/catalog.json is not read: only https on a public host name; linked from ${A}, skipped`,
  ]);
});

test('the index the search starts at must be read', async () => {
  await assert.rejects(discoverNodes(A, { fetch: stub({}) }), { message: `${A}: HTTP 404` });
  await assert.rejects(discoverNodes(A, { fetch: stub({ [A]: [] }) }), { message: `${A}: not a catalog.json (no models list)` });
  await assert.rejects(discoverNodes('http://localhost/catalog.json', { fetch: stub({}) }), /only https on a public host name/);
});

test(`at most ${MAX_NODES} indexes are read`, async () => {
  const many = Array.from({ length: MAX_NODES + 5 }, (_, i) => `https://n${i}.example.org/catalog.json`);
  const files = Object.fromEntries([[A, { nodes: many.map(link), models: [] }], ...many.map((u) => [u, { models: [] }])]);
  const r = await discoverNodes(A, { fetch: stub(files) });
  // The index itself and the first MAX_NODES - 1 it links to; a note for each of the other six.
  assert.equal(r.nodes.length, MAX_NODES);
  assert.equal(r.notes.length, 6);
  assert.match(r.notes[0], /not read, more than 50 indexes/);
});

test('an address is read at its /catalog.json', () => {
  assert.equal(indexUrl('https://models.example.org'), 'https://models.example.org/catalog.json');
  assert.equal(indexUrl('https://user.github.io/models'), 'https://user.github.io/models/catalog.json');
  assert.equal(indexUrl('https://user.github.io/models/'), 'https://user.github.io/models/catalog.json');
  assert.equal(indexUrl('https://datamodels.jp/catalog.json'), 'https://datamodels.jp/catalog.json');
  assert.throws(() => indexUrl('datamodels.jp'), /not a URL/);
});

test('search ranks a word in the type above the same word in a description, across nodes', async () => {
  const files = {
    [A]: { nodes: [link(B)], models: [
      model('Shelter', { title: { ja: '避難所', en: 'Shelter' } }),
      model('Road', { description: { en: 'A road; closed when a shelter opens nearby.' } }),
      model('Address', { kind: 'value', attributes: [{ name: 'postalCode', description: { en: 'Postal code' } }] }),
    ] },
    [B]: { publisher: { name: { en: 'Bee' } }, models: [model('Patrol', { title: { ja: '避難経路の巡回' } }), model('Tree')] },
  };
  const { nodes } = await discoverNodes(A, { fetch: stub(files) });
  const r = searchModels('shelter', nodes);
  assert.deepEqual(r.results.map((x) => x.type), ['Shelter', 'Road']);
  assert.ok(r.results[0].score > r.results[1].score);
  assert.equal(r.total, 2);
  // Japanese: pairs of characters; both nodes; the site, index and URLs of each model.
  const ja = searchModels('避難', nodes);
  assert.deepEqual(ja.results.map((x) => [x.type, x.site]), [['Patrol', 'Bee'], ['Shelter', 'a.example.org']]);
  assert.equal(ja.results[0].index, B);
  assert.equal(ja.results[0].pageUrl, 'https://x.example.org/Patrol/');
  // Attribute names count, value types are found, a camelCase name is split.
  assert.deepEqual(searchModels('postal', nodes).results.map((x) => [x.type, x.kind]), [['Address', 'value']]);
  // --limit, and the total.
  const limited = searchModels('shelter road', nodes, { limit: 1 });
  assert.deepEqual([limited.results.length, limited.total], [1, 2]);
  assert.deepEqual(searchModels('nothing here', nodes).results, []);
});

test('the words of a text, as datamodels.jp matches proposals', () => {
  assert.deepEqual([...words('EvacuationSites for roads')], ['evacuation', 'site', 'road']);
  assert.deepEqual([...words('指定避難所')], ['指定', '定避', '避難', '難所']);
  assert.deepEqual([...words('a id')], []);
});

test('text from other sites cannot write escape sequences to the terminal', () => {
  assert.equal(plain('Road\u001b[2J\u001b]0;title\u0007 patrol‮'), 'Road [2J ]0;title patrol');
  assert.equal(plain('x'.repeat(300)).length, 200);
});

test('the command line: usage errors and an index it may not read', async () => {
  let r = await datamodels('search', 'a');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /nothing to search for in "a"/);
  r = await datamodels('nodes', '--depth', '6');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--depth needs a whole number from 0 to 5/);
  r = await datamodels('search', 'shelter', '--limit', '0');
  assert.equal(r.code, 2);
  // Refused before any connection: no network needed.
  r = await datamodels('nodes', '--index', 'https://127.0.0.1/catalog.json');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /only https on a public host name/);
  r = await datamodels('search', 'shelter', '--index', 'http://models.example.org/');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^http:\/\/models\.example\.org\/catalog\.json is not read/);
});
