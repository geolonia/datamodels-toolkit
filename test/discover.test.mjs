// datamodels nodes and search (geolonia/datamodels#222): following the links
// between indexes, and ranking the models they list. A stub stands in for fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { discoverNodes, searchModels, indexUrl, indexForModel, triedFirst, plain, words, MAX_NODES, DEFAULT_INDEX, OWN_INDEX_TIMEOUT } from '../src/discover.mjs';
import { indexForIri } from '../src/build/urls.mjs';
import * as build from '../src/build/index.mjs';

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

test('a node\'s own title, when its catalog.json has one: in English, else its first language with a text', async () => {
  const D = 'https://d.example.org/catalog.json';
  const files = {
    [A]: { title: { ja: 'エーのモデル', en: 'Models of A' }, publisher: { name: { en: 'A' } }, nodes: [link(B), link(C), link(D)], models: [model('Shelter')] },
    [B]: { title: { en: ' ', ja: 'ビーのモデル' }, publisher: { name: { ja: 'ビー' } }, models: [model('Shelter')] },
    // Not a text per language: no title, as when there is none.
    [C]: { title: 'Models of C', models: [] },
    // A publisher name that is empty in English is named in its other language, not by the host.
    [D]: { title: { en: 1 }, publisher: { name: { en: ' ', ja: 'ディー' } }, models: [] },
  };
  const { nodes } = await discoverNodes(A, { fetch: stub(files) });
  assert.deepEqual(nodes.map(({ name, title }) => [name, title]), [['A', 'Models of A'], ['ビー', 'ビーのモデル'], ['c.example.org', null], ['ディー', null]]);
  // Search results carry it next to the publisher's name.
  assert.deepEqual(searchModels('shelter', nodes).results.map((r) => [r.site, r.siteTitle]), [['A', 'Models of A'], ['ビー', 'ビーのモデル']]);
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

// A model given by its type IRI, without an index (geolonia/datamodels#222):
// the index of the node that minted the IRI is tried first.

test('indexForIri: no index for an IRI that is not https, has no /ns/ at its place, or is not a URL', () => {
  for (const iri of [
    'http://models.example.org/ns/road#RoadTask', // not https: never read
    'https://models.example.org/vocab/road/RoadTask', // no /ns/
    'https://models.example.org/ns/road', // a namespace, no type
    'https://models.example.org/ns/road#', // an empty fragment
    'https://models.example.org/ns/road/', // a namespace with slash IRIs
    'https://models.example.org/ns/a/b/Type', // /ns/ not where a node puts it
    'https://user:secret@models.example.org/ns/road/RoadTask', // credentials
    'https://models.example.org/ns/road/RoadTask?x=1', // a query
    'urn:ngsi-ld:ns/road/RoadTask', 'road/RoadTask', '', undefined,
  ]) assert.equal(indexForIri(iri), null, String(iri));
});

test('indexForIri: the index of the node that minted a slash or hash IRI', () => {
  assert.equal(indexForIri('https://datamodels.jp/ns/task/Task'), DEFAULT_INDEX);
  assert.equal(indexForIri('https://models.geolonia.com/ns/smartmap#HazardArea'), 'https://models.geolonia.com/catalog.json');
  // A node under a path (a GitHub Pages project site).
  assert.equal(indexForIri('https://dkastl.github.io/models/ns/activity#Activity'), 'https://dkastl.github.io/models/catalog.json');
  assert.equal(indexForIri('https://owner.github.io/repo/ns/task/Task'), 'https://owner.github.io/repo/catalog.json');
  // A subject named ns, and /ns/ twice: the /ns/ a node puts before the subject counts.
  assert.equal(indexForIri('https://x.example.org/ns/ns/Type'), 'https://x.example.org/catalog.json');
  assert.equal(indexForIri('https://x.example.org/a/ns/b/ns/c#Type'), 'https://x.example.org/a/ns/b/catalog.json');
  // The reverse of catalogUrls(): every IRI a node mints leads back to its index.
  for (const iris of ['slash', 'hash']) for (const base of ['https://models.example.org', 'https://owner.github.io/repo']) {
    assert.equal(indexForIri(build.catalogUrls(base, { iris }).term('road', 'RoadTask')), `${base}/catalog.json`, `${base} ${iris}`);
  }
  // Exported for other tools, such as the datamodels.jp MCP server.
  assert.equal(build.indexForIri, indexForIri);
});

const OWN = 'https://models.example.org/catalog.json';
const IRI = 'https://models.example.org/ns/road#RoadTask';
const pickFor = async (iri, files, fallback = DEFAULT_INDEX, options = {}) => {
  const seen = [];
  const r = await indexForModel(iri, fallback, { fetch: stub(files, seen), timeout: 1000, ...options });
  return { ...r, seen };
};

test('indexForModel: the usual index, with nothing read, when the IRI has no index of its own or it is the usual one', async () => {
  for (const iri of ['http://models.example.org/ns/road#RoadTask', 'https://models.example.org/vocab/road/RoadTask', 'road/RoadTask', 'https://datamodels.jp/ns/task/Task']) {
    assert.deepEqual(await pickFor(iri, { [OWN]: { models: [] } }), { from: DEFAULT_INDEX, tried: null, seen: [] }, iri);
  }
  // The usual index written another way (dot segments) is the same index.
  assert.deepEqual(await pickFor(IRI, {}, 'https://models.example.org/x/../catalog.json'), { from: 'https://models.example.org/x/../catalog.json', tried: null, seen: [] });
});

test('indexForModel: never reads an index on a local or private host', async () => {
  for (const iri of ['https://localhost/ns/road#RoadTask', 'https://127.0.0.1/ns/road/RoadTask', 'https://169.254.169.254/ns/road/RoadTask', 'https://printer.local/ns/road/RoadTask']) {
    const r = await pickFor(iri, {});
    assert.equal(r.from, DEFAULT_INDEX, iri);
    assert.match(r.tried, /is not read: only https on a public host name/, iri);
    assert.deepEqual(r.seen, [], iri);
  }
});

test('indexForModel: the usual index when the IRI\'s own index cannot be read or does not list it', async () => {
  const cases = [
    [{}, `${OWN}: HTTP 404`],
    [{ [OWN]: () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } }, `${OWN} could not be read (ENOTFOUND)`],
    [{ [OWN]: { hello: 'not an index' } }, `${OWN}: no models (is it a catalog.json?)`],
    [{ [OWN]: { models: [{ type: 'RoadTask', typeIri: 'https://models.example.org/ns/road#Other' }] } }, `${OWN} does not list it`],
  ];
  for (const [files, tried] of cases) assert.deepEqual(await pickFor(IRI, files), { from: DEFAULT_INDEX, tried, seen: [OWN] });
  // Not JSON.
  const text = async () => new Response('<html>', { status: 200 });
  assert.deepEqual(await pickFor(IRI, { [OWN]: text }), { from: DEFAULT_INDEX, tried: `${OWN}: not JSON`, seen: [OWN] });
  // The reason is added to the error of the usual index, once.
  assert.equal(triedFirst(new Error('X is not a model in Y'), `${OWN}: HTTP 404`).message, `X is not a model in Y (tried first: ${OWN}: HTTP 404)`);
  const e = new Error('same');
  assert.equal(triedFirst(e, null), e);
});

test('indexForModel: the IRI\'s own index when it lists a model with that IRI, an alias included', async () => {
  const catalog = { models: [{ type: 'RoadTask', typeIri: IRI }] };
  assert.deepEqual(await pickFor(IRI, { [OWN]: catalog }), { from: OWN, catalog, seen: [OWN] });
  // A model that is another name (aliasOf) for the type has its IRI too, so it counts, as in a lookup with --index.
  const alias = { models: [{ type: 'Errand', typeIri: IRI, aliasOf: IRI }] };
  assert.deepEqual(await pickFor(IRI, { [OWN]: alias }), { from: OWN, catalog: alias, seen: [OWN] });
  // Whatever the usual index is (here the first node in node.yaml).
  assert.equal((await pickFor(IRI, { [OWN]: catalog }, 'https://other.example.org/catalog.json')).from, OWN);
});

test('indexForModel: the usual index when the IRI\'s own index lists it, but not as the command needs it', async () => {
  const value = { models: [{ type: 'RoadTask', kind: 'value', typeIri: IRI }] };
  const entity = (m) => (m.kind ?? 'entity') === 'entity';
  assert.deepEqual(await pickFor(IRI, { [OWN]: value }, DEFAULT_INDEX, { accepts: entity, what: 'an entity type' }),
    { from: DEFAULT_INDEX, tried: `${OWN} lists it, but not as an entity type`, seen: [OWN] });
  // One entry that it takes is enough.
  const both = { models: [...value.models, { type: 'RoadTask', typeIri: IRI }] };
  assert.deepEqual(await pickFor(IRI, { [OWN]: both }, DEFAULT_INDEX, { accepts: entity }), { from: OWN, catalog: both, seen: [OWN] });
});

test(`indexForModel: a host that does not answer holds up the usual index for at most ${OWN_INDEX_TIMEOUT / 1000} s`, async () => {
  assert.ok(OWN_INDEX_TIMEOUT <= 5000);
  // A fetch that answers only when it is aborted, as a host that does not answer.
  const silent = async (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const started = Date.now();
  const r = await indexForModel(IRI, DEFAULT_INDEX, { fetch: silent, timeout: 50 });
  assert.equal(r.from, DEFAULT_INDEX);
  assert.match(r.tried, new RegExp(`^${OWN.replaceAll('.', '\\.')} could not be read`));
  assert.ok(Date.now() - started < 2000);
});
