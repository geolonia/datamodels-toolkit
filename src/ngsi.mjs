// NGSI-LD normalized form. Moved from geolonia/datamodels (scripts/lib/ngsi.mjs, #91);
// the date rule follows the catalog's (geolonia/datamodels#183). The key-values
// projection and the json and vocab wrappers came later, for check
// (geolonia/datamodels#226). The rules of a normalized entity (attributeProblems,
// unclosedRings) moved here from src/build/examples.mjs so the datamodels.jp
// MCP server, a Cloudflare Worker, can use them too (#120): this module must
// keep having no imports.

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
/**
 * Set an own property of `obj`. Keys come from data, and `obj[k] = v` with the
 * key "__proto__" would change the object's prototype and drop the attribute.
 */
const setOwn = (obj, k, v) => Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
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
    setOwn(out, k, prop['x-ngsi'].multi && Array.isArray(out[k]) ? out[k].map(unwrap) : unwrap(out[k]));
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
    setOwn(out, k, prop['x-ngsi'].multi && Array.isArray(out[k]) ? out[k].map(wrap) : wrap(out[k]));
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
      setOwn(out, k, instances.map((inst) => {
        const single = toKeyValues({ [k]: inst });
        if (inst.datasetId === undefined) defaults += 1;
        else if (seen.has(inst.datasetId)) throw new Error(`attribute ${k}: duplicate datasetId ${inst.datasetId}`);
        else seen.add(inst.datasetId);
        return single[k];
      }));
      if (defaults > 1) throw new Error(`attribute ${k}: only one instance of a multi-valued attribute may omit datasetId`);
      continue;
    }
    if (!v || typeof v !== 'object' || !Object.hasOwn(v, 'type')) throw new Error(`attribute ${k}: not a normalized attribute object`);
    if (v.type === 'Relationship') { if (typeof v.object !== 'string') throw new Error(`attribute ${k}: Relationship needs a string object`); setOwn(out, k, v.object); }
    else if (v.type === 'GeoProperty') { if (!v.value || typeof v.value !== 'object' || typeof v.value.type !== 'string') throw new Error(`attribute ${k}: GeoProperty needs a GeoJSON value`); setOwn(out, k, v.value); }
    else if (Object.hasOwn(WRAPPED, v.type)) {
      const member = WRAPPED[v.type];
      if (!Object.hasOwn(v, member)) throw new Error(`attribute ${k}: ${v.type} needs a ${member} member`);
      setOwn(out, k, { [member]: v[member] });
    } else if (v.type === 'Property') {
      if (!Object.hasOwn(v, 'value')) throw new Error(`attribute ${k}: Property needs a value`);
      setOwn(out, k, (v.value && typeof v.value === 'object' && Object.hasOwn(v.value, '@type') && Object.hasOwn(v.value, '@value')) ? v.value['@value'] : v.value);
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
 * The NGSI-LD rules of a model that a normalized entity breaks, as data, so
 * each caller words its own message (check, and the validate tool of the
 * datamodels.jp MCP server, geolonia/datamodels-toolkit#120).
 *
 * `attributes` are the model's [name, schema] pairs (the entries of its
 * schema's properties; id, type and @context are skipped). Attributes the
 * entity does not have are skipped too. Returns, attribute by attribute:
 *
 *   - { attribute, rule: 'multi', instances: <how many> } when the attribute
 *     is a list of instances, but the schema has no x-ngsi.multi;
 *   - { attribute, rule: 'type', found: <the instance's type>, expected: <x-ngsi.type>, implicit }
 *     for each instance whose type is not the declared one; `implicit` is true
 *     when the schema has no x-ngsi.type and Property is expected by default;
 *   - { attribute, rule: 'date', found: <the value as given>, expected: { '@type', '@value' } }
 *     for each instance of a date or date-time Property whose value does not
 *     carry its typed form (typedDate).
 *
 * An instance that is not an attribute object breaks none of these rules:
 * toKeyValues reports it. A value that is not a JSON object has no attributes.
 */
export function attributeProblems(entity, attributes) {
  const out = [];
  if (!isObject(entity)) return out;
  for (const [name, prop] of attributes) {
    if (name === 'id' || name === 'type' || name === '@context' || !Object.hasOwn(entity, name)) continue;
    const ngsi = prop?.['x-ngsi'] ?? {};
    const declared = ngsi.type ?? 'Property';
    const instances = [entity[name]].flat();
    if (Array.isArray(entity[name]) && !ngsi.multi) out.push({ attribute: name, rule: 'multi', instances: entity[name].length });
    for (const inst of instances) {
      if (isObject(inst) && Object.hasOwn(inst, 'type') && inst.type !== declared) out.push({ attribute: name, rule: 'type', found: inst.type, expected: declared, implicit: !ngsi.type });
    }
    // A date or date-time value carries its NGSI-LD type, and the type fits the value.
    // An instance of another type has its type problem above; its value is not checked as a date.
    const formats = declared === 'Property' ? dateFormats(prop) : [];
    for (const inst of formats.length ? instances : []) {
      if (isObject(inst) && Object.hasOwn(inst, 'type') && inst.type !== 'Property') continue;
      const v = inst?.value;
      const value = isObject(v) && Object.hasOwn(v, '@value') ? v['@value'] : v;
      const want = typedDate(value, formats);
      if (typeof value === 'string' && v?.['@type'] !== want['@type']) out.push({ attribute: name, rule: 'date', found: v, expected: want });
    }
  }
  return out;
}

const pathStyles = {
  // $.area.coordinates[0], as check writes it.
  jsonpath: (segments) => `$${segments.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`)).join('')}`,
  // /area/coordinates/0 (RFC 6901), as JSON Schema validators write it.
  pointer: (segments) => segments.map((s) => `/${String(s).replaceAll('~', '~0').replaceAll('/', '~1')}`).join(''),
};

/**
 * The polygon rings in a value, at any depth, whose first and last positions
 * differ (RFC 7946, section 3.1.6: a ring closes). JSON Schema cannot compare
 * two elements of an array, so this is checked apart. Returns their paths, in
 * `style` 'jsonpath' ($.area.coordinates[0], the default) or 'pointer'
 * (/area/coordinates/0). An empty ring is left to the schema. The jsonpath
 * style does not escape keys: a key with "." or "[" makes an ambiguous path.
 * `limit` (a whole number, default no limit) stops after that many paths:
 * each path repeats the keys above it, so a caller that reports only the
 * first few errors of untrusted input should pass one.
 */
export function unclosedRings(value, options = {}) {
  // The old signature took a path prefix as its second argument.
  if (!isObject(options)) throw new TypeError(`unclosedRings: the second argument is { style }, got ${kindOf(options)}`);
  const { style = 'jsonpath', limit = Infinity } = options;
  if (!Object.hasOwn(pathStyles, style)) throw new Error(`unknown path style "${style}": use jsonpath or pointer`);
  if (limit !== Infinity && !(Number.isInteger(limit) && limit >= 0)) throw new TypeError(`unclosedRings: limit must be a whole number, got ${limit}`);
  const format = pathStyles[style];
  const out = [];
  const full = () => out.length >= limit;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  const closes = (ring) => !Array.isArray(ring) || ring.length === 0 || same(ring[0], ring.at(-1));
  // Paths are formatted only while there is room, and the walk stops when out is full.
  const add = (segments) => { if (!full()) out.push(format(segments)); };
  const walk = (v, p) => {
    if (full()) return;
    if (Array.isArray(v)) { for (let i = 0; i < v.length && !full(); i++) walk(v[i], [...p, i]); return; }
    if (!isObject(v)) return;
    if (v.type === 'Polygon' && Array.isArray(v.coordinates)) v.coordinates.forEach((ring, i) => { if (!closes(ring)) add([...p, 'coordinates', i]); });
    else if (v.type === 'MultiPolygon' && Array.isArray(v.coordinates)) {
      v.coordinates.forEach((poly, i) => (Array.isArray(poly) ? poly : []).forEach((ring, j) => { if (!closes(ring)) add([...p, 'coordinates', i, j]); }));
    }
    for (const [k, vv] of Object.entries(v)) { if (full()) return; walk(vv, [...p, k]); }
  };
  walk(value, []);
  return out;
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
    const prop = Object.hasOwn(props, k) ? props[k] : {};
    const ngsi = prop['x-ngsi'] ?? {};
    const one = (value) => {
      if (ngsi.type === 'Relationship') return { type: 'Relationship', object: value };
      if (ngsi.type === 'GeoProperty') return { type: 'GeoProperty', value };
      // Key-values carries the wrapper ({"json": ...}); take its content.
      if (Object.hasOwn(WRAPPED, ngsi.type ?? '')) return { type: ngsi.type, [WRAPPED[ngsi.type]]: unwrapOne(k, ngsi.type, value) };
      return { type: 'Property', value: typedDate(value, dateFormats(prop)) };
    };
    if (ngsi.multi && Array.isArray(v)) setOwn(out, k, v.map((item, i) => ({ ...one(item), datasetId: `urn:ngsi-ld:dataset:${k}:${i + 1}` })));
    else setOwn(out, k, one(v));
  }
  return out;
}
