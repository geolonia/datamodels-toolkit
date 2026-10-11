// What the adapters read from a model: its attributes as columns of a table,
// with their texts, IRIs and rules. Pure functions, no network: the caller
// (build or export, src/adapters/load.mjs) reads the schemas a model refers to
// and passes them in `context.refs`.
//
// An adapter is the interface of geolonia/datamodels (adapters/README.md):
//   { name, label: { ja, en }, note: { ja, en }, guide?, urlFor(subject, model, context), content(subject, model, context) }
// `subject` and `model` are as loadSubjects() returns them. `context` is
// { urls, languages, refs }: the node's URL builders (catalogUrls), its
// languages in order, and { [schema URL]: { schema, texts } } for every
// schema a model refers to with $ref (texts: { part: { lang: text } }).
// A model read from another node's catalog.json carries `links` with its own
// URLs, which win over those `urls` would build.
import { attributesOf } from '../build/urls.mjs';

/** The URLs of a model: from `model.links` (a model of another node) or the node's URL builders. */
export function linksOf(subject, model, { urls }) {
  if (model.links) return model.links;
  const mu = urls.modelUrls(subject, model);
  return { typeIri: mu.typeIri, schemaUrl: mu.schemaExact, contextUrl: urls.subjectUrls(subject).contextAlias, pageUrl: mu.page };
}

/** The file of an adapter for an entity model: /adapters/<name>/<subject>/<Type>.<ext>, as on datamodels.jp. */
export const adapterUrl = (name, ext) => (subject, model, { urls }) => (model.kind === 'entity' ? `${urls.baseUrl}/adapters/${name}/${subject.name}/${model.type}.${ext}` : null);

/** snake_case of a camelCase name: hazardTypes → hazard_types, EvacuationSite → evacuation_site. */
export const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();

/** A text in `lang`, else in the first language that has one, else in any. */
export function textIn(texts, lang, languages = []) {
  const l = [lang, ...languages, ...Object.keys(texts ?? {})].find((x) => typeof texts?.[x] === 'string' && texts[x].trim());
  return l ? texts[l].trim() : '';
}

/**
 * A short label from a description: the text before the first bracket or the
 * end of the first sentence, if that is short. The catalog has descriptions,
 * not labels; '' when no short label can be cut.
 */
export function shortTitle(text) {
  const head = String(text ?? '').split(/[（(。：；]|[.:;](?:\s|$)/)[0].trim();
  return head && head.length <= 40 ? head : '';
}

const SCALAR_TYPES = ['string', 'integer', 'number', 'boolean'];
// The keywords of a value that carry a rule; the adapters turn each into their own form or a note.
const RULES = ['enum', 'const', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength'];

/**
 * A plain value (string, integer, number, boolean) with its rules, or null.
 * `formats`: the date formats it may take; ['date', 'date-time'] when the
 * schema accepts either (its anyOf of formats).
 */
export function scalarOf(prop) {
  if (!prop || typeof prop !== 'object' || prop.$ref || prop.allOf || prop.oneOf || prop.properties || prop.items) return null;
  let type = prop.type;
  if (type === undefined && Array.isArray(prop.enum) && prop.enum.length && prop.enum.every((v) => typeof v === 'string')) type = 'string';
  if (type === undefined && typeof prop.const === 'string') type = 'string';
  if (!SCALAR_TYPES.includes(type)) return null;
  const anyFormats = (prop.anyOf ?? []).map((a) => a?.format);
  if (prop.anyOf && (anyFormats.some((f) => !f) || Object.keys(prop.anyOf.reduce((o, a) => ({ ...o, ...a }), {})).some((k) => k !== 'format'))) return null;
  const formats = [prop.format, ...anyFormats].filter(Boolean);
  const out = { type, ...(formats.length === 1 ? { format: formats[0] } : {}), ...(formats.length > 1 ? { formats } : {}) };
  for (const k of RULES) if (prop[k] !== undefined) out[k] = prop[k];
  return out;
}

/** The part of `schema` a JSON Pointer fragment (#/$defs/Address) names, or undefined. */
function pointer(schema, ref) {
  let at = schema;
  for (const raw of ref.slice(1).split('/').slice(1)) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!at || typeof at !== 'object' || !(key in at)) return undefined;
    at = at[key];
  }
  return at && typeof at === 'object' ? at : undefined;
}

/** The $ref of an attribute: { "$ref": url } or { "allOf": [{ "$ref": url }] }. */
const refOf = (prop) => prop.$ref ?? (Array.isArray(prop.allOf) && prop.allOf.length === 1 ? prop.allOf[0]?.$ref : undefined);

export const GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection'];

/**
 * The attributes of an entity model as the adapters see them, in schema order:
 *   { name, iri, required, texts, prop, kind, ... } where kind is
 *   - 'scalar': a plain value (`value` from scalarOf);
 *   - 'list': an array of plain values (`item` from scalarOf, `minItems`, `uniqueItems`);
 *   - 'geometry': a GeoProperty (`geometryTypes`: the GeoJSON types it allows);
 *   - 'parts': a value type whose fields are all plain values, such as an
 *     address (`parts`: [{ name, iri, required, texts, prop, value }], `valueIri`);
 *   - 'json': anything else, kept as one JSON value (`schema`: the attribute's schema).
 * Throws when a referenced schema is not in `context.refs`.
 */
export function columnsOf(model, { refs = {} } = {}) {
  const required = new Set(model.schema.required ?? []);
  return attributesOf(model).map(([name, prop]) => {
    const base = { name, iri: prop['x-iri'] ?? '', required: required.has(name), texts: model.catalog?.attributes?.[name] ?? (prop.description ? { en: prop.description } : {}), prop };
    if (prop['x-ngsi']?.type === 'GeoProperty') {
      const narrowed = prop.properties?.type;
      const geometryTypes = narrowed?.const ? [narrowed.const] : Array.isArray(narrowed?.enum) ? narrowed.enum : GEOMETRY_TYPES;
      return { ...base, kind: 'geometry', geometryTypes: geometryTypes.filter((t) => GEOMETRY_TYPES.includes(t)) };
    }
    const ref = refOf(prop);
    if (ref) {
      // A schema on a site (read by the caller), or a part of this model's own schema (#/$defs/...).
      // Any other reference (a relative file) is kept as one JSON value.
      const own = ref.startsWith('#') ? pointer(model.schema, ref) : undefined;
      if (!/^https?:\/\//.test(ref) && own === undefined) return { ...base, kind: 'json', schema: prop };
      const target = own !== undefined ? { schema: own, texts: {} } : refs[ref];
      if (!target) throw new Error(`${model.type}.${name}: the schema it refers to (${ref}) was not read`);
      const fields = Object.entries(target.schema.properties ?? {});
      const partRequired = new Set(target.schema.required ?? []);
      const parts = fields.map(([part, p]) => ({ name: part, iri: p['x-iri'] ?? '', required: partRequired.has(part), texts: target.texts?.[part] ?? (p.description ? { en: p.description } : {}), prop: p, value: scalarOf(p) }));
      if (target.schema.type === 'object' && parts.length && parts.every((p) => p.value)) return { ...base, kind: 'parts', parts, valueIri: prop['x-ngsi']?.model ?? '' };
      return { ...base, kind: 'json', schema: target.schema };
    }
    const value = scalarOf(prop);
    if (value) return { ...base, kind: 'scalar', value };
    if (prop.type === 'array' && scalarOf(prop.items)) return { ...base, kind: 'list', item: scalarOf(prop.items), minItems: prop.minItems ?? 0, uniqueItems: !!prop.uniqueItems };
    return { ...base, kind: 'json', schema: prop };
  });
}

/**
 * The model's rules on attributes together, as lists of names of which at
 * least one is needed (an anyOf of required, at the top or in allOf), and
 * whether the schema has other rules that span attributes (if/then, not).
 */
export function crossRules(schema) {
  const atLeastOne = [];
  let other = false;
  const groupOf = (anyOf) => (Array.isArray(anyOf) && anyOf.every((a) => a && Object.keys(a).length === 1 && Array.isArray(a.required) && a.required.length === 1) ? anyOf.map((a) => a.required[0]) : null);
  const visit = (s) => {
    if (s.anyOf) { const g = groupOf(s.anyOf); if (g) atLeastOne.push(g); else other = true; }
    if (s.oneOf || s.not || s.if || s.dependentRequired || s.dependentSchemas) other = true;
    for (const sub of s.allOf ?? []) visit(sub);
  };
  visit({ anyOf: schema.anyOf, allOf: schema.allOf, oneOf: schema.oneOf, not: schema.not, if: schema.if, dependentRequired: schema.dependentRequired, dependentSchemas: schema.dependentSchemas });
  return { atLeastOne, other };
}

/** Every $ref URL a model's attributes use, for the caller to read. */
export function refsOf(model) {
  return [...new Set(attributesOf(model).map(([, p]) => (p['x-ngsi']?.type === 'GeoProperty' ? undefined : refOf(p))).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)))];
}

/** The fixed texts the adapters write, per language; English for a language without its own. */
const TEXTS = {
  en: {
    id: 'Entity id: a URI, for example urn:ngsi-ld:{type}:001',
    longitude: (attr) => `Longitude of ${attr} in WGS 84 (decimal degrees)`,
    latitude: (attr) => `Latitude of ${attr} in WGS 84 (decimal degrees)`,
    otherShapes: (attr) => `For a point, fill longitude and latitude. For any other shape, put the GeoJSON geometry in ${attr} and leave them empty`,
    geojson: (attr, types) => `${attr} as a GeoJSON geometry (${types.join(', ')}), for a shape that is not a point`,
    values: (list) => `Allowed values: ${list.join('; ')}`,
    list: 'Several values separated by ;',
    atLeastOne: (names) => `At least one of ${names.join(', ')} is needed`,
    moreRules: (url) => `More rules that span attributes are in the JSON Schema: ${url}`,
    partOf: (attr) => `Part of ${attr}`,
  },
  ja: {
    id: 'エンティティの ID（URI。例：urn:ngsi-ld:{type}:001）',
    longitude: (attr) => `${attr} の経度（WGS 84、十進の度）`,
    latitude: (attr) => `${attr} の緯度（WGS 84、十進の度）`,
    otherShapes: (attr) => `点なら経度と緯度を入れます。点以外の形は、GeoJSON のジオメトリを ${attr} に入れ、経度と緯度は空にします`,
    geojson: (attr, types) => `${attr} の GeoJSON ジオメトリ（${types.join('、')}）。点以外の形のときに使います`,
    values: (list) => `使える値：${list.join('; ')}`,
    list: '複数の値は ; で区切ります',
    atLeastOne: (names) => `${names.join('、')} のどれか 1 つは必須です`,
    moreRules: (url) => `属性をまたぐ他の規則は JSON Schema にあります：${url}`,
    partOf: (attr) => `${attr} の一部`,
  },
};
export const fixedTexts = (lang) => ({ ...TEXTS.en, ...(TEXTS[lang] ?? {}) });

/** The same fixed text in each of `languages`: { lang: text }. */
export const inEach = (languages, pick) => Object.fromEntries(languages.map((l) => [l, pick(fixedTexts(l), l)]));

/** Sentences joined: with 。 in Japanese, with ". " otherwise; several end with a full stop. */
export function sentences(lang, parts) {
  const ja = lang === 'ja';
  const list = parts.filter(Boolean).map((s) => s.trim());
  const end = (s) => (ja ? (/[。．!?！？]$/.test(s) ? s : `${s}。`) : (/[.!?]$/.test(s) ? s : `${s}.`));
  if (list.length < 2) return list[0] ?? '';
  return list.map(end).join(ja ? '' : ' ');
}

/** Text maps joined per language, as sentences: { lang: text }, each language of `languages` that has any. */
export function joinTexts(languages, ...maps) {
  return Object.fromEntries(languages.map((l) => [l, sentences(l, maps.map((m) => textIn(m, l, languages)))]).filter(([, t]) => t));
}
