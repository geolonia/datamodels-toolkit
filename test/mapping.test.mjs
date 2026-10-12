// Lists of your own: a mapping file of your own for convert, the first
// mapping that datamodels mapping writes, convert --check, and a CSV with the
// columns of the CSV template, converted without a mapping file. Against the
// fixtures copy of the site (test/fixtures/site/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { siteReader, loadTarget, isMappingFile, isViaFile } from '../src/catalog.mjs';
import { mappedColumns, mappingProblems } from '../src/convert.mjs';
import { siteModel, templateMapping, targetsOf, matchColumns, flowRule, startMapping } from '../src/mapping.mjs';
import { exportModel } from '../src/export.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const SITE_DIR = join(import.meta.dirname, 'fixtures', 'site');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const dir = await mkdtemp(join(tmpdir(), 'datamodels-mapping-'));
const reader = siteReader(SITE_DIR);
const site = await loadTarget(reader, 'disaster/EvacuationSite', 'jichitai-opendata-site');
const lastLine = (text) => text.trim().split('\n').at(-1);

// A list of a municipality's own making: its own column names, the address in one column.
const OWN_HEAD = '番号,団体コード,施設名,住所,緯度,経度,収容人数';
const own = (rows) => `${OWN_HEAD}\n${rows.join('\n')}\n`;
const ROW1 = '1,92011,中央小学校,栃木県宇都宮市中央本町1-29,36.55925966,139.8847723,"1,200"';
const ROW2 = '2,92011,東小学校,栃木県宇都宮市東1-1,36.56,139.89,500';
const OWN_MAPPING = `# My list
convert:
  id: "urn:ngsi-ld:EvacuationSite:{localGovernmentCode}-{externalSiteId}"
fields:
  externalSiteId: { column: 番号 }
  localGovernmentCode: { column: 団体コード, transform: code6 }
  name: { column: 施設名 }
  address: { via: parts/address.yaml }
  location: { via: common/Geometry/jichitai-opendata-location }
  maxCapacity: { column: 収容人数, transform: integer }
`;

/** Writes a list and a mapping into a folder of their own: { csv, yaml }. */
async function listWith(name, mapping, csv = own([ROW1, ROW2])) {
  const at = join(dir, name);
  await mkdir(join(at, 'parts'), { recursive: true });
  await writeFile(join(at, 'parts', 'address.yaml'), 'fields:\n  addressCountry: { value: JP }\n  addressText: { column: 住所 }\n');
  await writeFile(join(at, 'list.csv'), csv);
  await writeFile(join(at, 'my-list.yaml'), mapping);
  return { csv: join(at, 'list.csv'), yaml: join(at, 'my-list.yaml') };
}

test('a mapping argument with a path or a .yaml ending is a file; a via ending in .yaml is a file next to it', () => {
  for (const name of ['./my-list.yaml', 'my-list.yml', 'lists/my-list', 'C:\\lists\\a']) assert.ok(isMappingFile(name), name);
  assert.ok(!isMappingFile('jichitai-opendata-site'));
  assert.ok(isViaFile('parts/address.yaml') && isViaFile('../a.yml'));
  assert.ok(!isViaFile('common/JapaneseAddress/jichitai-opendata-address'));
});

test('convert reads a mapping file of your own; its via names a catalog mapping or a file next to it', async () => {
  const { csv, yaml } = await listWith('own', OWN_MAPPING);
  const r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--site', SITE_DIR);
  assert.equal(r.code, 0, r.stderr);
  const [a, b] = JSON.parse(r.stdout);
  assert.deepEqual(a, {
    id: 'urn:ngsi-ld:EvacuationSite:092011-1', type: 'EvacuationSite', externalSiteId: '1', localGovernmentCode: '092011', name: '中央小学校',
    address: { addressCountry: 'JP', addressText: '栃木県宇都宮市中央本町1-29' }, location: { type: 'Point', coordinates: [139.8847723, 36.55925966] }, maxCapacity: 1200,
  });
  assert.ok(site.validate(b), site.errorsText(site.validate.errors));
  assert.match(r.stderr, /2 row\(s\), 2 valid EvacuationSite, 0 invalid/);
});

test('a mapping file of your own that cannot be applied, or is not finished, stops convert', async () => {
  // An unknown transform: before any row, as for a catalog mapping.
  let { csv, yaml } = await listWith('bad-transform', OWN_MAPPING.replace('transform: integer', 'transform: int'));
  let r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /the mapping cannot be applied:\n {2}maxCapacity: unknown transform "int" \(known: /);
  assert.equal(r.stdout, '');
  // An attribute the model does not have, and a TODO that datamodels mapping wrote.
  ({ csv, yaml } = await listWith('unfinished', `${OWN_MAPPING}  nmae: { column: 施設名 }\n  telephone: {}  # TODO: which column?\n`));
  r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /the mapping is not finished:\n {2}nmae: not an attribute of EvacuationSite\n {2}\S+my-list\.yaml line 12: a TODO is left: telephone: \{\} {2}# TODO: which column\?/);
  assert.equal(r.stdout, '');
  // A via file or the mapping file that is not there, or a file that is not YAML.
  ({ csv, yaml } = await listWith('no-via', OWN_MAPPING.replace('parts/address.yaml', 'parts/nothing.yaml')));
  r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /parts\/nothing\.yaml: ENOENT/);
  r = await datamodels('convert', 'disaster/EvacuationSite', join(dir, 'none.yaml'), csv, '--site', SITE_DIR);
  assert.match(r.stderr, /none\.yaml: ENOENT/);
  ({ csv, yaml } = await listWith('not-yaml', 'fields: { a: [\n'));
  r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /my-list\.yaml: not valid YAML: /);
});

test('vias between files of your own: each file is read once, and a cycle is reported', async () => {
  const { csv, yaml } = await listWith('cycle', `${OWN_MAPPING}  description: {}  # TODO: which column?\n`);
  await writeFile(join(dir, 'cycle', 'parts', 'address.yaml'), 'fields:\n  addressText: { column: 住所 }\n  machiaza: { via: ../my-list.yaml }\n');
  const r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--check', '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.match(/a TODO is left/g).length, 1, r.stderr);
  assert.match(r.stderr, /line 2: address: via cycle \/\S+\/cycle\/parts\/address\.yaml → \/\S+\/cycle\/my-list\.yaml → /);
});

test('--check converts the first rows, writes nothing and ends with a summary line', async () => {
  const many = Array.from({ length: 25 }, (_, i) => `${i + 1},92011,学校${i + 1},栃木県宇都宮市,36.5,139.8,100`);
  const { csv, yaml } = await listWith('check', OWN_MAPPING, own(many));
  let r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--check', '--site', SITE_DIR);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^\S+list\.csv: utf-8, checked 20 of 25 row\(s\) with /);
  assert.equal(lastLine(r.stderr), '20 of 20 rows valid');
  r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--check', '--rows', '3', '--site', SITE_DIR);
  assert.equal(lastLine(r.stderr), '3 of 3 rows valid');
  // A catalog mapping can be checked too.
  r = await datamodels('convert', 'disaster/EvacuationSite', 'jichitai-opendata-site', csv, '--check', '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not in the file, so left empty: ID, 全国地方公共団体コード, 名称/);
  assert.match(r.stderr, /required, but no row gets a value: name; localGovernmentCode; one of externalSiteId, nationalShelterId/);
  assert.equal(lastLine(r.stderr), '0 of 20 rows valid; 1 problem(s) in the mapping');
});

test('--check reports a column the file lacks, invalid rows with their first errors, duplicate ids, ids in exponent form and TODOs', async () => {
  const rows = [ROW1, '1,92011,中央小学校（別館）,栃木県宇都宮市,36.5,139.8,10', '1.31E+11,92011,東小学校,栃木県宇都宮市,36.5,139.8,10', '4,92011,西小学校,栃木県宇都宮市,北緯36度,139.8,10'];
  const { csv, yaml } = await listWith('check-bad', `${OWN_MAPPING}  telephone: { column: 電話 }\n  url: {}  # TODO: which column?\n`, own(rows));
  const r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--check', '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mapping: \S+my-list\.yaml line 12: a TODO is left: url: \{\}/);
  assert.match(r.stderr, /not in the file, so left empty: 電話/);
  assert.match(r.stderr, /line 2: id: urn:ngsi-ld:EvacuationSite:092011-1 is not unique \(also line 3\)/);
  assert.match(r.stderr, /line 3: id: urn:ngsi-ld:EvacuationSite:092011-1 is not unique \(also line 2\)/);
  assert.match(r.stderr, /line 4: id: externalSiteId is 1\.31E\+11, a number in exponent form/);
  assert.match(r.stderr, /line 5: location: 緯度: 北緯36度 is not a number|line 5: .*not all numbers/);
  // The TODO and the column 電話: a column the file lacks is most often a typo in a file of your own.
  assert.equal(lastLine(r.stderr), '0 of 4 rows valid; 2 problem(s) in the mapping');
  // convert itself reports duplicate and rounded ids as invalid rows (#56); the rest is written.
  const { csv: c2, yaml: y2 } = await listWith('dup', OWN_MAPPING, own([ROW1, ROW1.replace('中央小学校', '別館'), ROW2.replace(/^2/, '1.31E+11')]));
  const all = await datamodels('convert', 'disaster/EvacuationSite', y2, c2, '--site', SITE_DIR);
  assert.equal(all.code, 1);
  assert.deepEqual(JSON.parse(all.stdout), []);
  assert.match(all.stderr, /3 row\(s\), 0 valid EvacuationSite, 3 invalid/);
});

test('--check shows the first three schema errors of a row', async () => {
  const { csv, yaml } = await listWith('schema', `convert:\n  id: "urn:ngsi-ld:EvacuationSite:{externalSiteId}"\nfields:\n  externalSiteId: { column: 番号 }\n  localGovernmentCode: { column: 団体コード }\n  name: { column: 施設名 }\n`, own(['1,abc,x,y,1,1,1']));
  const r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--check', '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /line 2: data\/localGovernmentCode must match pattern/);
  assert.equal(lastLine(r.stderr), '0 of 1 rows valid');
});

test('--check and --rows: usage errors', async () => {
  const { csv, yaml } = await listWith('usage', OWN_MAPPING);
  for (const [args, message] of [
    [['--rows', '5'], /^--rows is for --check\nusage: datamodels convert /],
    [['--check', '--out', join(dir, 'x.json')], /^--check writes nothing; leave out --out/],
    [['--check', '--normalized'], /^--check writes nothing; leave out --normalized/],
    [['--check', '--rows', '0'], /^--rows needs a whole number above 0/],
    [['--check', '--rows', 'many'], /^--rows needs a whole number above 0/],
  ]) {
    const r = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, ...args, '--site', SITE_DIR);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.stderr, message, args.join(' '));
  }
});

test('mapping writes a first mapping: the columns that fit, transforms by type, TODOs, the unused columns', async () => {
  const csv = join(dir, 'en.csv');
  await writeFile(csv, 'site_id,Name,name_kana,Postal Code,lat,lng,maxcapacity,designated_shelter,local_government_code,notes\nA1,Central School,チュウオウ,320-0000,36.55,139.88,1200,1,92011,\n');
  const out = join(dir, 'en.yaml');
  const r = await datamodels('mapping', 'disaster/EvacuationSite', csv, '--out', out, '--site', SITE_DIR);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /6 of 31 attributes and fields have a column; 26 TODO\(s\)/);
  assert.match(r.stderr, /columns no row reads: site_id, designated_shelter, notes/);
  const text = await readFile(out, 'utf8');
  const m = YAML.parse(text);
  assert.deepEqual(m.fields.name, { column: 'Name' });
  assert.deepEqual(m.fields.nameKana, { column: 'name_kana' });
  assert.deepEqual(m.fields['address.postalCode'], { column: 'Postal Code' });
  assert.deepEqual(m.fields.localGovernmentCode, { column: 'local_government_code', transform: 'code6' });
  assert.deepEqual(m.fields.location, { column: ['lng', 'lat'], transform: 'geometry' });
  assert.deepEqual(m.fields.maxCapacity, { column: 'maxcapacity', transform: 'integer' });
  // No column found: a TODO with the transform the type needs.
  assert.deepEqual(m.fields.alsoDesignatedShelter, { transform: 'flag' });
  assert.deepEqual(m.fields.targetAreas, { transform: 'split' });
  assert.match(text, /^ {2}alsoDesignatedShelter: \{ transform: flag \} {2}# TODO: which column\?; true when the site is also a designated shelter$/m);
  assert.equal(m.convert.id, 'urn:ngsi-ld:EvacuationSite:{TODO}');
  assert.match(text, /# TODO: which attributes tell the rows apart\?/);
  // Required attributes first, then the group of which one is needed, then the rest.
  const keys = Object.keys(m.fields);
  assert.deepEqual(keys.slice(0, 4), ['name', 'localGovernmentCode', 'externalSiteId', 'nationalShelterId']);
  assert.match(text, /# Required: every entity needs these\.\n {2}name:/);
  assert.match(text, /# At least one of externalSiteId, nationalShelterId is required\./);
  assert.match(text, /# Columns of the CSV that no row above reads \(they stay out of the entities\):\n# {3}site_id\n# {3}designated_shelter\n# {3}notes\n$/);
  assert.match(text, new RegExp(`# {3}datamodels convert disaster/EvacuationSite ${out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${csv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --check`));

  // An existing file is never overwritten.
  const again = await datamodels('mapping', 'disaster/EvacuationSite', csv, '--out', out, '--site', SITE_DIR);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /en\.yaml: the file exists, not overwritten/);
  assert.equal(await readFile(out, 'utf8'), text);

  // Not finished: convert refuses it, and --check says why.
  let c = await datamodels('convert', 'disaster/EvacuationSite', out, csv, '--site', SITE_DIR);
  assert.equal(c.code, 1);
  assert.match(c.stderr, /the mapping is not finished:\n {2}\S+en\.yaml line \d+: a TODO is left: /);
  // With the TODOs filled (the id) or deleted (the rest), it converts.
  const done = text.replace(/^ {2}# TODO: which attributes.*\n/m, '').replace('{TODO}', '{localGovernmentCode}-{externalSiteId}').replace(/^ {2}externalSiteId: \{\}.*$/m, '  externalSiteId: { column: "site_id" }').split('\n').filter((l) => !/# TODO:/.test(l)).join('\n');
  await writeFile(join(dir, 'en-done.yaml'), done);
  c = await datamodels('convert', 'disaster/EvacuationSite', join(dir, 'en-done.yaml'), csv, '--check', '--site', SITE_DIR);
  assert.equal(c.code, 0, c.stderr);
  assert.equal(lastLine(c.stderr), '1 of 1 rows valid');
  c = await datamodels('convert', 'disaster/EvacuationSite', join(dir, 'en-done.yaml'), csv, '--site', SITE_DIR);
  assert.equal(c.code, 0, c.stderr);
  const [e] = JSON.parse(c.stdout);
  assert.deepEqual(e.address, { postalCode: '320-0000' });
  assert.equal(e.id, 'urn:ngsi-ld:EvacuationSite:092011-A1');
});

test('mapping reads Shift_JIS, writes Japanese comments, and takes column names from the catalog mappings', async () => {
  // "名称,緯度,経度,番号\n中央小学校,36.55925966,139.8847723,1\n" in Shift_JIS (iconv -t SHIFT_JIS).
  const sjis = Buffer.from('96bc8fcc2c88dc93782c8c6f93782c94d48d860a9286899b8fac8a778d5a2c33362e35353932353936362c3133392e383834373732332c310a', 'hex');
  const csv = join(dir, 'sjis.csv');
  await writeFile(csv, sjis);
  const r = await datamodels('mapping', 'disaster/EvacuationSite', csv, '--site', SITE_DIR);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /sjis\.csv: shift_jis, 4 column\(s\)/);
  const m = YAML.parse(r.stdout);
  assert.deepEqual(m.fields.name, { column: '名称' });
  assert.deepEqual(m.fields.location, { column: ['経度', '緯度'], transform: 'geometry' });
  assert.match(r.stdout, /^ {2}name: \{ column: "名称" \} {2}# jichitai-opendata-site と同じ; 指定緊急避難場所の名称/m);
  assert.match(r.stdout, /^ {2}nameKana: \{\} {2}# TODO：どの列？; 名称のカナ表記/m);
  assert.match(r.stdout, /どの行も読まない CSV の列（エンティティには入りません）：\n# {3}番号\n$/);
  // And convert --check reads the same file.
  const yaml = join(dir, 'sjis.yaml');
  await writeFile(yaml, 'convert:\n  id: "urn:ngsi-ld:EvacuationSite:{localGovernmentCode}-{externalSiteId}"\nfields:\n  name: { column: 名称 }\n  externalSiteId: { column: 番号 }\n  localGovernmentCode: { value: "092011" }\n  location: { column: [経度, 緯度], transform: geometry }\n');
  const c = await datamodels('convert', 'disaster/EvacuationSite', yaml, csv, '--check', '--site', SITE_DIR);
  assert.equal(c.code, 0, c.stderr);
  assert.match(c.stderr, /shift_jis, checked 1 of 1 row/);
});

test('a list with the columns of a catalog mapping gets a hint, that mapping\'s transforms and its id', async () => {
  const header = mappedColumns(site.mapping, site.mappings);
  const csv = join(dir, 'sheet03.csv');
  await writeFile(csv, `${header.join(',')}\n`);
  const r = await datamodels('mapping', 'disaster/EvacuationSite', csv, '--site', SITE_DIR);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`note: the header has ${header.length} of the ${header.length} columns of the catalog's mapping jichitai-opendata-site; if the list follows that standard, try: datamodels convert disaster/EvacuationSite jichitai-opendata-site `));
  assert.match(r.stdout, /# {3}datamodels convert disaster\/EvacuationSite jichitai-opendata-site \S+sheet03\.csv --check/);
  const m = YAML.parse(r.stdout);
  assert.equal(m.convert.id, site.mapping.convert.id);
  assert.deepEqual(m.fields['address.addressLocality'], { column: '所在地_市区町村', transform: 'municipality' });
  assert.deepEqual(m.fields['address.abrMachiazaId'], { column: '町字ID', transform: 'machiazaId' });
  assert.equal(m.fields.hazardTypes.transform, 'flags');
  assert.equal(Object.keys(m.fields.hazardTypes.values).length, 8);
});

test('mapping: an unknown model, a file that is not CSV, usage errors', async () => {
  const csv = join(dir, 'en.csv');
  let r = await datamodels('mapping', 'disaster/Nothing', csv, '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /disaster\/Nothing is not a model in https:\/\/datamodels\.jp\/catalog\.json/);
  r = await datamodels('mapping', 'common/JapaneseAddress', csv, '--site', SITE_DIR);
  assert.match(r.stderr, /common\/JapaneseAddress is a value type/);
  const bad = join(dir, 'bad.csv');
  await writeFile(bad, 'a,b\n"x\n');
  r = await datamodels('mapping', 'disaster/EvacuationSite', bad, '--site', SITE_DIR);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /bad\.csv: line 2: a quoted field is not closed/);
  r = await datamodels('mapping', 'disaster/EvacuationSite');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^missing arguments\nusage: datamodels mapping /);
});

test('columns are matched only when the fit is clear; equal fits are left as candidates', () => {
  const t = (name, extra = {}) => ({ name, kind: 'scalar', value: { type: 'string' }, texts: {}, prop: {}, ...extra });
  const targets = [t('telephone', { texts: { ja: '連絡先の電話番号' } }), t('faxNumber', { texts: { ja: 'FAX 番号' } }), t('address.postalCode', { part: 'postalCode' })];
  const { chosen, maybe } = matchColumns(targets, ['電話', '番号', 'postal_code']);
  assert.deepEqual(chosen.get('address.postalCode').cols, ['postal_code']);
  assert.equal(chosen.has('telephone'), false, '電話 and 番号 both fit part of the name');
  assert.deepEqual(maybe.get('telephone'), ['電話', '番号']);
  // An exact name wins over a looser fit of another column.
  assert.deepEqual(matchColumns([t('name')], ['Name', 'name']).chosen.get('name').cols, ['name']);
  assert.equal(flowRule({ column: 'a, b', transform: 'code6' }), '{ column: "a, b", transform: code6 }');
  assert.equal(flowRule({}), '{}');
});

test('the CSV template converts without a mapping file: export it, fill two rows, convert, validate', async () => {
  const siteFetch = async (url) => {
    try { const text = await readFile(join(SITE_DIR, new URL(url).pathname), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(text) }; } catch { return { ok: false, status: 404 }; }
  };
  const exported = await exportModel('disaster/EvacuationSite', ['csv'], { index: 'https://datamodels.jp/catalog.json', fetch: siteFetch });
  const header = exported.files[0].content.trim().split(',');
  // The rules come from the same columns as the template.
  const model = await siteModel(reader, 'disaster/EvacuationSite');
  assert.deepEqual(mappedColumns(templateMapping(model.columns)).sort(), [...header].sort());
  assert.ok(targetsOf(model.columns).some((x) => x.name === 'address.postalCode'));
  const values = (o) => header.map((h) => (o[h] === undefined ? '' : /[",]/.test(o[h]) ? `"${o[h].replace(/"/g, '""')}"` : o[h])).join(',');
  const csv = join(dir, 'EvacuationSite.csv');
  await writeFile(csv, `${exported.files[0].content}${values({
    id: 'urn:ngsi-ld:EvacuationSite:092011-1', name: '中央小学校', externalSiteId: '1', localGovernmentCode: '092011',
    'address.addressCountry': 'JP', 'address.postalCode': '320-0806', 'address.addressText': '栃木県宇都宮市中央本町1-29', 'address.localGovernmentCode': '092011',
    longitude: '139.8847723', latitude: '36.55925966', elevation: '120.5', hazardTypes: 'flood;earthquake', alsoDesignatedShelter: 'true', alsoWelfareShelter: 'FALSE', maxCapacity: '1200', targetAreas: '中央一丁目;中央二丁目',
  })}\n${values({ id: 'urn:ngsi-ld:EvacuationSite:E1310100002201', name: '番町小学校', nationalShelterId: 'E1310100002201', localGovernmentCode: '131016' })}\n`);
  const r = await datamodels('convert', 'disaster/EvacuationSite', 'csv-template', csv, '--site', SITE_DIR);
  assert.equal(r.code, 0, r.stderr);
  const [a, b] = JSON.parse(r.stdout);
  for (const e of [a, b]) assert.ok(site.validate(e), site.errorsText(site.validate.errors));
  assert.deepEqual(a, {
    id: 'urn:ngsi-ld:EvacuationSite:092011-1', type: 'EvacuationSite', name: '中央小学校', externalSiteId: '1', localGovernmentCode: '092011',
    address: { addressCountry: 'JP', postalCode: '320-0806', localGovernmentCode: '092011', addressText: '栃木県宇都宮市中央本町1-29' },
    location: { type: 'Point', coordinates: [139.8847723, 36.55925966] }, elevation: 120.5, hazardTypes: ['flood', 'earthquake'],
    alsoDesignatedShelter: true, alsoWelfareShelter: false, maxCapacity: 1200, targetAreas: ['中央一丁目', '中央二丁目'],
  });
  assert.deepEqual(b, { id: 'urn:ngsi-ld:EvacuationSite:E1310100002201', type: 'EvacuationSite', name: '番町小学校', nationalShelterId: 'E1310100002201', localGovernmentCode: '131016' });
  // A wrong value is reported as in any list.
  await writeFile(csv, `${exported.files[0].content}${values({ id: 'urn:ngsi-ld:EvacuationSite:x', name: 'x', externalSiteId: 'x', localGovernmentCode: '092011', alsoDesignatedShelter: 'yes' })}\n`);
  const bad = await datamodels('convert', 'disaster/EvacuationSite', 'csv-template', csv, '--check', '--site', SITE_DIR);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /line 2: alsoDesignatedShelter: alsoDesignatedShelter: yes is not true or false/);
});

test('help lists mapping and the options of --check', async () => {
  let r = await datamodels('--help');
  assert.match(r.stdout, /^ +mapping .*\w/m);
  r = await datamodels('convert', '--help');
  for (const option of ['--check', '--rows']) assert.match(r.stdout, new RegExp(`^ +${option} .*\\w`, 'm'), option);
  r = await datamodels('mapping', '--help');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^usage: datamodels mapping /);
  for (const option of ['--out', '--site']) assert.match(r.stdout, new RegExp(`^ +${option} .*\\w`, 'm'), option);
});

test('the starter mapping takes a catalog id only when each value in it is mapped itself, not only a field of it', async () => {
  const model = await siteModel(reader, 'disaster/EvacuationSite');
  const catalog = [{ name: 'x', mapping: { convert: { id: 'urn:ngsi-ld:EvacuationSite:{address}' }, fields: { address: { via: 'v' } } }, mappings: { v: { fields: { addressLocality: { column: '市区町村' } } } } }];
  const r = startMapping({ target: 'disaster/EvacuationSite', ...model, header: ['市区町村'], catalog, csv: 'a.csv' });
  assert.ok(r.chosen.has('address.addressLocality'));
  assert.equal(r.idTodo, true);
  assert.equal(YAML.parse(r.text).convert.id, 'urn:ngsi-ld:EvacuationSite:{TODO}');
});

test('mapping suggests yesno for a boolean column of 有 and 無, and weekdays and time for the fields of the opening hours (#54)', async () => {
  const csv = join(dir, 'aed.csv');
  await writeFile(csv, '名称,利用可能曜日,開始時間,終了時間,pediatricSupport,外部利用不可\n中央区役所,月火水木金土日,0:00,0:00,有,\n築地社会教育会館,月～金,9:00,21:00,無,\n');
  const r = await datamodels('mapping', 'facility/AEDLocation', csv, '--site', SITE_DIR);
  assert.equal(r.code, 0, r.stderr);
  const m = YAML.parse(r.stdout);
  assert.deepEqual(m.fields['openingHoursSpecification.dayOfWeek'], { column: '利用可能曜日', transform: 'weekdays' });
  assert.deepEqual(m.fields['openingHoursSpecification.opens'], { column: '開始時間', transform: 'time' });
  assert.deepEqual(m.fields['openingHoursSpecification.closes'], { column: '終了時間', transform: 'time' });
  assert.equal(m.fields.openingHoursSpecification, undefined);
  // The summary counts every TODO in the file, the one for 0:00–0:00 too.
  assert.equal(Number(/; (\d+) TODO\(s\)/.exec(r.stderr)[1]), r.stdout.match(/# TODO：/g).length);
  // The comments of the fields come from the value type's catalog texts.
  assert.match(r.stdout, /^ {2}openingHoursSpecification\.closes: .*# .*24:00 はその日の終わり/m);
  // A boolean: yesno when the rows hold 有 and 無, flag when the column is empty.
  assert.deepEqual(m.fields.pediatricSupport, { column: 'pediatricSupport', transform: 'yesno' });
  assert.deepEqual(m.fields.restrictedAccess, { column: '外部利用不可', transform: 'flag' });
  // The CSV template keeps the opening hours as one JSON column.
  const model = await siteModel(reader, 'facility/AEDLocation');
  assert.deepEqual(templateMapping(model.columns).fields.openingHoursSpecification, { column: 'openingHoursSpecification', transform: 'json' });
});

test('mapping asks what 0:00–0:00 means when the model has opening hours (convert.allDay), with or without an id template', async () => {
  const model = await siteModel(reader, 'facility/AEDLocation');
  const todo = /^ {2}# TODO: does the list write 0:00–0:00 \(openingHoursSpecification\)\? Say what it means: allDay: open .* or allDay: closed .*$/m;
  const a = startMapping({ target: 'facility/AEDLocation', ...model, header: ['name', 'opens', 'closes'], csv: 'a.csv' });
  assert.match(a.text, todo);
  assert.equal(a.allDayTodo, true);
  // Under convert:, after the id; once written in place of the TODO, convert reads it.
  const done = a.text.replace(todo, '  allDay: open');
  assert.equal(YAML.parse(done).convert.allDay, 'open');
  // An id column: the convert block holds only the TODO.
  const b = startMapping({ target: 'facility/AEDLocation', ...model, header: ['id', 'name'], csv: 'b.csv' });
  assert.match(b.text, /^convert:\n {2}# TODO: does the list write 0:00–0:00/m);
  assert.equal(YAML.parse(b.text.replace(todo, '  allDay: closed')).convert.allDay, 'closed');
  // In Japanese for a Japanese header; a model without opening hours gets no such TODO.
  assert.match(startMapping({ target: 'facility/AEDLocation', ...model, header: ['名称'], csv: 'c.csv' }).text, /^ {2}# TODO：一覧に 0:00～0:00 はありますか（openingHoursSpecification）？/m);
  const site = await siteModel(reader, 'disaster/EvacuationSite');
  const c = startMapping({ target: 'disaster/EvacuationSite', ...site, header: ['name'], csv: 'd.csv' });
  assert.equal(c.allDayTodo, false);
  assert.doesNotMatch(c.text, /allDay/);
});

test('mapping takes the values of a catalog rule along with its column', () => {
  const targets = [{ name: 'kind', kind: 'scalar', value: { type: 'string', enum: ['hospital'] }, texts: {} }];
  const catalog = [{ name: 'x', mapping: { fields: { kind: { column: '種類', values: { 病院: 'hospital' } } } }, mappings: {} }];
  const { chosen } = matchColumns(targets, ['種類'], catalog);
  assert.deepEqual(chosen.get('kind').rule, { values: { 病院: 'hospital' } });
  assert.equal(flowRule({ column: '種類', values: { 病院: 'hospital', '': false } }), '{ column: "種類", values: { "病院": "hospital", "": false } }');
});

test('a catalog rule with values and no transform stays a values lookup; for a boolean it is yesno with those values', async () => {
  const model = await siteModel(reader, 'facility/AEDLocation');
  const catalog = [{ name: 'x', mapping: { fields: {
    pediatricSupport: { column: '小児対応', values: { 有: true, 無: false } },
    restrictedAccess: { column: '外部', values: { 外部利用不可: 'yes' } },
  } }, mappings: {} }];
  const r = startMapping({ target: 'facility/AEDLocation', ...model, header: ['小児対応', '外部'], catalog, csv: 'a.csv' });
  const m = YAML.parse(r.text);
  assert.deepEqual(m.fields.pediatricSupport, { column: '小児対応', transform: 'yesno', values: { 有: true, 無: false } });
  // Values that are not true or false: no transform (flag takes no values); the schema then checks the value.
  assert.deepEqual(m.fields.restrictedAccess, { column: '外部', values: { 外部利用不可: 'yes' } });
  assert.deepEqual(mappingProblems({ fields: m.fields }), []);
});
