// The CSV converter (src/convert.mjs) on the shapes real lists have
// (geolonia/datamodels#85). Mapping files and schemas come from
// test/fixtures/site/, a copy of what datamodels.jp serves (npm run fixtures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { decodeCsv, parseCsv, code6, convertRows, mappingProblems, mappedColumns, LINE } from '../src/convert.mjs';
import { siteReader, loadTarget } from '../src/catalog.mjs';

const reader = siteReader(join(import.meta.dirname, 'fixtures', 'site'));
const site = await loadTarget(reader, 'disaster/EvacuationSite', 'jichitai-opendata-site');
const gsiSite = await loadTarget(reader, 'disaster/EvacuationSite', 'gsi-emergency-site');
const shelter = await loadTarget(reader, 'disaster/DesignatedShelter', 'gsi-designated-shelter');
const mappings = { ...site.mappings, ...gsiSite.mappings, ...shelter.mappings };
const validSite = site.validate;

test('encoding: UTF-8 with or without BOM, else Shift_JIS', () => {
  const enc = new TextEncoder();
  assert.deepEqual(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('ID,名称')])), { text: 'ID,名称', encoding: 'utf-8 (BOM)' });
  assert.deepEqual(decodeCsv(enc.encode('ID,名称')), { text: 'ID,名称', encoding: 'utf-8' });
  // "ID,名称" in Shift_JIS: 名 = 96 BC, 称 = 8F CC.
  assert.deepEqual(decodeCsv(new Uint8Array([0x49, 0x44, 0x2c, 0x96, 0xbc, 0x8f, 0xcc])), { text: 'ID,名称', encoding: 'shift_jis' });
});

test('CSV: quoted fields with commas, doubled quotes and line breaks; CRLF; blank lines', () => {
  assert.deepEqual(parseCsv('a,b,c\r\n"x, y","say ""hi""","line\nbreak"\r\n\r\n1,,3\r\n'), [
    { a: 'x, y', b: 'say "hi"', c: 'line\nbreak' },
    { a: '1', b: '', c: '3' },
  ]);
});

test('local government codes: kept, repaired when the check digit proves it, else reported', () => {
  assert.deepEqual(code6('131016'), { value: '131016' });
  assert.deepEqual(code6('92011'), { value: '092011', fix: { repair: 'restored the leading zero', detail: '92011 → 092011' } });
  assert.deepEqual(code6('13101'), { value: '131016', fix: { repair: 'added the check digit', detail: '13101 → 131016' } });
  assert.deepEqual(code6('1100'), { value: '011002', fix: { repair: 'restored the leading zero and added the check digit', detail: '1100 → 011002' } });
  assert.match(code6('131017').problem, /check digit does not match/);
  assert.match(code6('99999').problem, /not a local government code/);
});

// Utsunomiya's first row (自治体標準オープンデータセット 03, CC BY) as published:
// codes without their leading zero, the whole address in 所在地_市区町村.
const sheet03 = parseCsv([
  '全国地方公共団体コード,ID,名称,名称_カナ,所在地_全国地方公共団体コード,町字ID,所在地_連結表記,所在地_都道府県,所在地_市区町村,緯度,経度,電話番号,災害種別_洪水,災害種別_崖崩れ、土石流及び地滑り,災害種別_地震,指定避難所との重複,想定収容人数,対象となる町会・自治会',
  '92011,1,中央小学校,チュウオウショウガッコウ,92011,,栃木県宇都宮市中央本町1-29,栃木県,宇都宮市中央本町1-29,36.55925966,139.8847723,028-635-3043,1,1,1,1,,',
].join('\n'));

test('a sheet 03 row becomes a valid EvacuationSite, with every repair reported', () => {
  const [r] = convertRows(sheet03, site.mapping, { type: 'EvacuationSite', mappings });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.entity, {
    id: 'urn:ngsi-ld:EvacuationSite:092011-1', type: 'EvacuationSite', externalSiteId: '1', localGovernmentCode: '092011',
    name: '中央小学校', nameKana: 'チュウオウショウガッコウ',
    address: { addressCountry: 'JP', addressRegion: '栃木県', addressText: '栃木県宇都宮市中央本町1-29', localGovernmentCode: '092011' },
    location: { type: 'Point', coordinates: [139.8847723, 36.55925966] },
    telephone: '028-635-3043', hazardTypes: ['flood', 'landslide', 'earthquake'], alsoDesignatedShelter: true,
  });
  assert.ok(validSite(r.entity), site.errorsText(validSite.errors));
  assert.deepEqual(r.fixes.map((f) => `${f.field}: ${f.repair}`).sort(), [
    'addressLocality: left out 所在地_市区町村: not a municipality name',
    'localGovernmentCode: restored the leading zero',
    'localGovernmentCode: restored the leading zero',
  ]);
});

test('a GSI row becomes a valid EvacuationSite; the municipality comes from --set', () => {
  const rows = parseCsv('NO,共通ID,施設・場所名,住所,洪水,崖崩れ、土石流及び地滑り,高潮,地震,津波,大規模な火事,内水氾濫,火山現象,指定避難所との住所同一,緯度,経度,備考\n28,E1310100002201,番町小学校,東京都千代田区六番町8,1,,1,1,,,1,,1,35.688111802263,139.73407899331,');
  const [r] = convertRows(rows, gsiSite.mapping, { type: 'EvacuationSite', mappings, set: { localGovernmentCode: '13101' } });
  assert.deepEqual(r.problems, []);
  assert.ok(validSite(r.entity), site.errorsText(validSite.errors));
  assert.equal(r.entity.id, 'urn:ngsi-ld:EvacuationSite:E1310100002201');
  assert.equal(r.entity.localGovernmentCode, '131016');
  assert.equal(r.entity.address.localGovernmentCode, undefined, '--set is for the top level only');
  assert.deepEqual(r.entity.hazardTypes, ['flood', 'stormSurge', 'earthquake', 'inlandFlood']);
});

test('a row without the values the id needs is reported, not guessed', () => {
  const [r] = convertRows([{ 名称: 'x' }], site.mapping, { type: 'EvacuationSite', mappings });
  assert.match(r.problems.join(' '), /id: no localGovernmentCode, externalSiteId/);
  assert.equal(r.entity.id, undefined);
});

test('a flag is 1, 0 or empty; any other mark is reported instead of read as false', () => {
  const map = { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { to: 'n', column: 'n' }, f: { to: 'f', column: 'f', transform: 'flag' } } };
  const [one, empty, mark] = convertRows([{ n: 'a', f: '1' }, { n: 'b', f: '' }, { n: 'c', f: '○' }], map, { type: 'T' });
  assert.equal(one.entity.f, true);
  assert.equal(empty.entity.f, false);
  assert.deepEqual(mark.problems, ['f: f: ○ is not 1, 0 or empty']);
});

test('an invalid byte, an unclosed quote or a record of the wrong length is an error, not data', () => {
  assert.throws(() => decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xff])), /UTF-8 BOM but is not valid UTF-8/);
  // 0xFF is no byte of either (a lone 0x80 is U+0080 in Shift_JIS).
  assert.throws(() => decodeCsv(new Uint8Array([0x61, 0xff])), /neither valid UTF-8 nor valid Shift_JIS/);
  assert.throws(() => parseCsv('id,name\n1,"School'), /line 2: a quoted field is not closed/);
  assert.throws(() => parseCsv('a,b,c\n1,2\n"x\ny",2,3\n1,2,3,4\n'), /line 2: 2 fields, line 5: 4 fields \(the header has 3\)/);
  assert.deepEqual(parseCsv('a,b\n1,2,,\n'), [{ a: '1', b: '2' }], 'empty trailing fields, as spreadsheets write them');
});

test('flags report a mark other than 1, 0 or empty', () => {
  const map = { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { to: 'n', column: 'n' }, h: { to: 'h', transform: 'flags', values: { 洪水: 'flood', 地震: 'earthquake' } } } };
  const [ok1, bad] = convertRows([{ n: 'a', 洪水: '1', 地震: '' }, { n: 'b', 洪水: '1', 地震: '○' }], map, { type: 'T' });
  assert.deepEqual(ok1.entity.h, ['flood']);
  assert.deepEqual(bad.problems, ['h: 地震: ○ is not 1, 0 or empty']);
});

test('--set fills only what the row leaves empty; a value in the list wins and is reported', () => {
  const map = { convert: { id: 'urn:ngsi-ld:T:{code}' }, fields: { code: { to: 'code', column: 'code', transform: 'code6' } } };
  const [kept, filled] = convertRows([{ code: '92011' }, { code: '' }], map, { type: 'T', set: { code: '13101' } });
  assert.equal(kept.entity.code, '092011');
  assert.ok(kept.fixes.some((f) => f.repair === 'kept the value in the list over --set'));
  assert.equal(filled.entity.code, '131016');
});

test('a via cycle stops with a problem instead of recursing forever', () => {
  const loop = { fields: { address: { to: 'x', via: 'a/A/x' } } };
  const [r] = convertRows([{}], { convert: { id: 'urn:ngsi-ld:T:1{address}' }, fields: loop.fields }, { type: 'T', mappings: { 'a/A/x': loop } });
  assert.ok(r.problems.some((p) => p.startsWith('address: via cycle a/A/x → a/A/x')), r.problems.join('; '));
});

test('the contact postal code of sheet A is not taken as the address postal code', () => {
  assert.equal(mappings['common/JapaneseAddress/jichitai-opendata-address'].fields.postalCode.column, undefined);
});

test('a closing quote must end the field, a quote may only open one, and the header must name every column once', () => {
  assert.throws(() => parseCsv('id,name\n1,"School"extra\n'), /line 2: text after a closing quote/);
  assert.throws(() => parseCsv('id,name\n1,Sch"ool\n'), /line 2: a quote inside an unquoted field/);
  assert.throws(() => parseCsv(''), /no header row/);
  assert.throws(() => parseCsv('id,name,id\n1,2,3\n'), /header names must be present and distinct \(repeated: id\)/);
  assert.throws(() => parseCsv('id,,name\n1,2,3\n'), /header names must be present and distinct/);
  assert.deepEqual(parseCsv('id,name\n1,"a, ""b"""\n'), [{ id: '1', name: 'a, "b"' }]);
});

test('each row keeps the source line it starts on, past blank lines and line breaks inside quotes', () => {
  const rows = parseCsv('id,note\n1,"two\nlines"\n\n2,x\n');
  assert.deepEqual(rows.map((r) => r[LINE]), [2, 5]);
  assert.deepEqual(Object.keys(rows[0]), ['id', 'note'], 'the line is not a column');
});

test('--set does not fill a flags field', () => {
  const map = { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { to: 'n', column: 'n' }, h: { to: 'h', transform: 'flags', values: { 洪水: 'flood' } } } };
  const [r] = convertRows([{ n: 'a', 洪水: '' }], map, { type: 'T', set: { h: 'flood' } });
  assert.equal(r.entity.h, undefined);
});

test('a record of empty fields is left out but listed; a blank line is just ignored', () => {
  const rows = parseCsv('id,name\n1,a\n,\n\n2,b\n,\n');
  assert.deepEqual(rows.map((r) => r.id), ['1', '2']);
  assert.deepEqual(rows.skipped, [3, 6]);
  assert.deepEqual(parseCsv('id,name\n1,a\n').skipped, []);
});

test('a GSI designated shelter row becomes a valid DesignatedShelter; its type comes from the common ID', () => {
  const rows = parseCsv('NO,共通ID,施設・場所名,住所,指定緊急避難場所との住所同一,その他市町村長が必要と認める事項,受入対象者,緯度,経度,備考\n1,E1310100005112,神田一橋中学校,東京都千代田区一ツ橋2-6-14,1,,,35.694133,139.7567743,\n');
  const map = shelter.mapping;
  const [r] = convertRows(rows, map, { type: 'DesignatedShelter', mappings, set: { localGovernmentCode: '13101' } });
  assert.deepEqual(r.problems, []);
  assert.ok(shelter.validate(r.entity), shelter.errorsText(shelter.validate.errors));
  assert.equal(r.entity.id, 'urn:ngsi-ld:DesignatedShelter:E1310100005112');
  assert.equal(r.entity.shelterType, 'general');
  assert.equal(r.entity.alsoEmergencyEvacuationSite, true);
  const type = (id) => convertRows([{ 共通ID: id }], map, { type: 'DesignatedShelter', mappings })[0];
  assert.equal(type('E1310100012121').entity.shelterType, 'welfare');
  assert.match(type('E1310100012201').problems.join(), /shelterType: 共通ID: E1310100012201 is not the ID of a designated shelter/, 'type 20 is an evacuation site');
});

test('a column the file does not have gives no value, not false; the columns read are listed', () => {
  const map = { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { to: 'n', column: 'n' }, f: { to: 'f', column: 'f', transform: 'flag' }, h: { to: 'h', transform: 'flags', values: { 洪水: 'flood', 地震: 'earthquake' } } } };
  const [r] = convertRows([{ n: 'a' }], map, { type: 'T' });
  assert.deepEqual(r.entity, { id: 'urn:ngsi-ld:T:a', type: 'T', n: 'a' });
  const [partly] = convertRows([{ n: 'b', 洪水: '1' }], map, { type: 'T' });
  assert.deepEqual(partly.entity.h, ['flood'], 'the flags columns that are there still count');
  assert.deepEqual(mappedColumns(map), ['n', 'f', '洪水', '地震']);
  assert.ok(mappedColumns(site.mapping, site.mappings).includes('所在地_連結表記'), 'through via');
  assert.deepEqual(parseCsv('a,b\n1,2\n').columns, ['a', 'b']);
});

test('an unknown transform or a missing via mapping is found before any row is read', () => {
  const map = { fields: { a: { to: 'a', column: 'a', transform: 'upper' }, b: { to: 'b', via: 'x/X/y' } } };
  assert.deepEqual(mappingProblems(map, {}), [
    'a: unknown transform "upper" (known: text, code6, number, integer, numbers, flag, flags, split, municipality, machiazaId, nationalShelterType)',
    'b: no mapping x/X/y',
  ]);
  const inner = { fields: { c: { to: 'c', column: 'c', transform: 'lower' } } };
  assert.match(mappingProblems({ fields: { b: { to: 'b', via: 'x/X/y' } } }, { 'x/X/y': inner }).join(), /^x\/X\/y: c: unknown transform "lower"/);
  for (const t of [site, gsiSite, shelter]) assert.deepEqual(mappingProblems(t.mapping, t.mappings), []);
});
