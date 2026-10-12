// Table Schema adapter: a Frictionless Table Schema (v2) per entity model, so
// a spreadsheet saved as CSV can be checked against the model with any Table
// Schema tool (frictionless validate, for example). The csv adapter writes the
// matching header row.
//
// One column per attribute, named as the attribute, so a row converts to an
// NGSI-LD entity (key-values) and back without a mapping:
//   - location as longitude and latitude (WGS 84); a model that allows other
//     shapes than a point also gets a location column for a GeoJSON geometry;
//   - a value type made of plain fields (an address) as one column per field,
//     <attribute>.<field>, the same split as the postgis adapter's columns;
//   - a list of plain values as one column, the values separated by ";";
//   - anything else as JSON in one column (type array or object), checked with
//     the attribute's JSON Schema (the jsonSchema constraint).
// Titles and descriptions are in the node's first language; the other
// languages are under x-translations. x-iri gives each column's IRI.
import { adapterUrl, columnsOf, crossRules, linksOf, shortTitle, textIn, inEach, joinTexts, sentences } from '../model.mjs';

export const PROFILE = 'https://datapackage.org/profiles/2.0/tableschema.json';

// Table Schema patterns follow XML Schema: the whole value must match, and there are no ^ or $ anchors.
// A JSON Schema pattern is anchored by hand where it is not; one with a lookaround (?=, (?! has no
// XML Schema form and is kept under x-pattern only.
export function xsdPattern(pattern) {
  if (/\(\?/.test(pattern)) return null;
  let p = pattern;
  p = p.startsWith('^') ? p.slice(1) : `.*${p}`;
  p = p.endsWith('$') && !p.endsWith('\\$') ? p.slice(0, -1) : `${p}.*`;
  return p;
}

// A date, or a date-time as JSON Schema's format takes it (RFC 3339): with seconds and Z or an offset.
export const DATE_OR_DATE_TIME = '\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}))?';

/** The type, format and constraints of a plain value. */
function typed(value) {
  const f = {};
  const constraints = {};
  if (value.formats) { f.type = 'string'; constraints.pattern = DATE_OR_DATE_TIME; }
  else if (value.format === 'date-time') f.type = 'datetime';
  else if (value.format === 'date') f.type = 'date';
  else if (value.format === 'time') f.type = 'time';
  else {
    f.type = value.type;
    if (['uri', 'email', 'uuid'].includes(value.format)) f.format = value.format;
  }
  if (value.enum) constraints.enum = value.enum;
  if (value.const !== undefined) constraints.enum = [value.const];
  if (value.pattern) {
    const p = xsdPattern(value.pattern);
    if (p) constraints.pattern = p; else f['x-pattern'] = value.pattern;
  }
  for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength']) if (value[k] !== undefined) constraints[k] = value[k];
  return { f, constraints };
}

/** A field: name, the texts in the first language, the others under x-translations. */
function field(name, texts, languages, rest) {
  const [first, ...others] = languages;
  const description = textIn(texts, first, languages);
  const title = shortTitle(description);
  const translations = Object.fromEntries(others.map((l) => {
    const d = textIn(texts, l, languages);
    return [l, { ...(shortTitle(d) ? { title: shortTitle(d) } : {}), ...(d ? { description: d } : {}) }];
  }).filter(([, t]) => Object.keys(t).length));
  const { constraints = {}, ...more } = rest;
  return {
    name, ...(title ? { title } : {}), ...(description ? { description } : {}), ...more,
    ...(Object.keys(constraints).length ? { constraints } : {}),
    ...(Object.keys(translations).length ? { 'x-translations': translations } : {}),
  };
}

// A JSON Schema without the catalog's own keywords (x-ngsi, x-iri, descriptions stay).
const plainSchema = (s) => JSON.parse(JSON.stringify(s, (k, v) => (k.startsWith('x-') ? undefined : v)));

/** The Table Schema fields of an entity model, in schema order. */
export function fieldsOf(subject, model, context) {
  const languages = context.languages;
  const columns = columnsOf(model, context);
  const fields = [field('id', inEach(languages, (t) => t.id.replace('{type}', model.type)), languages, { type: 'string', constraints: { required: true, unique: true } })];
  for (const c of columns) {
    if (c.kind === 'geometry') {
      const prefix = c.name === 'location' ? '' : `${c.name}.`;
      const pointOnly = c.geometryTypes.length === 1 && c.geometryTypes[0] === 'Point';
      // Required only when nothing else can carry the location.
      const required = pointOnly && c.required ? { required: true } : {};
      const coordinate = (axis, limit) => field(`${prefix}${axis}`, joinTexts(languages, inEach(languages, (t) => t[axis](c.name)), pointOnly ? {} : inEach(languages, (t) => t.otherShapes(c.name))), languages, { type: 'number', 'x-iri': c.iri, constraints: { ...required, minimum: -limit, maximum: limit } });
      fields.push(coordinate('longitude', 180), coordinate('latitude', 90));
      if (!pointOnly) fields.push(field(c.name, joinTexts(languages, c.texts, inEach(languages, (t) => t.geojson(c.name, c.geometryTypes))), languages, { type: 'geojson', 'x-iri': c.iri }));
    } else if (c.kind === 'parts') {
      for (const p of c.parts) {
        const { f, constraints } = typed(p.value);
        // Required when the entity requires the value and the value requires the field, as in the PostGIS table.
        fields.push(field(`${c.name}.${p.name}`, joinTexts(languages, p.texts, inEach(languages, (t) => t.partOf(c.name))), languages, { ...f, 'x-iri': p.iri, constraints: { ...(c.required && p.required ? { required: true } : {}), ...constraints } }));
      }
    } else if (c.kind === 'scalar') {
      const { f, constraints } = typed(c.value);
      fields.push(field(c.name, c.texts, languages, { ...f, 'x-iri': c.iri, constraints: { ...(c.required ? { required: true } : {}), ...constraints } }));
    } else if (c.kind === 'list') {
      const { f, constraints } = typed(c.item);
      const itemType = ['string', 'integer', 'number', 'boolean', 'date', 'datetime', 'time'].includes(f.type) ? f.type : 'string';
      // Table Schema has no constraint on the items of a list: the allowed values go into the description.
      const values = [...(c.item.enum ?? []), ...(c.item.const !== undefined ? [c.item.const] : [])];
      const notes = inEach(languages, (t, l) => sentences(l, [t.list, values.length ? t.values(values) : '']));
      fields.push(field(c.name, joinTexts(languages, c.texts, notes), languages, { type: 'list', itemType, delimiter: ';', 'x-iri': c.iri, ...(constraints.pattern ? { 'x-itemPattern': c.item.pattern } : {}), constraints: { ...(c.required ? { required: true } : {}), ...(c.minItems ? { minLength: c.minItems } : {}) } }));
    } else {
      const type = c.schema.type === 'array' ? 'array' : 'object';
      fields.push(field(c.name, c.texts, languages, { type, 'x-iri': c.iri, constraints: { ...(c.required ? { required: true } : {}), jsonSchema: plainSchema(c.schema) } }));
    }
  }
  return fields;
}

/** The Table Schema of an entity model. */
export function tableSchemaOf(subject, model, context) {
  const { languages } = context;
  const links = linksOf(subject, model, context);
  const rules = crossRules(model.schema);
  const notes = inEach(languages, (t, l) => sentences(l, [...rules.atLeastOne.map((g) => t.atLeastOne(g)), rules.other ? t.moreRules(links.schemaUrl) : '']));
  const texts = joinTexts(languages, model.catalog?.description, notes);
  const [first, ...others] = languages;
  const translations = Object.fromEntries(others.map((l) => [l, { title: textIn(model.catalog?.title, l, languages), description: texts[l] }]).filter(([, t]) => t.title || t.description));
  return {
    $schema: PROFILE,
    title: textIn(model.catalog?.title, first, languages) || model.type,
    ...(texts[first] ? { description: texts[first] } : {}),
    'x-type': model.type,
    'x-typeIri': links.typeIri,
    'x-version': subject.version,
    'x-schema': links.schemaUrl,
    'x-context': links.contextUrl,
    ...(Object.keys(translations).length ? { 'x-translations': translations } : {}),
    fields: fieldsOf(subject, model, context),
    primaryKey: ['id'],
    missingValues: [''],
  };
}

export default {
  name: 'table-schema',
  label: { ja: 'Table Schema', en: 'Table Schema' },
  note: {
    ja: 'CSV の列と規則を表す Frictionless Table Schema（v2）。表計算ソフトで作った CSV を、frictionless などで検査できます。列名は属性名と同じです。',
    en: 'A Frictionless Table Schema (v2) for the columns of a CSV file and their rules, so a CSV made in a spreadsheet can be checked with frictionless or another Table Schema tool. Column names are the attribute names.',
  },
  urlFor: adapterUrl('table-schema', 'tableschema.json'),
  content: (subject, model, context) => `${JSON.stringify(tableSchemaOf(subject, model, context), null, 2)}\n`,
};
