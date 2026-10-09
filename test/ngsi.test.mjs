// The normalized form (src/ngsi.mjs): typed dates follow the catalog's rule
// (geolonia/datamodels#183).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateFormats, typedDate, toNormalized } from '../src/ngsi.mjs';

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
