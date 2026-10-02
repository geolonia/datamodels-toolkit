// The command line end to end, against the fixtures copy of the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { siteReader, loadTarget } from '../src/catalog.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const SITE_DIR = join(import.meta.dirname, 'fixtures', 'site');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const dir = await mkdtemp(join(tmpdir(), 'datamodels-'));

// GSI's list for Chiyoda (13101_2, CC BY 4.0 compatible): one row as published, and one with a broken latitude.
const gsi = join(dir, '13101_2.csv');
await writeFile(gsi, '﻿NO,共通ID,施設・場所名,住所,洪水,崖崩れ、土石流及び地滑り,高潮,地震,津波,大規模な火事,内水氾濫,火山現象,指定避難所との住所同一,緯度,経度,備考\n'
  + '28,E1310100002201,番町小学校,東京都千代田区六番町8,1,,1,1,,,1,,1,35.688111802263,139.73407899331,\n'
  + '29,E1310100002202,試験,東京都千代田区,1,,,,,,,,,北緯35度,139.7,\n');

test('convert writes the valid rows, reports the invalid one and exits with 1', async () => {
  const r = await datamodels('convert', 'disaster/EvacuationSite', 'gsi-emergency-site', gsi, '--set', 'localGovernmentCode=13101', '--site', SITE_DIR);
  assert.equal(r.code, 1, r.stderr);
  const entities = JSON.parse(r.stdout);
  assert.deepEqual(entities.map((e) => e.id), ['urn:ngsi-ld:EvacuationSite:E1310100002201']);
  assert.match(r.stderr, /utf-8 \(BOM\), 2 row\(s\), 1 valid EvacuationSite, 1 invalid/);
  assert.match(r.stderr, /line 3: /);
  assert.match(r.stderr, /repaired 2×: localGovernmentCode: added the check digit/);
});

test('--normalized writes NGSI-LD normalized entities with the alias context and the core context', async () => {
  const out = join(dir, 'out.json');
  const r = await datamodels('convert', 'disaster/EvacuationSite', 'gsi-emergency-site', gsi, '--set', 'localGovernmentCode=13101', '--normalized', '--out', out, '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  const [e] = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual(e['@context'], ['https://datamodels.jp/context/disaster/v1.jsonld', 'https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.8.jsonld']);
  assert.deepEqual(e.location.type, 'GeoProperty');
  assert.deepEqual(e.name, { type: 'Property', value: '番町小学校' });
});

test('usage errors exit with 2 and name the problem', async () => {
  for (const [args, message] of [
    [[], /missing command/],
    [['validate'], /unknown command validate/],
    [['convert', 'disaster/EvacuationSite'], /missing arguments/],
    [['convert', 'disaster/EvacuationSite', 'gsi-emergency-site', gsi, '--set', 'x'], /--set needs attribute=value/],
    [['convert', 'disaster/EvacuationSite', 'gsi-emergency-site', gsi, '--set', 'nothing=x', '--site', SITE_DIR], /--set nothing: not a field that gsi-emergency-site fills/],
    [['convert', 'disaster/EvacuationSite', 'gsi-emergency-site', gsi, '--sit', SITE_DIR], /unknown option --sit/],
    [['convert', 'disaster/EvacuationSite', 'gsi-emergency-site', gsi, 'more'], /unexpected arguments: more/],
  ]) {
    const r = await datamodels(...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.stderr, message, args.join(' '));
  }
});

test('an unknown model or mapping, or a site without the files, exits with 1 and says what exists', async () => {
  let r = await datamodels('convert', 'disaster/Nothing', 'x', gsi, '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no model disaster\/Nothing in the catalog \(has: .*disaster\/EvacuationSite/);
  r = await datamodels('convert', 'disaster/EvacuationSite', 'x', gsi, '--site', SITE_DIR);
  assert.match(r.stderr, /disaster\/EvacuationSite has no mapping x \(has: .*gsi-emergency-site/);
  r = await datamodels('convert', 'disaster/EvacuationSite', 'gsi-emergency-site', gsi, '--site', dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /catalog\.json: ENOENT/);
});

test('the reader refuses URLs outside datamodels.jp', async () => {
  await assert.rejects(siteReader(SITE_DIR).text('https://example.com/x.json'), /not a https:\/\/datamodels\.jp URL/);
});

test('every fixture model loads: its mapping, the mappings it reaches through via, and the schemas it references', async () => {
  const t = await loadTarget(siteReader(SITE_DIR), 'disaster/EvacuationSite', 'jichitai-opendata-site');
  assert.deepEqual(Object.keys(t.mappings).sort(), ['common/Geometry/jichitai-opendata-location', 'common/JapaneseAddress/jichitai-opendata-address']);
  assert.equal(typeof t.validate, 'function');
});
