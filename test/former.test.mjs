// A model or term that a released version had and the current one does not
// keeps its address: the model's old page says where it went, and the
// namespace page keeps an anchor for every former term.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpSubject } from '../src/version.mjs';
import { buildNode } from '../src/build/index.mjs';
import { pageTexts } from '../src/build/page-texts.mjs';

const BASE = 'https://models.example.org';
const TASK = 'https://datamodels.jp/ns/task/Task';

async function node() {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-former-'));
  await writeFile(join(dir, 'node.yaml'), `baseUrl: ${BASE}\nlanguages: [en]\npublisher: { name: { en: Example }, url: https://example.org/ }\nlicense: CC0-1.0\n`);
  const s = join(dir, 'models', 'road');
  await writeFile(join(await mkdir(join(s, 'Ride', 'examples'), { recursive: true }) && s, 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { en: Roads }\ndescription: { en: Roads. }\n');
  await mkdir(join(s, 'Ticket', 'examples'), { recursive: true });
  await writeFile(join(s, 'context.jsonld'), JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, Ride: 'road:Ride', rideType: 'road:rideType', Ticket: TASK } }));
  await writeFile(join(s, 'Ride', 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/Ride/v0.1.0.json`, type: 'object', properties: { id: { type: 'string' }, type: { const: 'Ride' }, rideType: { type: 'string', 'x-iri': `${BASE}/ns/road#rideType` } } }));
  await writeFile(join(s, 'Ride', 'catalog.yaml'), 'title: { en: Ride }\ndescription: { en: A ride. }\nattributes:\n  rideType: { en: The kind }\n');
  await writeFile(join(s, 'Ride', 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:Ride:1', type: 'Ride', rideType: 'road' }));
  await writeFile(join(s, 'Ticket', 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/Ticket/v0.1.0.json`, 'x-alias-of': TASK, type: 'object', properties: { id: { type: 'string' }, type: { const: 'Ticket' } } }));
  await writeFile(join(s, 'Ticket', 'catalog.yaml'), 'title: { en: Ticket }\ndescription: { en: A ticket. }\n');
  await writeFile(join(s, 'Ticket', 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:Ticket:1', type: 'Ticket' }));
  return dir;
}

test('a renamed model keeps a page at its old address, and its former terms keep their anchors', async () => {
  const dir = await node();
  await bumpSubject(dir, 'road', 'minor', { offline: true });
  // 0.2.0: Ride becomes Activity (a new type IRI, rideType gone), Ticket becomes Issue (the same type IRI).
  const s = join(dir, 'models', 'road');
  await rename(join(s, 'Ride'), join(s, 'Activity'));
  await writeFile(join(s, 'Activity', 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/Activity/v0.2.0.json`, type: 'object', properties: { id: { type: 'string' }, type: { const: 'Activity' } } }));
  await writeFile(join(s, 'Activity', 'catalog.yaml'), 'title: { en: Activity }\ndescription: { en: An activity. }\n');
  await writeFile(join(s, 'Activity', 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:Activity:1', type: 'Activity' }));
  await rename(join(s, 'Ticket'), join(s, 'Issue'));
  await writeFile(join(s, 'Issue', 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/Issue/v0.2.0.json`, 'x-alias-of': TASK, type: 'object', properties: { id: { type: 'string' }, type: { const: 'Issue' } } }));
  await writeFile(join(s, 'Issue', 'catalog.yaml'), 'title: { en: Issue }\ndescription: { en: An issue. }\n');
  await writeFile(join(s, 'Issue', 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:Issue:1', type: 'Issue' }));
  await writeFile(join(s, 'context.jsonld'), JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, Activity: 'road:Activity', Ticket: null, Issue: TASK } }));
  const { pages } = await buildNode(dir);
  const read = (p) => readFile(join(dir, '_site', p), 'utf8');
  assert.ok(pages.includes('models/road/Ride/index.html') && pages.includes('models/road/Ticket/index.html'), pages.join(' '));

  const ride = await read('models/road/Ride/index.html');
  assert.match(ride, /<p>Ride was a model of road in version 0\.1\.0\. The current version no longer has it; its files stay online\.<\/p>/);
  assert.match(ride, /<a href="https:\/\/models\.example\.org\/schema\/road\/Ride\/v0\.1\.0\.json">/);
  assert.match(ride, /<a href="https:\/\/models\.example\.org\/context\/road\/v0\.1\.0\.jsonld">/);
  assert.doesNotMatch(ride, /is now named/, 'Activity has another type IRI');
  assert.match(ride, /The current models of this subject: <a href="https:\/\/models\.example\.org\/models\/road\/Activity\/">Activity<\/a>, <a href="https:\/\/models\.example\.org\/models\/road\/Issue\/">Issue<\/a>/);
  // The same type IRI under another name: the old page says what it is called now.
  assert.match(await read('models/road/Ticket/index.html'), /The same type is now named <a href="https:\/\/models\.example\.org\/models\/road\/Issue\/">Issue<\/a>\./);

  // The hash IRIs of the former terms still open on an anchor; Ticket was never minted (Task's IRI).
  const ns = await read('ns/road.html');
  assert.match(ns, /<h2>Terms of earlier versions<\/h2>/);
  for (const t of ['Ride', 'rideType']) assert.match(ns, new RegExp(`<tr id="${t}"><th scope="row">${t}</th><td><a href="https://models\\.example\\.org/vocab/road/v0\\.1\\.0\\.jsonld">v0\\.1\\.0</a></td></tr>`), t);
  assert.doesNotMatch(ns, /id="Ticket"/);
});

test('the versions of a former model are listed, not given as a range', () => {
  assert.match(pageTexts('en').formerModel('Ride', 'road', ['0.1.0', '0.3.0']), /in versions 0\.1\.0 and 0\.3\.0\./);
  assert.match(pageTexts('en').formerModel('Ride', 'road', ['0.1.0', '0.2.0', '0.4.0']), /in versions 0\.1\.0, 0\.2\.0 and 0\.4\.0\./);
  assert.match(pageTexts('ja').formerModel('Ride', 'road', ['0.1.0', '0.3.0']), /バージョン 0\.1\.0、0\.3\.0 のモデル/);
});

test('a node without former models or terms gets no such pages or section', async () => {
  const dir = await node();
  const { pages } = await buildNode(dir);
  assert.deepEqual(pages.filter((p) => p.startsWith('models/')), ['models/road/Ride/index.html', 'models/road/Ticket/index.html']);
  assert.doesNotMatch(await readFile(join(dir, '_site', 'ns', 'road.html'), 'utf8'), /earlier versions/);
});
