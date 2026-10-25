// The normalized form (src/ngsi.mjs): typed dates follow the catalog's rule
// (geolonia/datamodels#183).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dateFormats, typedDate, toNormalized, toKeyValues, wrapKeyValues, unwrapKeyValues, attributeProblems, unclosedRings } from '../src/ngsi.mjs';

const either = { anyOf: [{ type: 'string', format: 'date' }, { type: 'string', format: 'date-time' }] };
const schema = {
  properties: {
    validFrom: { type: 'string', format: 'date-time' },
    openedOn: { type: 'string', format: 'date' },
    due: either,
    holidays: { type: 'array', items: { type: 'string', format: 'date' } },
    name: { type: 'string' },
  },
};

test('date formats come from format, anyOf and array items', () => {
  assert.deepEqual(dateFormats(schema.properties.validFrom), ['date-time']);
  assert.deepEqual(dateFormats(schema.properties.openedOn), ['date']);
  assert.deepEqual(dateFormats(either), ['date', 'date-time']);
  assert.deepEqual(dateFormats(schema.properties.holidays), ['date']);
  assert.deepEqual(dateFormats(schema.properties.name), []);
  assert.deepEqual(dateFormats(undefined), []);
});

test('a date is a Date, a date-time a DateTime; with either, the value decides', () => {
  assert.deepEqual(typedDate('2026-07-11', ['date']), { '@type': 'Date', '@value': '2026-07-11' });
  assert.deepEqual(typedDate('2026-07-08T09:00:00+09:00', ['date-time']), { '@type': 'DateTime', '@value': '2026-07-08T09:00:00+09:00' });
  assert.deepEqual(typedDate('2026-07-11', ['date', 'date-time']), { '@type': 'Date', '@value': '2026-07-11' });
  assert.deepEqual(typedDate('2026-07-11T17:00:00+09:00', ['date', 'date-time']), { '@type': 'DateTime', '@value': '2026-07-11T17:00:00+09:00' });
  // Not a string, or not a date attribute: unchanged.
  assert.equal(typedDate(42, ['date']), 42);
  assert.equal(typedDate('2026-07-11', []), '2026-07-11');
});

test('toNormalized types each date as its schema says, also inside arrays', () => {
  const out = toNormalized({
    id: 'urn:ngsi-ld:Thing:1', type: 'Thing',
    validFrom: '2026-07-08T09:00:00+09:00', openedOn: '2026-04-01', due: '2026-07-11',
    holidays: ['2026-05-03', '2026-05-04'], name: '2026-07-11',
  }, schema);
  assert.deepEqual(out.validFrom.value, { '@type': 'DateTime', '@value': '2026-07-08T09:00:00+09:00' });
  assert.deepEqual(out.openedOn.value, { '@type': 'Date', '@value': '2026-04-01' });
  assert.deepEqual(out.due.value, { '@type': 'Date', '@value': '2026-07-11' });
  assert.deepEqual(out.holidays.value, ['2026-05-03', '2026-05-04'], 'a list value stays a list');
  assert.equal(out.name.value, '2026-07-11', 'a text that looks like a date stays text');
});

const wrapped = {
  properties: {
    details: { type: 'object', 'x-ngsi': { type: 'JsonProperty' } },
    category: { type: 'string', 'x-ngsi': { type: 'VocabProperty' } },
    tags: { type: 'array', 'x-ngsi': { type: 'VocabProperty', multi: true } },
    name: { type: 'string' },
  },
};

test('a JsonProperty or VocabProperty: key-values keeps the wrapper, the normalized form takes its content', () => {
  const plain = { id: 'urn:ngsi-ld:Decision:1', type: 'Decision', details: { a: 1 }, category: 'approved', tags: ['x', 'y'], name: 'n' };
  const kv = wrapKeyValues(plain, wrapped);
  assert.deepEqual(kv, { ...plain, details: { json: { a: 1 } }, category: { vocab: 'approved' }, tags: [{ vocab: 'x' }, { vocab: 'y' }] });
  assert.deepEqual(unwrapKeyValues(kv, wrapped), plain);
  const normalized = toNormalized(kv, wrapped);
  assert.deepEqual(normalized.details, { type: 'JsonProperty', json: { a: 1 } });
  assert.deepEqual(normalized.category, { type: 'VocabProperty', vocab: 'approved' });
  assert.deepEqual(normalized.tags, [
    { type: 'VocabProperty', vocab: 'x', datasetId: 'urn:ngsi-ld:dataset:tags:1' },
    { type: 'VocabProperty', vocab: 'y', datasetId: 'urn:ngsi-ld:dataset:tags:2' },
  ]);
  assert.deepEqual(normalized.name, { type: 'Property', value: 'n' });
  assert.deepEqual(toKeyValues(normalized, { multi: new Set(['tags']) }), kv);
  // Without its wrapper the value is not key-values.
  assert.throws(() => toNormalized({ ...kv, details: { a: 1 } }, wrapped), /attribute details: a JsonProperty is \{"json": \.\.\.\} in key-values form/);
});


// The rules of a normalized entity, as data (#120): check and the datamodels.jp MCP server word them.
const rules = {
  properties: {
    id: { type: 'string' }, type: { const: 'Thing' }, '@context': { type: 'array' },
    route: { type: 'string', 'x-ngsi': { type: 'Property' } },
    plain: { type: 'string' },
    owner: { type: 'string', 'x-ngsi': { type: 'Relationship' } },
    tags: { type: 'array', 'x-ngsi': { type: 'Property', multi: true } },
    due: { type: 'string', format: 'date-time', 'x-ngsi': { type: 'Property' } },
    either: { ...either, 'x-ngsi': { type: 'Property' } },
    holidays: { type: 'array', items: { type: 'string', format: 'date' }, 'x-ngsi': { type: 'Property', multi: true } },
  },
};
const attrs = Object.entries(rules.properties);

test('attributeProblems: an entity that follows the rules has none', () => {
  assert.deepEqual(attributeProblems({
    '@context': ['x'], id: 'urn:ngsi-ld:Thing:1', type: 'Thing',
    route: { type: 'Property', value: 'R1' }, plain: { type: 'Property', value: 'p' },
    owner: { type: 'Relationship', object: 'urn:x' },
    tags: [{ type: 'Property', value: 'a', datasetId: 'urn:d:1' }, { type: 'Property', value: 'b' }],
    due: { type: 'Property', value: { '@type': 'DateTime', '@value': '2026-10-12T09:00:00+09:00' } },
    either: { type: 'Property', value: { '@type': 'Date', '@value': '2026-10-12' } },
    holidays: [{ type: 'Property', value: { '@type': 'Date', '@value': '2026-05-03' } }],
    unknown: [{ type: 'Relationship', object: 'urn:y' }],
  }, attrs), []);
});

test('attributeProblems: the attribute type follows x-ngsi.type, Property without it', () => {
  assert.deepEqual(attributeProblems({
    route: { type: 'Relationship', object: 'urn:x' },
    plain: { type: 'GeoProperty', value: { type: 'Point', coordinates: [0, 0] } },
    owner: { type: 'Property', value: 'urn:x' },
  }, attrs), [
    { attribute: 'route', rule: 'type', found: 'Relationship', expected: 'Property', implicit: false },
    { attribute: 'plain', rule: 'type', found: 'GeoProperty', expected: 'Property', implicit: true },
    { attribute: 'owner', rule: 'type', found: 'Property', expected: 'Relationship', implicit: false },
  ]);
  // One per instance; an instance that is not an attribute object, or has no type, is left to toKeyValues.
  assert.deepEqual(attributeProblems({ tags: [{ type: 'Relationship', object: 'a' }, 'b', null, { value: 'c' }, { type: 'GeoProperty', value: {} }] }, attrs), [
    { attribute: 'tags', rule: 'type', found: 'Relationship', expected: 'Property', implicit: false },
    { attribute: 'tags', rule: 'type', found: 'GeoProperty', expected: 'Property', implicit: false },
  ]);
});

test('attributeProblems: several instances only with x-ngsi.multi', () => {
  assert.deepEqual(attributeProblems({ route: [{ type: 'Property', value: 'a', datasetId: 'urn:d:1' }, { type: 'Property', value: 'b' }] }, attrs), [
    { attribute: 'route', rule: 'multi', instances: 2 },
  ]);
  // A list of one instance is a list too.
  assert.deepEqual(attributeProblems({ route: [{ type: 'Property', value: 'a' }] }, attrs), [{ attribute: 'route', rule: 'multi', instances: 1 }]);
  // With x-ngsi.multi, a single instance is fine too.
  assert.deepEqual(attributeProblems({ tags: { type: 'Property', value: 'a' } }, attrs), []);
});

test('attributeProblems: a date or date-time value carries its typed form', () => {
  const p = attributeProblems({
    due: { type: 'Property', value: '2026-10-12T09:00:00+09:00' },
    either: { type: 'Property', value: { '@type': 'DateTime', '@value': '2026-10-12' } },
    holidays: [{ type: 'Property', value: '2026-05-03' }, { type: 'Property', value: { '@type': 'Date', '@value': '2026-05-04' } }],
  }, attrs);
  assert.deepEqual(p, [
    { attribute: 'due', rule: 'date', found: '2026-10-12T09:00:00+09:00', expected: { '@type': 'DateTime', '@value': '2026-10-12T09:00:00+09:00' } },
    { attribute: 'either', rule: 'date', found: { '@type': 'DateTime', '@value': '2026-10-12' }, expected: { '@type': 'Date', '@value': '2026-10-12' } },
    { attribute: 'holidays', rule: 'date', found: '2026-05-03', expected: { '@type': 'Date', '@value': '2026-05-03' } },
  ]);
  // Not a string (the schema says so), or not a Property: no date rule.
  assert.deepEqual(attributeProblems({ due: { type: 'Property', value: 42 } }, attrs), []);
  assert.deepEqual(attributeProblems({ due: { type: 'Relationship', object: 'urn:x', value: '2026-01-01' } }, [['due', { format: 'date', 'x-ngsi': { type: 'Relationship' } }]]), []);
  // A Property attribute sent as a Relationship: its type problem only, its value is not checked as a date.
  assert.deepEqual(attributeProblems({ due: { type: 'Relationship', object: 'urn:x', value: '2026-01-01' } }, [['due', { format: 'date' }]]), [{ attribute: 'due', rule: 'type', found: 'Relationship', expected: 'Property', implicit: true }]);
});

test('attributeProblems: id, type, @context and names of Object.prototype are not special', () => {
  // id, type and @context are not attributes, even when the caller passes them.
  assert.deepEqual(attributeProblems({ id: ['x'], type: { type: 'Relationship' }, '@context': [{ type: 'GeoProperty' }] }, [['id', {}], ['type', {}], ['@context', {}]]), []);
  // An attribute the entity has only through its prototype is not there.
  assert.deepEqual(attributeProblems({}, [['constructor', { 'x-ngsi': { type: 'Relationship' } }], ['toString', {}]]), []);
  const proto = JSON.parse('{"__proto__": [{ "type": "Relationship", "object": "urn:x" }]}');
  assert.deepEqual(attributeProblems(proto, [['__proto__', {}]]), [
    { attribute: '__proto__', rule: 'multi', instances: 1 },
    { attribute: '__proto__', rule: 'type', found: 'Relationship', expected: 'Property', implicit: true },
  ]);
  // A schema that is not an object, or an x-ngsi that is not one, means Property.
  assert.deepEqual(attributeProblems({ a: { type: 'Relationship', object: 'u' }, b: { type: 'Relationship', object: 'u' } }, [['a', true], ['b', { 'x-ngsi': null }]]), [
    { attribute: 'a', rule: 'type', found: 'Relationship', expected: 'Property', implicit: true },
    { attribute: 'b', rule: 'type', found: 'Relationship', expected: 'Property', implicit: true },
  ]);
  // A value that is not a JSON object has no attributes.
  for (const v of [null, undefined, 7, 'x', [{ route: { type: 'Relationship' } }]]) assert.deepEqual(attributeProblems(v, attrs), [], String(v));
});

test('unclosedRings: paths as check writes them, or as JSON pointers', () => {
  const value = {
    area: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0, 0], [1, 1]]] },
    parts: [{ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 1], [2, 2]]], [[[0, 0], [1, 1], [0, 0]]]] }],
    'a/b~c': { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] },
  };
  assert.deepEqual(unclosedRings(value), ['$.area.coordinates[1]', '$.parts[0].coordinates[0][0]', '$.a/b~c.coordinates[0]']);
  assert.deepEqual(unclosedRings(value, { style: 'jsonpath' }), unclosedRings(value));
  assert.deepEqual(unclosedRings(value, { style: 'pointer' }), ['/area/coordinates/1', '/parts/0/coordinates/0/0', '/a~1b~0c/coordinates/0']);
  // The value itself, and a GeoProperty inside a normalized attribute.
  assert.deepEqual(unclosedRings({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }, { style: 'pointer' }), ['/coordinates/0']);
  assert.deepEqual(unclosedRings({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }), ['$.coordinates[0]']);
  assert.deepEqual(unclosedRings({ geo: { type: 'GeoProperty', value: { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] } } }, { style: 'pointer' }), ['/geo/value/coordinates/0']);
  // An empty ring and a ring that is not a list are left to the schema.
  assert.deepEqual(unclosedRings({ type: 'Polygon', coordinates: [[], 'x'] }), []);
  assert.deepEqual(unclosedRings({ type: 'MultiPolygon', coordinates: ['x', [[]]] }), []);
  // Positions compare by their numbers.
  assert.deepEqual(unclosedRings({ type: 'Polygon', coordinates: [[[0, 0, 5], [1, 1], [0, 0]]] }), ['$.coordinates[0]']);
  for (const v of [null, 7, 'x', []]) assert.deepEqual(unclosedRings(v), [], String(v));
  assert.throws(() => unclosedRings(value, { style: 'xpath' }), /unknown path style "xpath": use jsonpath or pointer/);
  // limit: at most that many paths, in the same order, and no more work than that.
  assert.deepEqual(unclosedRings(value, { limit: 2 }), unclosedRings(value).slice(0, 2));
  assert.deepEqual(unclosedRings(value, { limit: 0 }), []);
  assert.deepEqual(unclosedRings(value, { limit: 99 }), unclosedRings(value));
  for (const limit of [-1, 1.5, '2', null]) assert.throws(() => unclosedRings(value, { limit }), { name: 'TypeError', message: `unclosedRings: limit must be a whole number, got ${limit}` });
  // The old second argument, a path prefix, is refused rather than ignored.
  for (const [arg, got] of [['$', 'a string'], [null, 'null'], [['pointer'], 'an array']]) {
    assert.throws(() => unclosedRings(value, arg), { name: 'TypeError', message: `unclosedRings: the second argument is { style }, got ${got}` });
  }
});

test('src/ngsi.mjs imports nothing, so a browser or a Cloudflare Worker can load it', async () => {
  // @geolonia/datamodels/ngsi runs in the datamodels.jp MCP server (a Worker) and in browsers.
  const source = await readFile(new URL('../src/ngsi.mjs', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual([...code.matchAll(/\bimport\b[^\n]*|\bexport\b[^\n]*\bfrom\b[^\n]*|\brequire\s*\([^\n]*/g)].map((m) => m[0]), []);
  // And loading it resolves no other module.
  const probe = `
    import { registerHooks } from 'node:module';
    const seen = [];
    registerHooks({ resolve(s, c, next) { seen.push(s); return next(s, c); } });
    await import(process.argv[1]);
    console.log(JSON.stringify(seen.filter((s) => s !== process.argv[1])));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', probe, new URL('../src/ngsi.mjs', import.meta.url).href]);
  assert.deepEqual(JSON.parse(stdout), []);
});

test('an attribute named __proto__ stays an own key and never changes the prototype', () => {
  const parse = (o) => JSON.parse(JSON.stringify(o).replace('"proto"', '"__proto__"'));
  const check = (out, value) => {
    assert.equal(Object.getPrototypeOf(out), Object.prototype);
    assert.ok(Object.hasOwn(out, '__proto__'));
    assert.deepEqual(Object.getOwnPropertyDescriptor(out, '__proto__'), { value, enumerable: true, writable: true, configurable: true });
    assert.equal(out.polluted, undefined);
  };
  const norm = parse({ id: 'urn:x', type: 'Thing', proto: { type: 'Property', value: { polluted: true } } });
  check(toKeyValues(norm), { polluted: true });
  check(toKeyValues(parse({ proto: [{ type: 'Relationship', object: 'urn:y', datasetId: 'urn:d:1' }] })), ['urn:y']);
  check(toKeyValues(parse({ proto: { type: 'GeoProperty', value: { type: 'Point', coordinates: [0, 0], polluted: true } } })), { type: 'Point', coordinates: [0, 0], polluted: true });
  check(toKeyValues(parse({ proto: { type: 'JsonProperty', json: { polluted: true } } })), { json: { polluted: true } });
  // The wrappers, with __proto__ named in the schema.
  const schema = parse({ properties: { proto: { 'x-ngsi': { type: 'JsonProperty' } } } });
  check(unwrapKeyValues(parse({ proto: { json: { polluted: true } } }), schema), { polluted: true });
  check(wrapKeyValues(parse({ proto: { polluted: true } }), schema), { json: { polluted: true } });
  check(toNormalized(parse({ proto: { polluted: true } }), { properties: {} }), { type: 'Property', value: { polluted: true } });
  check(toNormalized(parse({ proto: ['a', 'b'] }), parse({ properties: { proto: { 'x-ngsi': { type: 'Property', multi: true } } } })), [
    { type: 'Property', value: 'a', datasetId: 'urn:ngsi-ld:dataset:__proto__:1' },
    { type: 'Property', value: 'b', datasetId: 'urn:ngsi-ld:dataset:__proto__:2' },
  ]);
  // A name of Object.prototype that the schema does not declare is a plain Property.
  assert.deepEqual(toNormalized({ constructor: '2026-01-01' }, { properties: {} }), { constructor: { type: 'Property', value: '2026-01-01' } });
});

test('unclosedRings with a limit stays fast on many rings under a long key', () => {
  const ring = { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] };
  const value = { ['k'.repeat(100_000)]: Array.from({ length: 50_000 }, () => ring) };
  const start = performance.now();
  const paths = unclosedRings(value, { style: 'pointer', limit: 10 });
  assert.equal(paths.length, 10);
  assert.ok(performance.now() - start < 500, 'a limited call must not format every path');
});
