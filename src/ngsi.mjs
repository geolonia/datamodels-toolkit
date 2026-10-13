// NGSI-LD normalized form. Moved from geolonia/datamodels (scripts/lib/ngsi.mjs, #91);
// the date rule follows the catalog's (geolonia/datamodels#183). The key-values
// projection and the json and vocab wrappers came later, for check
// (geolonia/datamodels#226).

/** NGSI-LD attribute types a model may declare in x-ngsi.type. JsonProperty and VocabProperty are NGSI-LD 1.8. */
export const NGSI_TYPES = ['Property', 'Relationship', 'GeoProperty', 'JsonProperty', 'VocabProperty'];

/**
 * The member that holds the value of a JsonProperty (json) or a VocabProperty
 * (vocab). NGSI-LD keeps it in the key-values (simplified) form too:
 * `"answers": {"json": [...]}`, so a broker knows the type (ETSI GS CIM 009
 * clause 4.5.4, Simplified Representation).
 */
export const WRAPPED = { JsonProperty: 'json', VocabProperty: 'vocab' };

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** What a JSON value is, for a message: null, an array, a number, ... */
const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : `a ${typeof v}`);

/** The content of a {"json": ...} / {"vocab": ...} wrapper; throws when it is not exactly that. */
function unwrapOne(k, type, v) {
  const member = WRAPPED[type];
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 1 || !Object.hasOwn(v, member)) {
    throw new Error(`attribute ${k}: a ${type} is {"${member}": ...} in key-values form`);
  }
  return v[member];
}

/**
 * The key-values entity with the json and vocab wrappers removed, as the
 * model's JSON Schema describes it (the schema describes the value, as for a
 * Property). Throws when an attribute of one of these types is not wrapped.
 */
export function unwrapKeyValues(keyValues, schema) {
  if (!isObject(keyValues)) throw new Error(`must be a JSON object, got ${kindOf(keyValues)}`);
  const out = { ...keyValues };
  for (const [k, prop] of Object.entries(schema.properties ?? {})) {
    const type = prop?.['x-ngsi']?.type;
    const member = Object.hasOwn(WRAPPED, type ?? '') ? WRAPPED[type] : undefined;
    if (!member || !Object.hasOwn(out, k)) continue;
    const unwrap = (v) => unwrapOne(k, type, v);
    out[k] = prop['x-ngsi'].multi && Array.isArray(out[k]) ? out[k].map(unwrap) : unwrap(out[k]);
  }
  return out;
}

/**
 * The other way: an entity as the model's JSON Schema describes it, with the
 * json and vocab wrappers that its key-values form needs (convert's output).
 */
export function wrapKeyValues(entity, schema) {
  if (!isObject(entity)) throw new Error(`must be a JSON object, got ${kindOf(entity)}`);
  const out = { ...entity };
  for (const [k, prop] of Object.entries(schema.properties ?? {})) {
    const type = prop?.['x-ngsi']?.type;
    const member = Object.hasOwn(WRAPPED, type ?? '') ? WRAPPED[type] : undefined;
    if (!member || !Object.hasOwn(out, k)) continue;
    const wrap = (v) => ({ [member]: v });
    out[k] = prop['x-ngsi'].multi && Array.isArray(out[k]) ? out[k].map(wrap) : wrap(out[k]);
  }
  return out;
}

/**
 * Key-values projection of an NGSI-LD normalized entity.
 *
 * `multi` names the attributes the schema declares `x-ngsi.multi`: their
 * key-values form is always an array, one element per instance, even when the
 * normalized entity carries a single instance. Instances are distinguished by
 * datasetId; at most one (the default instance) may omit it.
 */
export function toKeyValues(normalized, { multi = new Set() } = {}) {
  if (!isObject(normalized)) throw new Error(`must be a JSON object, got ${kindOf(normalized)}`);
  const out = {};
  for (const [k, v] of Object.entries(normalized)) {
    if (k === '@context') continue;
    if (k === 'id' || k === 'type') { out[k] = v; continue; }
    if (Array.isArray(v) || multi.has(k)) {
      const instances = Array.isArray(v) ? v : [v];
      if (instances.length === 0) throw new Error(`attribute ${k}: empty multi-valued attribute`);
      const seen = new Set();
      let defaults = 0;
      out[k] = instances.map((inst) => {
        const single = toKeyValues({ [k]: inst });
        if (inst.datasetId === undefined) defaults += 1;
        else if (seen.has(inst.datasetId)) throw new Error(`attribute ${k}: duplicate datasetId ${inst.datasetId}`);
        else seen.add(inst.datasetId);
        return single[k];
      });
      if (defaults > 1) throw new Error(`attribute ${k}: only one instance of a multi-valued attribute may omit datasetId`);
      continue;
    }
    if (!v || typeof v !== 'object' || !Object.hasOwn(v, 'type')) throw new Error(`attribute ${k}: not a normalized attribute object`);
    if (v.type === 'Relationship') { if (typeof v.object !== 'string') throw new Error(`attribute ${k}: Relationship needs a string object`); out[k] = v.object; }
    else if (v.type === 'GeoProperty') { if (!v.value || typeof v.value !== 'object' || typeof v.value.type !== 'string') throw new Error(`attribute ${k}: GeoProperty needs a GeoJSON value`); out[k] = v.value; }
    else if (Object.hasOwn(WRAPPED, v.type)) {
      const member = WRAPPED[v.type];
      if (!Object.hasOwn(v, member)) throw new Error(`attribute ${k}: ${v.type} needs a ${member} member`);
      out[k] = { [member]: v[member] };
    } else if (v.type === 'Property') {
      if (!Object.hasOwn(v, 'value')) throw new Error(`attribute ${k}: Property needs a value`);
      out[k] = (v.value && typeof v.value === 'object' && Object.hasOwn(v.value, '@type') && Object.hasOwn(v.value, '@value')) ? v.value['@value'] : v.value;
    } else throw new Error(`attribute ${k}: unknown attribute type "${v.type}"`);
  }
  return out;
}

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
 * (typedDate), a JsonProperty or VocabProperty takes the content of its
 * {"json": ...} or {"vocab": ...} wrapper, and each instance of a
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
      // Key-values carries the wrapper ({"json": ...}); take its content.
      if (Object.hasOwn(WRAPPED, ngsi.type ?? '')) return { type: ngsi.type, [WRAPPED[ngsi.type]]: unwrapOne(k, ngsi.type, value) };
      return { type: 'Property', value: typedDate(value, dateFormats(prop)) };
    };
    if (ngsi.multi && Array.isArray(v)) out[k] = v.map((item, i) => ({ ...one(item), datasetId: `urn:ngsi-ld:dataset:${k}:${i + 1}` }));
    else out[k] = one(v);
  }
  return out;
}
