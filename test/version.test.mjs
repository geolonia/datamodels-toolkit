// datamodels upgrade and bump: version updates of a node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { upgradeNode, bumpSubject, nextVersion } from '../src/version.mjs';
import { buildNode } from '../src/build/index.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const BASE = 'https://models.example.org';
const API = 'https://api.github.com/repos/geolonia/datamodels-toolkit';
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);

async function node() {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-version-'));
  await writeFile(join(dir, 'node.yaml'), `baseUrl: ${BASE}\npublisher: { name: { en: Example }, url: https://example.org/ }\nlicense: CC0-1.0\n`);
  const road = join(dir, 'models', 'road');
  await mkdir(join(road, 'RoadPatrol', 'examples'), { recursive: true });
  await mkdir(join(road, 'Segment'), { recursive: true });
  await writeFile(join(road, 'subject.yaml'), '# The road subject.\nname: road\nversion: 0.1.0   # kept online when it changes\nsource: minted\ntitle: { en: Roads }\ndescription: { en: Roads. }\n');
  await writeFile(join(road, 'context.jsonld'), JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route', from: 'road:from' } }));
  await writeFile(join(road, 'RoadPatrol', 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/RoadPatrol/v0.1.0.json`, type: 'object', required: ['id', 'type'], properties: { id: { type: 'string' }, type: { const: 'RoadPatrol' }, route: { $ref: `${BASE}/schema/road/Segment/v0.1.0.json`, 'x-iri': `${BASE}/ns/road#route` } } }, null, 2));
  await writeFile(join(road, 'RoadPatrol', 'catalog.yaml'), 'title: { en: Road patrol }\ndescription: { en: A run. }\nattributes:\n  route: { en: The route }\n');
  await writeFile(join(road, 'RoadPatrol', 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:RoadPatrol:1', type: 'RoadPatrol', route: { from: 'A' } }));
  await writeFile(join(road, 'Segment', 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/Segment/v0.1.0.json`, 'x-kind': 'value', type: 'object', properties: { from: { type: 'string', 'x-iri': `${BASE}/ns/road#from` } } }, null, 2));
  await writeFile(join(road, 'Segment', 'catalog.yaml'), 'title: { en: Segment }\ndescription: { en: A part. }\nattributes:\n  from: { en: Start }\n');
  await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  await writeFile(join(dir, '.github', 'workflows', 'publish.yml'), `jobs:\n  check:\n    steps:\n      - uses: actions/checkout@${'c'.repeat(40)} # v7.0.1\n      - uses: geolonia/datamodels-toolkit@${OLD} # v0.1.0\n  publish:\n    steps:\n      - id: node\n        uses: geolonia/datamodels-toolkit@main\n`);
  await writeFile(join(dir, 'README.md'), '```bash\nnpx github:geolonia/datamodels-toolkit#v0.1.0 check\n```\n');
  return dir;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const github = (latest = 'v0.3.0') => async (url) => {
  if (url === `${API}/releases/latest`) return json({ tag_name: latest });
  if (url === `${API}/commits/v0.3.0`) return json({ sha: NEW });
  return json({ message: 'No commit found' }, 422);
};

test('upgrade pins the Action to the release and runs it with npx', async () => {
  const dir = await node();
  const r = await upgradeNode(dir, { fetch: github() });
  assert.deepEqual(r, { version: 'v0.3.0', sha: NEW, changed: ['.github/workflows/publish.yml', 'README.md'] });
  const wf = await readFile(join(dir, '.github', 'workflows', 'publish.yml'), 'utf8');
  assert.equal(wf.match(new RegExp(`geolonia/datamodels-toolkit@${NEW} # v0\\.3\\.0\\n`, 'g')).length, 2, 'a SHA pin and a branch are both replaced');
  assert.match(wf, /actions\/checkout@c{40} # v7\.0\.1/, 'other actions are left alone');
  assert.match(await readFile(join(dir, 'README.md'), 'utf8'), /npx github:geolonia\/datamodels-toolkit#v0\.3\.0 check/);
  // A second run changes nothing; a release that does not exist is refused.
  assert.deepEqual((await upgradeNode(dir, { fetch: github() })).changed, []);
  await assert.rejects(upgradeNode(dir, { to: 'v9.9.9', fetch: github() }), /v9\.9\.9 is not a release of geolonia\/datamodels-toolkit/);
  await assert.rejects(upgradeNode(dir, { to: 'main', fetch: github() }), /--to needs a release tag such as v0\.3\.0/);
});

test('bump releases the current version, then raises the version and the schema URLs', async () => {
  assert.deepEqual(['patch', 'minor', 'major'].map((l) => nextVersion('1.4.2', l)), ['1.4.3', '1.5.0', '2.0.0']);
  const dir = await node();
  const r = await bumpSubject(dir, 'road', 'minor', { offline: true });
  assert.deepEqual([r.from, r.to, r.released.written], ['0.1.0', '0.2.0', true]);
  assert.deepEqual(r.changed, ['models/road/subject.yaml', 'models/road/RoadPatrol/schema.json', 'models/road/Segment/schema.json']);
  assert.match(await readFile(join(dir, 'models', 'road', 'subject.yaml'), 'utf8'), /^version: 0\.2\.0   # kept online when it changes$/m, 'the comment stays');
  const patrol = JSON.parse(await readFile(join(dir, 'models', 'road', 'RoadPatrol', 'schema.json'), 'utf8'));
  assert.equal(patrol.$id, `${BASE}/schema/road/RoadPatrol/v0.2.0.json`);
  assert.equal(patrol.properties.route.$ref, `${BASE}/schema/road/Segment/v0.2.0.json`, '$ref between its models');
  // Both versions are on the site.
  const out = join(dir, '_site');
  await buildNode(dir, { out, pages: false });
  assert.deepEqual(JSON.parse(await readFile(join(out, 'schema', 'road', 'RoadPatrol', 'v0.1.0.json'), 'utf8')).$id, `${BASE}/schema/road/RoadPatrol/v0.1.0.json`);
  assert.deepEqual(JSON.parse(await readFile(join(out, 'schema', 'road', 'RoadPatrol', 'v0.2.0.json'), 'utf8')).$id, `${BASE}/schema/road/RoadPatrol/v0.2.0.json`);
});

test('bump refuses what release refuses, and nothing changes then', async () => {
  const dir = await node();
  // Published, but the sources changed since: release stops, and so does bump.
  const changed = async (url) => (url.endsWith('/context/road/v0.1.0.jsonld') ? new Response('{"@context":{}}', { status: 200 }) : new Response('not found', { status: 404 }));
  await assert.rejects(bumpSubject(dir, 'road', 'major', { fetch: changed }), /road v0\.1\.0 is published, and its sources changed since/);
  assert.match(await readFile(join(dir, 'models', 'road', 'subject.yaml'), 'utf8'), /^version: 0\.1\.0/m);
  await assert.rejects(bumpSubject(dir, 'road', 'huge', { offline: true }), /the level is patch, minor or major/);
  await assert.rejects(bumpSubject(dir, 'nope', 'minor', { offline: true }), /no subject nope/);
});

test('datamodels bump and upgrade: usage errors', async () => {
  let r = await datamodels('bump', 'road');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: datamodels bump <subject> <patch\|minor\|major> \[dir\] \[--offline\]/);
  r = await datamodels('upgrade', '.', '--to');
  assert.equal(r.code, 2);
});
