// PostGIS adapter: a CREATE TABLE statement per entity model for PostgreSQL
// with PostGIS. One row per entity, one column per attribute:
//   - names in snake_case (hazardTypes → hazard_types); id is the primary key;
//   - NOT NULL for required attributes; CHECK for allowed values, patterns,
//     limits and "at least one of" rules;
//   - lists as arrays (text[], ...), with a check of their values and, for
//     uniqueItems, of duplicates (a function the file creates, UNIQUE_ITEMS);
//   - location as geometry(<type>, 4326) with a GiST index;
//   - a value type made of plain fields (an address) as one column per field,
//     <attribute>_<field>, the same split as the table-schema adapter's columns,
//     so each field keeps its check and can be indexed;
//   - anything else as jsonb.
// COMMENT ON gives the table and every column its description (each language
// of the node) and its IRI, so the table says what each column means.
import { adapterUrl, columnsOf, crossRules, linksOf, snake, textIn, inEach, joinTexts, sentences } from '../model.mjs';

// PostgreSQL's reserved key words, and those that cannot be a column name: such a name is quoted.
const RESERVED = new Set(`all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation column concurrently constraint create cross current_catalog current_date current_role current_schema current_time current_timestamp current_user default deferrable desc distinct do else end except false fetch for foreign freeze from full grant group having ilike in initially inner intersect into is isnull join lateral leading left like limit localtime localtimestamp natural not notnull null offset on only or order outer overlaps placing primary references returning right select session_user similar some symmetric system_user table tablesample then to trailing true union unique user using variadic verbose when where window with`.split(' '));

/** An identifier, quoted when it is a reserved word or not plain lower case. */
export const ident = (name) => (/^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED.has(name) ? name : `"${name.replace(/"/g, '""')}"`);
/**
 * A string literal that means the same whatever standard_conforming_strings is: single quotes
 * doubled, and a text with a backslash (a pattern such as \\d) as an E'' literal with the
 * backslashes doubled, since a plain literal reads backslashes as escapes when that setting is off.
 */
export const literal = (v) => {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v).replace(/'/g, "''");
  return s.includes('\\') ? `E'${s.replace(/\\/g, '\\\\')}'` : `'${s}'`;
};

// A date, or a date-time as JSON Schema's format takes it (RFC 3339): with seconds and Z or an offset.
export const DATE_OR_DATE_TIME = '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}))?$';

function sqlType(value) {
  if (value.formats) return 'text';
  if (value.format === 'date-time') return 'timestamptz';
  if (value.format === 'date') return 'date';
  if (value.format === 'time') return 'time';
  return { string: 'text', integer: 'bigint', number: 'double precision', boolean: 'boolean' }[value.type];
}

// Schema values written into the SQL as they are, not as quoted literals: only finite numbers
// (and non-negative integers for counts), so a schema can never add SQL of its own.
const num = (v, what) => { if (typeof v === 'number' && Number.isFinite(v)) return String(v); throw new Error(`${what} must be a number, not ${JSON.stringify(v)}`); };
const count = (v, what) => { if (Number.isInteger(v) && v >= 0) return String(v); throw new Error(`${what} must be a whole number of 0 or more, not ${JSON.stringify(v)}`); };
/** A value in a -- comment: on one line, so it cannot end the comment. */
const oneLine = (v) => String(v ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ');

/** The CHECK conditions of a plain value in column `col`. */
function valueChecks(col, value) {
  const checks = [];
  if (value.enum) checks.push(`${col} IN (${value.enum.map(literal).join(', ')})`);
  if (value.const !== undefined) checks.push(`${col} = ${literal(value.const)}`);
  if (value.formats) checks.push(`${col} ~ ${literal(DATE_OR_DATE_TIME)}`);
  // PostgreSQL's regular expressions (ARE) read the catalog's patterns as JSON Schema does, lookaheads included.
  if (value.pattern) checks.push(`${col} ~ ${literal(value.pattern)}`);
  if (value.minimum !== undefined) checks.push(`${col} >= ${num(value.minimum, `${col}: minimum`)}`);
  if (value.maximum !== undefined) checks.push(`${col} <= ${num(value.maximum, `${col}: maximum`)}`);
  if (value.exclusiveMinimum !== undefined) checks.push(`${col} > ${num(value.exclusiveMinimum, `${col}: exclusiveMinimum`)}`);
  if (value.exclusiveMaximum !== undefined) checks.push(`${col} < ${num(value.exclusiveMaximum, `${col}: exclusiveMaximum`)}`);
  if (value.minLength !== undefined) checks.push(`char_length(${col}) >= ${count(value.minLength, `${col}: minLength`)}`);
  if (value.maxLength !== undefined) checks.push(`char_length(${col}) <= ${count(value.maxLength, `${col}: maxLength`)}`);
  return checks;
}

/** A comment: each language's text on its own line, then the IRIs. */
function comment(languages, texts, iris) {
  const lines = [...new Set(languages.map((l) => textIn(texts, l, languages)).filter(Boolean)), ...iris.filter(Boolean).map((i) => `<${i}>`)];
  return literal(lines.join('\n'));
}

// A list without duplicates (uniqueItems). A CHECK cannot hold a subquery, so it calls this function,
// which the file creates first (CREATE OR REPLACE: the files of several models can run one after another).
export const UNIQUE_ITEMS = 'datamodels_unique_items';
const uniqueItemsFunction = `CREATE OR REPLACE FUNCTION ${UNIQUE_ITEMS}(anyarray) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT count(*) = count(DISTINCT x) FROM unnest($1) AS x $$;`;

/** Why a model has no table. */
export class NoTable extends Error {}

/** The table's name: the type in snake_case (EvacuationSite → evacuation_site). */
export const tableName = (model) => snake(model.type);

/** The SQL of an entity model: CREATE TABLE, its index and comments. */
export function createTable(subject, model, context) {
  const { languages } = context;
  const links = linksOf(subject, model, context);
  const table = ident(tableName(model));
  const columns = [];
  const checks = [];
  const comments = [];
  const indexes = [];
  // The columns of each attribute, for the "at least one of" checks.
  const columnsOfAttribute = {};
  let needsUnique = false;
  // Two attributes can give the same column name (fooBar and foo_bar, or address_postal_code and
  // address.postalCode): such a model has no table, rather than one PostgreSQL refuses.
  const used = new Map();
  const add = (name, type, { notNull = false, primaryKey = false, texts = {}, iris = [] } = {}) => {
    if (used.has(name)) throw new NoTable(`${model.type}: the column ${name} would hold both ${used.get(name)} and ${iris.at(-1) ?? name}`);
    used.set(name, iris.at(-1) ?? name);
    const col = ident(name);
    columns.push(`  ${col} ${type}${primaryKey ? ' PRIMARY KEY' : notNull ? ' NOT NULL' : ''}`);
    comments.push(`COMMENT ON COLUMN ${table}.${col} IS ${comment(languages, texts, iris)};`);
    return col;
  };
  add('id', 'text', { primaryKey: true, texts: inEach(languages, (t) => t.id.replace('{type}', model.type)) });
  for (const c of columnsOf(model, context)) {
    const name = snake(c.name);
    if (c.kind === 'geometry') {
      const pg = c.geometryTypes.length === 1 ? c.geometryTypes[0] : 'Geometry';
      const col = add(name, `geometry(${pg}, 4326)`, { notNull: c.required, texts: c.texts, iris: [c.iri] });
      if (c.geometryTypes.length > 1 && c.geometryTypes.length < 7) checks.push(`GeometryType(${col}) IN (${c.geometryTypes.map((g) => literal(g.toUpperCase())).join(', ')})`);
      indexes.push(`CREATE INDEX ${ident(`${tableName(model)}_${name}_idx`)} ON ${table} USING gist (${col});`);
      columnsOfAttribute[c.name] = [col];
    } else if (c.kind === 'parts') {
      columnsOfAttribute[c.name] = c.parts.map((p) => {
        const col = add(`${name}_${snake(p.name)}`, sqlType(p.value), { notNull: c.required && p.required, texts: joinTexts(languages, p.texts, inEach(languages, (t) => t.partOf(c.name))), iris: [c.iri, p.iri] });
        checks.push(...valueChecks(col, p.value));
        return col;
      });
      // A required value type whose fields are all optional: at least one field.
      if (c.required && !c.parts.some((p) => p.required)) checks.push(columnsOfAttribute[c.name].map((col) => `${col} IS NOT NULL`).join(' OR '));
    } else if (c.kind === 'scalar') {
      const col = add(name, sqlType(c.value), { notNull: c.required, texts: c.texts, iris: [c.iri] });
      checks.push(...valueChecks(col, c.value));
      columnsOfAttribute[c.name] = [col];
    } else if (c.kind === 'list') {
      const col = add(name, `${sqlType(c.item)}[]`, { notNull: c.required, texts: c.texts, iris: [c.iri] });
      const values = c.item.enum ?? (c.item.const !== undefined ? [c.item.const] : null);
      if (values) checks.push(`${col} <@ ARRAY[${values.map(literal).join(', ')}]::${sqlType(c.item)}[]`);
      if (c.minItems) checks.push(`cardinality(${col}) >= ${count(c.minItems, `${col}: minItems`)}`);
      if (c.uniqueItems) { checks.push(`${UNIQUE_ITEMS}(${col})`); needsUnique = true; }
      // No empty values in a list: NGSI-LD has no null inside a value.
      checks.push(`array_position(${col}, NULL) IS NULL`);
      columnsOfAttribute[c.name] = [col];
    } else {
      const col = add(name, 'jsonb', { notNull: c.required, texts: c.texts, iris: [c.iri] });
      columnsOfAttribute[c.name] = [col];
    }
  }
  const rules = crossRules(model.schema);
  for (const group of rules.atLeastOne) {
    const cols = group.flatMap((n) => columnsOfAttribute[n] ?? []);
    if (cols.length) checks.push(cols.map((col) => `${col} IS NOT NULL`).join(' OR '));
  }
  const header = [
    `-- ${oneLine(model.type)}: ${oneLine(links.typeIri)}`,
    `-- ${oneLine(subject.name)} v${oneLine(subject.version)}. JSON Schema: ${oneLine(links.schemaUrl)}`,
    `-- @context: ${oneLine(links.contextUrl)}`,
    '-- Columns are the attributes in snake_case; <attribute>_<field> columns are the fields of one value (an address).',
    ...(rules.other ? [`-- Not checked here: rules that span attributes (if/then), in the JSON Schema.`] : []),
  ];
  const tableTexts = joinTexts(languages, model.catalog?.title, model.catalog?.description, inEach(languages, (t, l) => sentences(l, rules.atLeastOne.map((g) => t.atLeastOne(g)))));
  return [
    ...header,
    ...(needsUnique ? [uniqueItemsFunction] : []),
    `CREATE TABLE ${table} (`,
    [...columns, ...checks.map((c) => `  CHECK (${c})`)].join(',\n'),
    ');',
    ...indexes,
    `COMMENT ON TABLE ${table} IS ${comment(languages, tableTexts, [links.typeIri])};`,
    ...comments,
  ].join('\n') + '\n';
}

export default {
  name: 'postgis',
  label: { ja: 'PostgreSQL / PostGIS のテーブル', en: 'PostgreSQL / PostGIS table' },
  note: {
    ja: 'CREATE TABLE 文。列名は属性名の snake_case で、必須・使える値・パターンを制約で検査します。位置は SRID 4326 のジオメトリ（GiST インデックス付き）、説明と IRI は COMMENT にあります。',
    en: 'A CREATE TABLE statement: columns are the attribute names in snake_case, with constraints for required attributes, allowed values and patterns; location is a geometry in SRID 4326 with a GiST index; descriptions and IRIs are in the comments.',
  },
  urlFor: (subject, model, context) => {
    const url = adapterUrl('postgis', 'sql')(subject, model, context);
    if (!url) return null;
    try { createTable(subject, model, context); return url; } catch (e) { if (e instanceof NoTable) return null; throw e; }
  },
  content: createTable,
};
