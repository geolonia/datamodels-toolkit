// AI adapter: a strict JSON Schema per entity model for the structured output
// of a large language model, to extract entities from text (a PDF, a web page,
// an e-mail). The file is { name, description, strict, schema }: the
// json_schema of OpenAI's Structured Outputs as it is, and `schema` is the
// input_schema of a tool or the output format of Anthropic's Claude API.
//
// Only what both accept (checked on 2026-10-11):
//   https://developers.openai.com/api/docs/guides/structured-outputs (Supported schemas)
//   https://platform.claude.com/docs/en/build-with-claude/structured-outputs (JSON Schema limitations)
//   - every object has additionalProperties: false and lists every property in
//     required; an optional attribute may be null instead (type [T, "null"]);
//   - no $ref: value types (an address, a geometry) are written out;
//   - no oneOf, allOf, not, if/then: oneOf becomes anyOf, the rest is a note;
//   - string formats: date-time, date, time, duration, email, hostname, ipv4,
//     ipv6, uuid (not uri); patterns without lookarounds;
//   - no minimum, maximum, minLength, maxLength, maxItems, uniqueItems; minItems
//     only 0 or 1 (Anthropic): these become a note in the description.
// A model with an attribute that has no strict form (a map with any keys) has
// no file. id and type are not in the schema: the application sets them.
// Descriptions are in English (the JSON Schema's own, which name the Japanese
// term where it helps).
import { adapterUrl, columnsOf, crossRules, linksOf, textIn, sentences, GEOMETRY_TYPES } from '../model.mjs';

const FORMATS = ['date-time', 'date', 'time', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid'];

/** Why a model has no strict schema. */
export class NotStrict extends Error {}

const describe = (text, notes) => {
  const t = [text, notes.length ? `(${notes.join('; ')})` : ''].filter(Boolean).join(' ');
  return t ? { description: t } : {};
};

/** The JSON type of the values of an enum or const. */
const typeOfValues = (values) => {
  const types = [...new Set(values.map((v) => (v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v)))];
  return types.length === 1 ? types[0] : types;
};

/** Add null to a schema: to its type, its enum and its anyOf. Counted as a union by Anthropic. */
function nullable(s) {
  if (s.anyOf) return { ...s, anyOf: [...s.anyOf, { type: 'null' }] };
  const out = { ...s, type: [...new Set([...[].concat(s.type), 'null'])] };
  if (out.enum) out.enum = [...out.enum, null];
  return out;
}

/** The strict form of a JSON Schema fragment; `path` names it in an error. */
export function strict(s, path) {
  if (!s || typeof s !== 'object') throw new NotStrict(`${path}: no schema`);
  if (s.$ref || s.allOf || s.not || s.if || s.patternProperties || s.dependentSchemas) throw new NotStrict(`${path}: ${Object.keys(s).find((k) => ['$ref', 'allOf', 'not', 'if', 'patternProperties', 'dependentSchemas'].includes(k))} has no strict form`);
  const notes = [];
  const text = s.description;
  const branches = s.oneOf ?? s.anyOf;
  if (branches && s.oneOf && s.anyOf) throw new NotStrict(`${path}: oneOf and anyOf together have no strict form`);
  if (branches) {
    // The keywords next to anyOf/oneOf apply to every branch (JSON Schema reads them together), so
    // each branch gets them: a date or a date-time of the same type, or a pattern and bounds that
    // hold whichever branch is taken. A branch that gives the same keyword another value would need
    // both to hold, which one strict schema cannot say: then the model has no AI file.
    const { anyOf, oneOf, description, ...siblings } = s;
    const merged = branches.map((b, i) => {
      const clash = Object.keys(b ?? {}).find((k) => k !== 'description' && k in siblings && JSON.stringify(b[k]) !== JSON.stringify(siblings[k]));
      if (clash) throw new NotStrict(`${path}[${i}]: ${clash} next to ${s.oneOf ? 'oneOf' : 'anyOf'} and in the branch must both hold, which has no strict form`);
      return strict({ ...siblings, ...b }, `${path}[${i}]`);
    });
    return { anyOf: merged, ...describe(text, notes) };
  }
  if (s.const !== undefined) return { type: typeOfValues([s.const]), enum: [s.const], ...describe(text, notes) };
  const type = s.type ?? (s.enum ? typeOfValues(s.enum) : s.properties ? 'object' : s.items ? 'array' : undefined);
  if (type === undefined) throw new NotStrict(`${path}: no type`);
  const out = { type };
  if (s.enum) out.enum = s.enum;
  const types = [].concat(type);
  if (types.includes('string')) {
    if (s.format && FORMATS.includes(s.format)) out.format = s.format;
    else if (s.format === 'uri') notes.push('a URI');
    else if (s.format) notes.push(`format ${s.format}`);
    if (s.pattern && !/\(\?/.test(s.pattern)) out.pattern = s.pattern;
    else if (s.pattern) notes.push(`must match the pattern ${s.pattern}`);
    if (s.minLength !== undefined) notes.push(s.minLength === 1 ? 'not empty' : `at least ${s.minLength} characters`);
    if (s.maxLength !== undefined) notes.push(`at most ${s.maxLength} characters`);
  }
  if (types.includes('number') || types.includes('integer')) {
    for (const [k, w] of [['minimum', 'minimum'], ['maximum', 'maximum'], ['exclusiveMinimum', 'more than'], ['exclusiveMaximum', 'less than']]) if (s[k] !== undefined) notes.push(`${w} ${s[k]}`);
  }
  if (types.includes('array')) {
    out.items = strict(s.items ?? {}, `${path}[]`);
    if (s.minItems === 1) out.minItems = 1;
    else if (s.minItems > 1) notes.push(`at least ${s.minItems} items`);
    if (s.maxItems !== undefined) notes.push(`at most ${s.maxItems} items`);
    if (s.uniqueItems) notes.push('no duplicates');
  }
  if (types.includes('object')) {
    if (s.additionalProperties !== undefined && s.additionalProperties !== false) throw new NotStrict(`${path}: an object with any keys has no strict form`);
    if (!s.properties || !Object.keys(s.properties).length) throw new NotStrict(`${path}: an object without properties has no strict form`);
    const required = new Set(s.required ?? []);
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, p]) => {
      const v = strict(p, `${path}.${k}`);
      return [k, required.has(k) ? v : nullable(v)];
    }));
    out.required = Object.keys(s.properties);
    out.additionalProperties = false;
  }
  return { ...out, ...describe(text, notes) };
}

const POSITION = { type: 'array', items: { type: 'number' }, description: '[longitude, latitude] in WGS 84, optionally with the altitude as a third number' };
const many = (items, description) => ({ type: 'array', items, description });

/** One GeoJSON geometry type, strict. */
function geometry(type) {
  const coordinates = {
    Point: POSITION,
    LineString: many(POSITION, 'At least 2 positions'),
    Polygon: many(many(POSITION, 'A closed ring: at least 4 positions, the last equal to the first'), 'The outer ring, then any holes'),
    MultiPoint: many(POSITION, 'Positions'),
    MultiLineString: many(many(POSITION, 'At least 2 positions'), 'Lines'),
    MultiPolygon: many(many(many(POSITION, 'A closed ring: at least 4 positions, the last equal to the first'), 'The outer ring, then any holes'), 'Polygons'),
  };
  if (type === 'GeometryCollection') {
    return { type: 'object', properties: { type: { type: 'string', enum: [type] }, geometries: many({ anyOf: GEOMETRY_TYPES.filter((t) => t !== type).map(geometry) }, 'The geometries') }, required: ['type', 'geometries'], additionalProperties: false };
  }
  return { type: 'object', properties: { type: { type: 'string', enum: [type] }, coordinates: coordinates[type] }, required: ['type', 'coordinates'], additionalProperties: false };
}

/** The English description of an attribute: the JSON Schema's own, else the catalog's. */
const englishOf = (c, languages) => c.prop.description ?? textIn(c.texts, 'en', languages);

/** The strict schema of an entity model's attributes; throws NotStrict when one has no strict form. */
export function structuredOutputOf(subject, model, context) {
  const { languages } = context;
  const links = linksOf(subject, model, context);
  const properties = {};
  for (const c of columnsOf(model, context)) {
    let s;
    if (c.kind === 'geometry') {
      const shapes = c.geometryTypes.map(geometry);
      const text = `${englishOf(c, languages) ?? ''} A GeoJSON geometry (${c.geometryTypes.join(', ')}).`.trim();
      s = shapes.length === 1 ? { ...shapes[0], description: text } : { anyOf: shapes, description: text };
    } else if (c.kind === 'parts') {
      const target = { type: 'object', properties: Object.fromEntries(c.parts.map((p) => [p.name, p.prop])), required: c.parts.filter((p) => p.required).map((p) => p.name), additionalProperties: false, description: englishOf(c, languages) };
      s = strict(target, c.name);
    } else if (c.kind === 'json' && c.schema !== c.prop) {
      // A value type that is not a set of plain fields: its own schema, with the attribute's description.
      s = { ...strict(c.schema, c.name), ...(englishOf(c, languages) ? { description: englishOf(c, languages) } : {}) };
    } else {
      const { 'x-ngsi': ngsi, 'x-iri': iri, ...plain } = c.prop;
      s = strict({ ...plain, description: englishOf(c, languages) }, c.name);
    }
    properties[c.name] = c.required ? s : nullable(s);
  }
  const rules = crossRules(model.schema);
  const notes = [...rules.atLeastOne.map((g) => `At least one of ${g.join(', ')} is not null`), ...(rules.other ? [`More rules: ${links.schemaUrl}`] : [])];
  const description = sentences('en', [model.schema.description ?? textIn(model.catalog?.description, 'en', languages), ...notes, `Type ${links.typeIri}; @context ${links.contextUrl}`]);
  return {
    name: model.type,
    description,
    strict: true,
    schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  };
}

/** How many properties use a union (anyOf or a type with null): Anthropic allows 16 per request in strict mode. */
export function unionCount(schema) {
  let n = 0;
  const visit = (s) => {
    if (!s || typeof s !== 'object') return;
    if (s.anyOf || (Array.isArray(s.type) && s.type.length > 1)) n++;
    for (const v of [...Object.values(s.properties ?? {}), ...(s.anyOf ?? []), ...(s.items ? [s.items] : [])]) visit(v);
  };
  visit(schema);
  return n;
}

const supported = (subject, model, context) => {
  try { structuredOutputOf(subject, model, context); return true; } catch (e) { if (e instanceof NotStrict) return false; throw e; }
};

export default {
  name: 'ai',
  label: { ja: 'AI の構造化出力', en: 'Structured output for AI' },
  note: {
    ja: 'LLM の構造化出力（strict な JSON Schema）。文書からエンティティを取り出すときに、モデルの形のまま答えさせます。OpenAI の json_schema と、Claude の tool の input_schema に使えます。',
    en: 'A strict JSON Schema for the structured output of a large language model, to extract entities from documents in the shape of the model: the json_schema of OpenAI\'s Structured Outputs, or the input_schema of a Claude tool.',
  },
  urlFor: (subject, model, context) => (adapterUrl('ai', 'ai.json')(subject, model, context) && supported(subject, model, context) ? adapterUrl('ai', 'ai.json')(subject, model, context) : null),
  content: (subject, model, context) => `${JSON.stringify(structuredOutputOf(subject, model, context), null, 2)}\n`,
};
