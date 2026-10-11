// The CSV converter (src/convert.mjs) on the shapes real lists have
// (geolonia/datamodels#85). Mapping files and schemas come from
// test/fixtures/site/, a copy of what datamodels.jp serves (npm run fixtures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { decodeCsv, parseCsv, code6, convertRows, mappingProblems, mappedColumns, unknownFields, exponentForm, weekdays, time, TRANSFORMS, LINE } from '../src/convert.mjs';
import { siteReader, loadTarget } from '../src/catalog.mjs';

const reader = siteReader(join(import.meta.dirname, 'fixtures', 'site'));
const site = await loadTarget(reader, 'disaster/EvacuationSite', 'jichitai-opendata-site');
const gsiSite = await loadTarget(reader, 'disaster/EvacuationSite', 'gsi-emergency-site');
const shelter = await loadTarget(reader, 'disaster/DesignatedShelter', 'gsi-designated-shelter');
const aed = await loadTarget(reader, 'facility/AEDLocation', 'jichitai-opendata-aed');
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
    `a: unknown transform "upper" (known: ${TRANSFORMS.join(', ')})`,
    'b: no mapping x/X/y',
  ]);
  const inner = { fields: { c: { to: 'c', column: 'c', transform: 'lower' } } };
  assert.match(mappingProblems({ fields: { b: { to: 'b', via: 'x/X/y' } } }, { 'x/X/y': inner }).join(), /^x\/X\/y: c: unknown transform "lower"/);
  for (const t of [site, gsiSite, shelter, aed]) assert.deepEqual(mappingProblems(t.mapping, t.mappings), []);
});

test('an explicit empty record in a one-column file is listed, like ",," in a wider one', () => {
  const rows = parseCsv('only\n""\nvalue\n\n""');
  assert.deepEqual(rows.map((r) => r.only), ['value']);
  assert.deepEqual(rows.skipped, [2, 5], 'the quoted empty records, also the last one without a line break; not the blank line');
  assert.deepEqual(parseCsv('only\nvalue\n\n').skipped, [], 'blank lines stay ignored');
});

test('the same id on several rows is a problem of each of them (#56)', () => {
  const map = { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { column: 'n' } } };
  const rows = parseCsv('n\na\nb\na\na\n');
  const [first, other, second, third] = convertRows(rows, map, { type: 'T' });
  assert.deepEqual(other.problems, []);
  assert.deepEqual(first.problems, ['id: urn:ngsi-ld:T:a is not unique (also line 4, line 5)']);
  assert.deepEqual(second.problems, ['id: urn:ngsi-ld:T:a is not unique (also line 2, line 5)']);
  assert.equal(third.problems.length, 1);
  assert.match(convertRows([{ n: 'x' }, { n: 'x' }], map, { type: 'T' })[0].problems[0], /also row 2/, 'rows without a line are counted');
});

test('an id value in exponent form is lost digits, not an id (#56)', () => {
  assert.ok(exponentForm('1.31E+11') && exponentForm('1E+12') && exponentForm('-2.5e-3'));
  assert.ok(!exponentForm('131000000000') && !exponentForm('E1310100002201') && !exponentForm('1.5'));
  const map = { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { column: 'ID' } } };
  const [r] = convertRows([{ ID: '1.31E+11' }], map, { type: 'T' });
  assert.equal(r.entity.id, undefined);
  assert.deepEqual(r.problems, ['id: n is 1.31E+11, a number in exponent form: a spreadsheet rounded it and its digits are lost']);
  // An integer transform would turn it into 131000000000: the column as written is what counts.
  const [int] = convertRows([{ ID: '1.31E+11' }], { ...map, fields: { n: { column: 'ID', transform: 'integer' } } }, { type: 'T' });
  assert.match(int.problems.join(), /n is 1\.31E\+11/);
  // Chuo City's AED list writes every id as 1.31E+11: each row is reported, and none gets an id.
  const all = convertRows(parseCsv('ID\n1.31E+11\n1.31E+11\n'), map, { type: 'T' });
  assert.ok(all.every((x) => x.entity.id === undefined && x.problems.length === 1));
  const [direct] = convertRows([{ id: '1.3E+12' }], { fields: { id: { column: 'id' } } }, { type: 'T' });
  assert.match(direct.problems.join(), /1\.3E\+12 is a number in exponent form/);
});

test('a field with a dot fills a field of a value; a field id is the entity id as it is', () => {
  const map = { fields: { id: { column: 'id' }, 'address.postalCode': { column: 'zip' }, 'address.addressRegion': { column: 'pref' }, name: { column: 'name' } } };
  const [r] = convertRows([{ id: 'urn:ngsi-ld:T:1', zip: '100-0001', pref: '東京都', name: 'x' }], map, { type: 'T' });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.entity, { id: 'urn:ngsi-ld:T:1', type: 'T', address: { postalCode: '100-0001', addressRegion: '東京都' }, name: 'x' });
  const [empty] = convertRows([{ id: 'urn:ngsi-ld:T:2', zip: '', pref: '', name: 'y' }], map, { type: 'T' });
  assert.equal(empty.entity.address, undefined, 'no value, no object');
  const both = { fields: { id: { column: 'id' }, address: { value: { addressCountry: 'JP' } }, 'address.postalCode': { column: 'zip' } } };
  const [one, two] = convertRows([{ id: 'urn:ngsi-ld:T:1', zip: '100-0001' }, { id: 'urn:ngsi-ld:T:2', zip: '' }], both, { type: 'T' });
  assert.deepEqual(one.entity.address, { addressCountry: 'JP', postalCode: '100-0001' });
  assert.deepEqual(two.entity.address, { addressCountry: 'JP' }, 'the value of the mapping is not changed by a row');
  const [clash] = convertRows([{ a: '1', b: '2' }], { fields: { id: { column: 'a' }, addr: { column: 'a' }, 'addr.x': { column: 'b' } } }, { type: 'T' });
  assert.match(clash.problems.join(), /addr\.x: addr already has a value of its own/);
  // A template that is only one value takes it as it is; inside a longer id it is encoded.
  const whole = { convert: { id: '{u}' }, fields: { u: { column: 'u' } } };
  assert.equal(convertRows([{ u: 'urn:ngsi-ld:T:a b' }], whole, { type: 'T' })[0].entity.id, 'urn:ngsi-ld:T:a b');
  const part = { convert: { id: 'urn:ngsi-ld:T:{address.postalCode}' }, fields: { 'address.postalCode': { column: 'zip' } } };
  assert.equal(convertRows([{ zip: '100 0001' }], part, { type: 'T' })[0].entity.id, 'urn:ngsi-ld:T:100%200001');
});

test('boolean, geometry and json transforms', () => {
  const map = { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { column: 'n' }, b: { column: 'b', transform: 'boolean' }, p: { column: ['lon', 'lat'], transform: 'geometry' }, g: { column: ['lon', 'lat', 'geo'], transform: 'geometry' }, j: { column: 'j', transform: 'json' } } };
  const poly = '{"type":"Polygon","coordinates":[[[139,35],[139.1,35],[139.1,35.1],[139,35]]]}';
  const [a, b, c] = convertRows([
    { n: 'a', b: 'TRUE', lon: '139.7', lat: '35.6', geo: '', j: '{"k":[1,2]}' },
    { n: 'b', b: '', lon: '', lat: '', geo: poly, j: '' },
    { n: 'c', b: 'yes', lon: '139.7', lat: '', geo: '{"type":"Point"}', j: '{' },
  ], map, { type: 'T' });
  assert.deepEqual(a.problems, []);
  assert.deepEqual([a.entity.b, a.entity.p, a.entity.g, a.entity.j], [true, { type: 'Point', coordinates: [139.7, 35.6] }, { type: 'Point', coordinates: [139.7, 35.6] }, { k: [1, 2] }]);
  assert.deepEqual(b.problems, []);
  assert.deepEqual([b.entity.b, b.entity.p, b.entity.g.type, b.entity.j], [undefined, undefined, 'Polygon', undefined]);
  assert.deepEqual(c.problems, ['b: b: yes is not true or false', 'p: lon, lat: 139.7, (empty) is not a longitude and a latitude', 'g: lon, lat: 139.7, (empty) is not a longitude and a latitude', 'j: j: not JSON']);
  const one = { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { column: 'n' }, g: { column: 'geo', transform: 'geometry' } } };
  assert.deepEqual(convertRows([{ n: 'x', geo: '{"type":"Point"}' }], one, { type: 'T' })[0].problems, ['g: geo: not a GeoJSON geometry']);
});

test('the structure of a mapping of your own is checked before any row is read', () => {
  assert.deepEqual(mappingProblems({ convert: { id: 'urn:ngsi-ld:T:1' }, fields: { a: { column: 'a' } } }), ['convert.id must be a template such as "urn:ngsi-ld:Type:{attribute}"']);
  assert.match(mappingProblems({ fields: ['a'] }).join(), /fields must map each attribute to a rule/);
  assert.deepEqual(mappingProblems({ fields: { a: 'a', b: { column: 3 }, c: { column: ['x'], transform: 'geometry' }, d: { column: ['x', 'y', 'z', 'w'], transform: 'geometry' }, e: { transform: 'flags' }, f: null, g: {} } }), [
    'a: a rule must be a mapping, such as { column: 名称 }',
    'b: column must be a column name or a list of them',
    'd: transform geometry reads 1 to 3 columns, got 4',
    'e: transform flags needs values, as column: value',
  ]);
  assert.deepEqual(unknownFields({ fields: { name: {}, nmae: {}, 'address.postalCode': {}, 'adress.x': {}, id: {}, type: {} } }, { title: 'T', properties: { id: {}, type: {}, name: {}, address: {} } }), [
    'nmae: not an attribute of T', 'adress.x: not an attribute of T', 'type: not an attribute of T',
  ]);
});

test('a value for a whole object and its dotted fields merge in any order; a scalar and fields clash', () => {
  const rows = [{ id: 'urn:ngsi-ld:T:1', zip: '100-0001' }];
  const fields = { id: { column: 'id' }, address: { value: { addressCountry: 'JP', postalCode: 'none' } }, 'address.postalCode': { column: 'zip' } };
  const reversed = { id: fields.id, 'address.postalCode': fields['address.postalCode'], address: fields.address };
  for (const f of [fields, reversed]) {
    const [r] = convertRows(rows, { fields: f }, { type: 'T' });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.entity.address, { addressCountry: 'JP', postalCode: '100-0001' }, Object.keys(f).join(', '));
  }
  const [ordered] = convertRows([{ id: 'urn:ngsi-ld:T:1', zip: '1', n: 'x' }], { fields: { id: fields.id, 'address.postalCode': fields['address.postalCode'], name: { column: 'n' } } }, { type: 'T' });
  assert.deepEqual(Object.keys(ordered.entity), ['id', 'type', 'address', 'name'], 'the attributes keep the order of the mapping');
  assert.deepEqual(fields.address.value, { addressCountry: 'JP', postalCode: 'none' }, 'the mapping is not changed');
  const [clash] = convertRows([{ a: 'x', b: '2' }], { fields: { id: { value: 'urn:ngsi-ld:T:1' }, 'addr.x': { column: 'b' }, addr: { column: 'a' } } }, { type: 'T' });
  assert.deepEqual(clash.problems, ['addr.x: addr already has a value of its own'], 'also when the field with a dot comes first');
});

test('an id value in exponent form is found through via, before a transform turns it into a number (#56)', () => {
  const map = { convert: { id: 'urn:ngsi-ld:T:{address.code}' }, fields: { address: { via: 'a/A/x' } } };
  const sub = { fields: { code: { column: 'CODE', transform: 'integer' } } };
  const [r] = convertRows([{ CODE: '1.31E+11' }], map, { type: 'T', mappings: { 'a/A/x': sub } });
  assert.equal(r.entity.address.code, 131000000000);
  assert.equal(r.entity.id, undefined);
  assert.match(r.problems.join(), /address\.code is 1\.31E\+11, a number in exponent form/);
  // And through a dotted field name.
  const [d] = convertRows([{ CODE: '1.31E+11' }], { convert: map.convert, fields: { 'address.code': sub.fields.code } }, { type: 'T' });
  assert.match(d.problems.join(), /address\.code is 1\.31E\+11/);
});

test('a transform of one value reads exactly one column', () => {
  assert.deepEqual(mappingProblems({ fields: { a: { column: ['x', 'y'], transform: 'integer' }, b: { column: ['x', 'y'] }, c: { column: ['x'], transform: 'numbers' }, d: { column: ['x', 'y'], transform: 'numbers' }, e: { column: 'x' } } }), [
    'a: transform integer reads exactly 1 column, got 2',
    'b: a rule without a transform reads exactly 1 column, got 2',
    'c: transform numbers reads at least 2 columns, got 1',
  ]);
});

test('thousands of rows with one id are reported quickly (#56)', () => {
  const map = { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { column: 'n' } } };
  const rows = Array.from({ length: 30000 }, () => ({ n: 'same' }));
  const start = performance.now();
  const results = convertRows(rows, map, { type: 'T' });
  const ms = performance.now() - start;
  assert.equal(results[29999].problems[0], 'id: urn:ngsi-ld:T:same is not unique (also row 1, row 2, row 3, row 4, row 5, and 29994 more)');
  assert.ok(ms < 1500, `${Math.round(ms)} ms`);
});

// One column of a facility list into one value (#54). The rows are as the lists write them:
// 13 公衆トイレ (有/無), 10 医療機関 (医療機関の種類, 災害拠点分類), 08 AED (曜日, 時間).
const one = (field, rule, cells) => convertRows(cells.map((c, i) => ({ n: String(i), ...(c === undefined ? {} : { c }) })), { convert: { id: 'urn:ngsi-ld:T:{n}' }, fields: { n: { column: 'n' }, [field]: { column: 'c', ...rule } } }, { type: 'T' });

test('yesno: 有 and 無, あり and なし, ○ and × are true and false; anything else is reported, never read as false', () => {
  const r = one('wheelchairToilet', { transform: 'yesno' }, ['有', '無', '有り', '無し', 'あり', 'なし', '○', '×', '', '不明', '1', undefined]);
  assert.deepEqual(r.slice(0, 8).map((x) => x.entity.wheelchairToilet), [true, false, true, false, true, false, true, false]);
  assert.ok(r.slice(0, 9).every((x) => !x.problems.length));
  // Empty, and a column the file does not have, give no value.
  assert.equal('wheelchairToilet' in r[8].entity, false);
  assert.equal('wheelchairToilet' in r[11].entity, false);
  assert.deepEqual(r[9].problems, ['wheelchairToilet: c: 不明 is not yes or no (有/無, 有り/無し, あり/なし, ○/×)']);
  assert.deepEqual(r[10].problems, ['wheelchairToilet: c: 1 is not yes or no (有/無, 有り/無し, あり/なし, ○/×)']);
});

test('yesno with values: the list\'s own words replace the default ones; "" gives an empty cell a value', () => {
  // 08 AED: 外部利用不可 says 外部利用不可 or nothing.
  const rule = { transform: 'yesno', values: { 外部利用不可: true, '': false } };
  const r = one('restrictedAccess', rule, ['外部利用不可', '', '有', undefined]);
  assert.deepEqual(r.map((x) => x.entity.restrictedAccess), [true, false, undefined, undefined]);
  assert.deepEqual(r[2].problems, ['restrictedAccess: c: 有 is not in values (外部利用不可)']);
});

test('values: each text of the list becomes the model\'s value; an unknown text is reported, empty is no value', () => {
  const kinds = { values: { 病院: 'hospital', 有床診療所: 'clinicWithBeds', 無床診療所: 'clinicWithoutBeds' } };
  const r = one('medicalInstitutionType', kinds, ['病院', '無床診療所', '', '一般診療所']);
  assert.deepEqual(r.map((x) => x.entity.medicalInstitutionType), ['hospital', 'clinicWithoutBeds', undefined, undefined]);
  assert.deepEqual(r.slice(0, 3).map((x) => x.problems), [[], [], []]);
  // Chuo City's list writes 一般診療所, which the definition sheet does not list: reported, not guessed.
  assert.deepEqual(r[3].problems, ['medicalInstitutionType: c: 一般診療所 is not in values (病院, 有床診療所, 無床診療所)']);
  // With split, each item of the list; the same value twice is kept once.
  const s = one('hazards', { transform: 'split', values: { 洪水: 'flood', 内水氾濫: 'flood', 地震: 'earthquake' } }, ['洪水;地震', '洪水；内水氾濫', '', '洪水;津波;高潮']);
  assert.deepEqual(s.map((x) => x.entity.hazards), [['flood', 'earthquake'], ['flood'], undefined, undefined]);
  assert.deepEqual(s[3].problems, ['hazards: c: 津波, 高潮 are not in values (洪水, 内水氾濫, 地震)']);
  // At most eight known texts are named in a problem.
  const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`v${i}`, i]));
  assert.match(one('x', { values: many }, ['w'])[0].problems[0], /\(v0, v1, v2, v3, v4, v5, v6, v7, …\)$/);
});

test('weekdays: the forms the lists use, ranges that wrap, and anything else reported', () => {
  const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  for (const text of ['月～金', '月〜金', '月-金', '月ー金', '月火水木金', '月・火・水・木・金', '月、火、水、木、金', '月曜日～金曜日', '平日', '12345', '1-5', '１２３４５']) assert.deepEqual(weekdays(text), WEEK, text);
  assert.deepEqual(weekdays('土日祝'), ['Saturday', 'Sunday', 'PublicHolidays']);
  assert.deepEqual(weekdays('土・日・祝日'), ['Saturday', 'Sunday', 'PublicHolidays']);
  assert.deepEqual(weekdays('毎日'), [...WEEK, 'Saturday', 'Sunday']);
  assert.deepEqual(weekdays('月火水木金土日'), [...WEEK, 'Saturday', 'Sunday']);
  assert.deepEqual(weekdays('火水木金土日'), ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  assert.deepEqual(weekdays('金～月'), ['Monday', 'Friday', 'Saturday', 'Sunday']);
  assert.deepEqual(weekdays('月～水・金'), ['Monday', 'Tuesday', 'Wednesday', 'Friday']);
  for (const text of ['月～金（祝日を除く）', '第2土曜', '不定休', '月～月', '月～水～金', '～金', '月～祝', '月・', '0', '8', '月 or 金']) assert.equal(weekdays(text), null, text);
  const r = one('dayOfWeek', { transform: 'weekdays' }, ['月～金', '', '第2・第4土曜']);
  assert.deepEqual(r.map((x) => x.entity.dayOfWeek), [WEEK, undefined, undefined]);
  assert.deepEqual(r[2].problems, ['dayOfWeek: c: 第2・第4土曜 is not a list of weekdays (such as 月～金, 月火水木金, 土日祝)']);
});

test('time: H:MM, H時 and full-width digits become HH:MM, each change reported; 24:00 is kept; other forms are reported', () => {
  for (const [text, want] of [['9:00', '09:00'], ['09:00', '09:00'], ['9時', '09:00'], ['9時30分', '09:30'], ['０:００', '00:00'], ['１７：３０', '17:30'], ['0:00', '00:00'], ['24:00', '24:00'], ['17:00:30', '17:00:30']]) assert.equal(time(text), want, text);
  for (const text of ['24:30', '25:00', '9:60', '0900', '9', '9.00', '午前9時', '9:00～17:00']) assert.equal(time(text), null, text);
  const r = one('opens', { transform: 'time' }, ['9:00', '09:00', '', '25:00']);
  assert.deepEqual(r.map((x) => x.entity.opens), ['09:00', '09:00', undefined, undefined]);
  assert.deepEqual(r[0].fixes, [{ field: 'opens', repair: 'wrote the time as HH:MM', detail: '9:00 → 09:00' }]);
  assert.deepEqual(r[1].fixes, []);
  assert.deepEqual(r[3].problems, ['opens: c: 25:00 is not a time (such as 9:00, 09:00 or 9時)']);
});

test('an AED row with weekdays, times and 有/無 becomes a valid AEDLocation; 24:00 opens is the schema\'s to reject', () => {
  // The catalog mapping with the transforms of #54, as the follow-up in geolonia/datamodels will have them.
  const hours = structuredClone(aed.mappings['common/OpeningHours/jichitai-opendata-hours']);
  Object.assign(hours.fields.dayOfWeek, { column: '利用可能曜日', transform: 'weekdays' });
  Object.assign(hours.fields.opens, { transform: 'time' });
  Object.assign(hours.fields.closes, { transform: 'time' });
  const map = structuredClone(aed.mapping);
  Object.assign(map.fields.pediatricSupport, { column: '小児対応設備の有無', transform: 'yesno' });
  Object.assign(map.fields.restrictedAccess, { column: '外部利用不可', transform: 'yesno', values: { 外部利用不可: true, '': false } });
  assert.deepEqual(mappingProblems(map, { ...aed.mappings, 'common/OpeningHours/jichitai-opendata-hours': hours }), []);
  // As Chuo City's list writes it (2026-10-11), with an ID of its own instead of 1.31E+11.
  const row = { 全国地方公共団体コード: '131024', ID: '1', 名称: '中央区役所', 緯度: '35.670599', 経度: '139.77201', 設置位置: '1階正面玄関受付横', 利用可能曜日: '月火水木金土日', 開始時間: '0:00', 終了時間: '0:00', 小児対応設備の有無: '有', 外部利用不可: '' };
  const convert = (r) => convertRows([r], map, { type: 'AEDLocation', mappings: { ...aed.mappings, 'common/OpeningHours/jichitai-opendata-hours': hours } })[0];
  const a = convert(row);
  assert.deepEqual(a.problems, []);
  assert.deepEqual(a.entity.openingHoursSpecification, { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '00:00', closes: '00:00' });
  assert.deepEqual([a.entity.pediatricSupport, a.entity.restrictedAccess], [true, false]);
  assert.deepEqual(a.fixes.map((f) => `${f.field}: ${f.detail}`), ['opens: 0:00 → 00:00', 'closes: 0:00 → 00:00']);
  assert.ok(aed.validate(a.entity), aed.errorsText(aed.validate.errors));
  // 24:00 closes the day; as an opening time the schema rejects it.
  const b = convert({ ...row, 利用可能曜日: '月～金', 開始時間: '9:00', 終了時間: '24:00' });
  assert.ok(aed.validate(b.entity), aed.errorsText(aed.validate.errors));
  assert.equal(aed.validate(convert({ ...row, 開始時間: '24:00' }).entity), false);
  // A weekday text, a time or a yes/no the transforms do not know: a problem of the row, nothing guessed.
  const c = convert({ ...row, 利用可能曜日: '平日（祝日を除く）', 開始時間: '9時半', 小児対応設備の有無: 'なし（成人用のみ）' });
  assert.deepEqual(c.problems, [
    'dayOfWeek: 利用可能曜日: 平日（祝日を除く） is not a list of weekdays (such as 月～金, 月火水木金, 土日祝)',
    'opens: 開始時間: 9時半 is not a time (such as 9:00, 09:00 or 9時)',
    'pediatricSupport: 小児対応設備の有無: なし（成人用のみ） is not yes or no (有/無, 有り/無し, あり/なし, ○/×)',
  ]);
});

test('values are checked before any row is read: a map, on a transform that takes it, true or false for yesno', () => {
  assert.deepEqual(mappingProblems({ fields: {
    a: { column: 'a', values: { 病院: 'hospital' } },
    b: { column: 'b', transform: 'split', values: { 洪水: 'flood' } },
    c: { column: 'c', transform: 'yesno', values: { 有: true, 無: false } },
    d: { column: 'd', transform: 'integer', values: { 一: 1 } },
    e: { column: 'e', values: ['病院'] },
    f: { column: 'f', values: {} },
    g: { column: 'g', transform: 'yesno', values: { 有: 'yes' } },
    h: { column: 'h', transform: 'weekdays' },
    i: { column: 'i', transform: 'time' },
    j: { column: ['j', 'k'], transform: 'time' },
  } }), [
    'd: transform integer takes no values (values work without a transform, with split and with yesno)',
    'e: values must give each text of the column its value, such as { 病院: hospital }',
    'f: values must give each text of the column its value, such as { 病院: hospital }',
    'g: the values of transform yesno must be true or false',
    'j: transform time reads exactly 1 column, got 2',
  ]);
  for (const t of ['yesno', 'weekdays', 'time']) assert.ok(TRANSFORMS.includes(t), t);
});
