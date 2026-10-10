// datamodels release (#27): a published version stays online after the next one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { releaseSubject } from '../src/release.mjs';
import { buildNode, checkNode } from '../src/build/index.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const BASE = 'https://models.example.org';
const exists = (p) => stat(p).then(() => true, () => false);

async function node() {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-release-'));
  await writeFile(join(dir, 'node.yaml'), `baseUrl: ${BASE}\npublisher: { name: { en: Example }, url: https://example.org/ }\nlicense: CC0-1.0\n`);
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  await mkdir(join(m, 'examples'), { recursive: true });
  await writeFile(join(dir, 'models', 'road', 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { en: Roads }\ndescription: { en: Roads. }\n');
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' } }));
  await writeFile(join(m, 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/RoadPatrol/v0.1.0.json`, type: 'object', required: ['id', 'type'], properties: { id: { type: 'string' }, type: { const: 'RoadPatrol' }, route: { type: 'string', 'x-iri': `${BASE}/ns/road#route` } } }));
  await writeFile(join(m, 'catalog.yaml'), 'title: { en: Road patrol }\ndescription: { en: A run. }\nattributes:\n  route: { en: The route }\n');
  await writeFile(join(m, 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:RoadPatrol:1', type: 'RoadPatrol', route: 'R1' }));
  return dir;
}

/** The files a build publishes for v0.1.0, as a stand-in for fetch: URL → body. */
async function published(dir) {
  const out = await mkdtemp(join(tmpdir(), 'datamodels-release-site-'));
  await buildNode(dir, { out, pages: false });
  const files = {};
  for (const path of ['context/road/v0.1.0.jsonld', 'vocab/road/v0.1.0.jsonld', 'schema/road/RoadPatrol/v0.1.0.json']) files[`${BASE}/${path}`] = await readFile(join(out, path));
  return files;
}
const fakeFetch = (files) => async (url) => (url in files ? new Response(files[url], { status: 200 }) : new Response('not found', { status: 404 }));

test('release writes the snapshot once; a second run keeps it', async () => {
  const dir = await node();
  const r = await releaseSubject(dir, 'road', { offline: true });
  assert.deepEqual({ ...r, notes: r.notes.length }, { subject: 'road', version: '0.1.0', dir: join('models', 'road', 'releases', 'v0.1.0'), written: true, online: 0, notes: 1 });
  const rel = join(dir, 'models', 'road', 'releases', 'v0.1.0');
  assert.deepEqual((await readdir(rel)).sort(), ['context.jsonld', 'schema', 'vocab.jsonld']);
  assert.deepEqual(await readdir(join(rel, 'schema')), ['RoadPatrol.json']);
  assert.equal((await releaseSubject(dir, 'road', { offline: true })).written, false);
});

test('a released version whose sources changed is refused; a new version publishes both', async () => {
  const dir = await node();
  await releaseSubject(dir, 'road', { offline: true });
  const ctx = join(dir, 'models', 'road', 'context.jsonld');
  await writeFile(ctx, JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route', note: 'road:note' } }));
  await assert.rejects(releaseSubject(dir, 'road', { offline: true }), /road v0\.1\.0 is released and its sources changed since:\n.*context: snapshot differs/);
  // The change as v0.2.0: both versions are on the site.
  const subject = join(dir, 'models', 'road', 'subject.yaml');
  await writeFile(subject, (await readFile(subject, 'utf8')).replace('version: 0.1.0', 'version: 0.2.0'));
  const out = join(dir, '_site');
  await buildNode(dir, { out, pages: false });
  assert.deepEqual((await readdir(join(out, 'context', 'road'))).sort(), ['v0.1.0.jsonld', 'v0.2.0.jsonld', 'v0.jsonld']);
  assert.doesNotMatch(await readFile(join(out, 'context', 'road', 'v0.1.0.jsonld'), 'utf8'), /note/);
});

test('online, the snapshot must be what was published', async () => {
  const dir = await node();
  const files = await published(dir);
  // Published and unchanged: released, compared with the 3 files.
  let r = await releaseSubject(dir, 'road', { fetch: fakeFetch(files) });
  assert.deepEqual([r.written, r.online, r.notes], [true, 3, []]);
  // Changed after publishing: refused, and nothing is written.
  const other = await node();
  const schemaFile = join(other, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
  schema.properties.route.maxLength = 10;
  await writeFile(schemaFile, JSON.stringify(schema));
  await assert.rejects(releaseSubject(other, 'road', { fetch: fakeFetch(files) }), new RegExp(`road v0\\.1\\.0 is published, and its sources changed since:\\n  ${BASE}/schema/road/RoadPatrol/v0\\.1\\.0\\.json\\nThe snapshot must keep what was published`));
  assert.equal(await exists(join(other, 'models', 'road', 'releases')), false);
  // Not published yet: released as it is.
  r = await releaseSubject(await node(), 'road', { fetch: fakeFetch({}) });
  assert.deepEqual([r.written, r.online], [true, 0]);
  // A site that cannot be reached, or answers with an error: nothing is released.
  const down = await node();
  await assert.rejects(releaseSubject(down, 'road', { fetch: async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); } }), /road v0\.1\.0: nothing released, the published files could not be compared:\n  .*context\/road\/v0\.1\.0\.jsonld: ENOTFOUND[\s\S]*--offline/);
  await assert.rejects(releaseSubject(down, 'road', { fetch: async () => new Response('busy', { status: 503 }) }), /schema\/road\/RoadPatrol\/v0\.1\.0\.json: HTTP 503/);
  assert.equal(await exists(join(down, 'models', 'road', 'releases')), false);
});

test('check notes a published version that is not released', async () => {
  const dir = await node();
  const files = await published(dir);
  let r = await checkNode(dir, { fetch: fakeFetch(files) });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.notes, ['road v0.1.0 is published but not released: run datamodels release road before you change it, or its files leave the site with the next version']);
  await releaseSubject(dir, 'road', { offline: true });
  r = await checkNode(dir, { fetch: fakeFetch(files) });
  assert.deepEqual(r, { problems: [], notes: [] });
});

test('datamodels release: exit codes', async () => {
  const dir = await node();
  let r = await datamodels('release', 'road', dir, '--offline');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /road v0\.1\.0: released into models\/road\/releases\/v0\.1\.0\. Commit it/);
  r = await datamodels('release', 'road', dir, '--offline');
  assert.match(r.stderr, /already released .*unchanged/);
  r = await datamodels('release', 'nope', dir, '--offline');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no subject nope .*\(subjects: road\)/);
  r = await datamodels('release');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /missing arguments\nusage: datamodels release <subject> \[dir\] \[--offline\]/);
});
