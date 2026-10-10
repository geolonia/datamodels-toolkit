// NGSI-LD normalized form. Moved from geolonia/datamodels (scripts/lib/ngsi.mjs, #91);
// the date rule follows the catalog's (geolonia/datamodels#183).

/**
 * The date formats a Property's value may take, from its schema: "date",
 * "date-time" or both. A schema that accepts either writes them as
 * `"anyOf": [{ "format": "date" }, { "format": "date-time" }]`; an array
 * attribute takes the formats of its items.
 */
export function dateFormats(prop) {
  const formatsOf = (p) => (!p || typeof p !== 'object' ? [] : [p.format, ...(p.anyOf ?? []).map((a) => a?.format)]);
  const all = [...formatsOf(prop), ...formatsOf(prop?.items)];
  return ['date', 'date-time'].filter((f) => all.includes(f));
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The NGSI-LD value of a date or date-time Property: { "@type": "Date" } or
 * { "@type": "DateTime" } with the string as @value (NGSI-LD defines both).
 * When the schema accepts either, the value decides: YYYY-MM-DD is a Date,
 * anything else a DateTime. Other values are returned unchanged.
 */
export function typedDate(value, formats) {
  if (typeof value !== 'string' || !formats.length) return value;
  const isDate = formats.includes('date') && (!formats.includes('date-time') || PLAIN_DATE.test(value));
  return { '@type': isDate ? 'Date' : 'DateTime', '@value': value };
}

/**
 * Normalized form of a key-values entity, for a model's JSON Schema: each
 * attribute takes the NGSI-LD type the schema declares (x-ngsi.type),
 * date and date-time Properties become typed Date and DateTime values
 * (typedDate), and each instance of a
 * multi-valued attribute gets a datasetId (urn:ngsi-ld:dataset:<attribute>:<n>,
 * the form the catalog's examples use). An attribute the schema does not
 * declare becomes a Property.
 */
export function toNormalized(keyValues, schema, context) {
  const out = context ? { '@context': context } : {};
  const props = schema.properties ?? {};
  for (const [k, v] of Object.entries(keyValues)) {
    if (k === '@context') continue;
    if (k === 'id' || k === 'type') { out[k] = v; continue; }
    const prop = props[k] ?? {};
    const ngsi = prop['x-ngsi'] ?? {};
    const one = (value) => {
      if (ngsi.type === 'Relationship') return { type: 'Relationship', object: value };
      if (ngsi.type === 'GeoProperty') return { type: 'GeoProperty', value };
      return { type: 'Property', value: typedDate(value, dateFormats(prop)) };
    };
    if (ngsi.multi && Array.isArray(v)) out[k] = v.map((item, i) => ({ ...one(item), datasetId: `urn:ngsi-ld:dataset:${k}:${i + 1}` }));
    else out[k] = one(v);
  }
  return out;
}
