// datamodels add (#13): a new model that builds and passes check at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkNode, buildNode } from '../src/build/index.mjs';
import { initSettings, writeNode } from '../src/init.mjs';
import { addModel } from '../src/add.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const BASE = 'https://models.example.org';

async function node({ iris = 'hash' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-add-'));
  await writeNode(dir, initSettings({ baseUrl: BASE, iris, languages: ['ja', 'en'], publisherName: 'Example', publisherUrl: 'https://example.org/', subject: 'road' }));
  return dir;
}

test('add writes an entity and a value type that build and pass check', async () => {
  const dir = await node();
  const r = await addModel(dir, 'road/RoadPatrol');
  assert.equal(r.typeIri, `${BASE}/ns/road#RoadPatrol`);
  await addModel(dir, 'road/Segment', { kind: 'value' });
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
  const { catalog } = await buildNode(dir, { pages: false });
  assert.deepEqual(catalog.models.map((m) => [m.type, m.kind, m.status]), [['RoadPatrol', 'entity', 'draft'], ['Segment', 'value', 'draft']]);
  assert.deepEqual(catalog.models[0].title, { ja: 'RoadPatrol', en: 'RoadPatrol' });
  const context = JSON.parse(await readFile(join(dir, 'models', 'road', 'context.jsonld'), 'utf8'))['@context'];
  assert.deepEqual(context, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', Segment: 'road:Segment' });
  const schema = JSON.parse(await readFile(join(dir, 'models', 'road', 'RoadPatrol', 'schema.json'), 'utf8'));
  assert.equal(schema.$id, `${BASE}/schema/road/RoadPatrol/v0.1.0.json`);
});

test('add with slash IRIs, and with a context that has no prefix for the namespace', async () => {
  const dir = await node({ iris: 'slash' });
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': ['https://datamodels.jp/context/common/v1.jsonld', {}] }));
  await addModel(dir, 'road/RoadPatrol');
  const context = JSON.parse(await readFile(join(dir, 'models', 'road', 'context.jsonld'), 'utf8'))['@context'];
  assert.deepEqual(context, ['https://datamodels.jp/context/common/v1.jsonld', { RoadPatrol: `${BASE}/ns/road/RoadPatrol` }]);
});

test('add says when the subject\'s version was already released', async () => {
  const dir = await node();
  assert.equal((await addModel(dir, 'road/RoadPatrol')).released, null);
  await mkdir(join(dir, 'models', 'road', 'releases', 'v0.1.0'), { recursive: true });
  const r = await datamodels('add', 'road/Segment', dir, '--value');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /note: v0\.1\.0 of this subject was released, so its files cannot change/);
});

test('add refuses a wrong name, a missing subject and a model that exists', async () => {
  const dir = await node();
  await assert.rejects(addModel(dir, 'road/roadPatrol'), /must be UpperCamelCase/);
  await assert.rejects(addModel(dir, 'RoadPatrol'), /the model is <subject>\/<Type>/);
  await assert.rejects(addModel(dir, 'water/Pipe'), /no subject water/);
  await addModel(dir, 'road/RoadPatrol');
  await assert.rejects(addModel(dir, 'road/RoadPatrol'), /already exists/);
  const r = await datamodels('add', 'road/RoadPatrol', dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /RoadPatrol already exists/);
  const ok = await datamodels('add', 'road/Segment', dir, '--value');
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stderr, /added models\/road\/Segment\/schema\.json/);
});
