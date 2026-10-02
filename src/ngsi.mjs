// NGSI-LD normalized form. Moved from geolonia/datamodels (scripts/lib/ngsi.mjs, #91).

/**
 * Normalized form of a key-values entity, for a model's JSON Schema: each
 * attribute takes the NGSI-LD type the schema declares (x-ngsi.type),
 * date-time Properties become typed DateTime values, and each instance of a
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
      const format = prop.format ?? prop.items?.format;
      return { type: 'Property', value: format === 'date-time' && typeof value === 'string' ? { '@type': 'DateTime', '@value': value } : value };
    };
    if (ngsi.multi && Array.isArray(v)) out[k] = v.map((item, i) => ({ ...one(item), datasetId: `urn:ngsi-ld:dataset:${k}:${i + 1}` }));
    else out[k] = one(v);
  }
  return out;
}
