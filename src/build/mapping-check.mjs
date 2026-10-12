// The mapping files of a node (models/<subject>/<Type>/mapping/*.yaml). Moved
// from geolonia/datamodels (scripts/lib/mapping-check.mjs, #226) and aligned
// with datamodels convert.
//
// A mapping file in a catalog is a correspondence table first: the standard
// it maps, and for each field of the model the item of the standard (`to`,
// null when there is none), with notes. Its texts are in the node's
// languages. It may also carry the conversion rules that convert reads from
// the site: any rule that convert applies to a file of your own (column,
// transform, values, value, via, a convert.id template, a field name with a
// dot for a field of a value), with `via` naming another mapping file of the
// node. What a file of your own may leave out (the standard, `to`) a catalog
// file needs, because its page and catalog.json show them.
import { mappingProblems as ruleProblems } from '../convert.mjs';

const TOP = ['standard', 'fields', 'structure', 'convert'];
const STANDARD = ['name', 'url', 'license', 'note'];
const ROW = ['to', 'note', 'column', 'transform', 'values', 'value', 'via'];
// A field, or a position in an array field (coordinates[2]), or a field of a value (address.postalCode).
const FIELD = /^([A-Za-z][A-Za-z0-9]*)(\[\d+\])?$/;
const DOTTED = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// The page links standard.url: one with a user name or password in it would publish them.
const isLink = (u) => { if (typeof u !== 'string') return false; try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) && x.hostname !== '' && !x.username && !x.password; } catch { return false; } };

/**
 * A text in each of `languages` and nothing else but texts by language. In
 * YAML's { … } form a comma inside a text starts a new key, so a key that is
 * not a language means the text was cut there ("closed → completed, otherwise …").
 */
export const textsIn = (v, languages) => isObject(v) && Object.entries(v).every(([k, t]) => LANGUAGE.test(k) && typeof t === 'string')
  && languages.every((l) => typeof v[l] === 'string' && v[l].trim() !== '');

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const pointer = (doc, fragment) => (fragment === '' ? doc
  : fragment.startsWith('/') ? fragment.slice(1).split('/').reduce((n, k) => n?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], doc) : undefined);

/**
 * The members of a schema: the properties of the schema itself and of the
 * schemas it is made of (allOf, anyOf, oneOf, $ref), such as Geometry's type
 * and coordinates in its oneOf, but not the members of a property's value
 * (address.postalCode is a field of the address, not of the model). Each name
 * maps to the property's schemas, each with the document its references
 * resolve in. `schemas` maps a schema $id to the schema, for references to
 * other models. `open` when the schema does not settle which members a value
 * has: a reference to a schema that is not in `schemas`, or an object without
 * listed properties.
 */
function membersOf(node, doc, schemas = new Map()) {
  const names = new Map();
  const types = [];
  let open = false;
  const seen = new Set();
  const walk = (n, d) => {
    if (!isObject(n) || seen.has(n)) return;
    seen.add(n);
    if (n.type !== undefined) types.push(...[].concat(n.type));
    // A const or enum says the type too (type: { const: Point } has no members).
    if (n.const !== undefined) types.push(typeOf(n.const));
    if (Array.isArray(n.enum)) types.push(...n.enum.map(typeOf));
    if (isObject(n.properties)) for (const [k, p] of Object.entries(n.properties)) names.set(k, [...(names.get(k) ?? []), { node: p, doc: d }]);
    if (n.patternProperties !== undefined) open = true;
    for (const c of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(n[c])) for (const x of n[c]) walk(x, d);
    if (typeof n.$ref === 'string') {
      const i = n.$ref.indexOf('#');
      const [base, fragment] = i < 0 ? [n.$ref, ''] : [n.$ref.slice(0, i), n.$ref.slice(i + 1)];
      const target = base === '' ? d : schemas.get(base);
      const found = target && pointer(target, fragment);
      if (found) walk(found, target); else open = true;
    }
  };
  walk(node, doc);
  // A value with no listed members may still be an object with any keys, unless its type says otherwise.
  if (!names.size && (!types.length || types.includes('object'))) open = true;
  return { names, open };
}

// A property that is an array: its own type, or a $ref within its schema (Geometry's #/$defs/position).
const isArray = ({ node: p, doc }) => p?.type === 'array' || (Array.isArray(p?.type) && p.type.includes('array'))
  || (typeof p?.$ref === 'string' && p.$ref.startsWith('#') && pointer(doc, p.$ref.slice(1))?.type === 'array');

/**
 * The fields a mapping may name: the members of the model's schema, each
 * with whether it is an array, so a mapping may name a position.
 */
export function fieldNames(schema, schemas) {
  return new Map([...membersOf(schema, schema, schemas).names].map(([k, ps]) => [k, ps.some(isArray)]));
}

/**
 * What is wrong with a field of a value (address.postalCode): each part after
 * the first must be a member of the value before it. Null when the path is
 * fine, or when a schema on the way does not settle it.
 */
function pathProblem(field, schema, schemas) {
  const [first, ...rest] = field.split('.');
  let here = membersOf(schema, schema, schemas).names.get(first);
  if (!here) return `${first} is not an attribute of this model`;
  for (const [i, part] of rest.entries()) {
    const found = here.map(({ node, doc }) => membersOf(node, doc, schemas));
    if (found.some((m) => m.open)) return null;
    const next = found.flatMap((m) => m.names.get(part) ?? []);
    if (!next.length) return `${[first, ...rest.slice(0, i)].join('.')} has no field ${part}`;
    here = next;
  }
  return null;
}

/**
 * Cycles among `via` references, as lists of mapping names (subject/Type/name):
 * convert follows via, so a mapping that reaches itself would never finish.
 * `mappings` maps each name to its parsed file.
 */
export function viaCycles(mappings) {
  const cycles = [];
  const done = new Set();
  const visit = (name, chain) => {
    if (chain.includes(name)) { cycles.push([...chain.slice(chain.indexOf(name)), name]); return; }
    if (done.has(name) || !mappings[name]) return;
    for (const rule of Object.values(isObject(mappings[name].fields) ? mappings[name].fields : {})) if (typeof rule?.via === 'string') visit(rule.via, [...chain, name]);
    done.add(name);
  };
  for (const name of Object.keys(mappings)) visit(name, []);
  return cycles;
}

/**
 * The problems of one mapping file of a node. `map` is the parsed YAML with
 * `name`, the file name, and `fileKeys`, the keys the file itself has, as the
 * loader adds them; `schema` the model's JSON Schema; `languages` the node's;
 * `mappingNames` the subject/Type/name of every mapping file of the node,
 * which `via` may name; `schemas` the node's schemas by $id, to follow a field
 * of a value (address.postalCode) into the value's model.
 */
export function mappingFileProblems(map, schema, { languages = ['en'], mappingNames = new Set(), schemas = new Map() } = {}) {
  const out = [];
  const { name, fileKeys, ...doc } = map ?? {};
  const langs = languages.join(' and ');
  const needsTexts = (what) => `${what} needs a text in ${langs}, and nothing but texts by language (quote a text that contains a comma)`;
  // The file name is the mapping's name, so the file may not give itself another (fileKeys still has a name: written in it).
  for (const k of fileKeys ?? Object.keys(doc)) if (!TOP.includes(k)) out.push(`unknown key "${k}" (allowed: ${TOP.join(', ')})`);
  if (doc.convert !== undefined) {
    if (!isObject(doc.convert) || typeof doc.convert.id !== 'string' || !/\{[\w.]+\}/.test(doc.convert.id)) out.push('convert.id must be a template such as "urn:ngsi-ld:Type:{attribute}"');
    else for (const k of Object.keys(doc.convert)) if (k !== 'id') out.push(`unknown key "convert.${k}" (allowed: id)`);
  }
  const std = doc.standard;
  if (!isObject(std)) out.push('standard is required: the standard this file maps, with its name');
  else {
    for (const k of Object.keys(std)) if (!STANDARD.includes(k)) out.push(`unknown key "standard.${k}" (allowed: ${STANDARD.join(', ')})`);
    if (!textsIn(std.name, languages)) out.push(needsTexts('standard.name'));
    if (std.url !== undefined && !isLink(std.url)) out.push(`standard.url must be an http(s) URL with a host, got ${JSON.stringify(std.url)}`);
    if (std.license !== undefined && !(typeof std.license === 'string' ? std.license.trim() : textsIn(std.license, languages))) out.push(`standard.license must be a non-empty string, or a text in ${langs} and nothing but texts by language (quote a text that contains a comma)`);
    if (std.note !== undefined && !textsIn(std.note, languages)) out.push(needsTexts('standard.note'));
  }
  if (doc.structure !== undefined && !textsIn(doc.structure, languages)) out.push(needsTexts('structure'));
  const fields = doc.fields;
  if (!isObject(fields) || !Object.keys(fields).length) { out.push('fields must map at least one field of the model'); return out; }

  const known = fieldNames(schema, schemas);
  for (const [field, m] of Object.entries(fields)) {
    const f = FIELD.exec(field);
    const dotted = DOTTED.test(field);
    const path = dotted ? pathProblem(field, schema, schemas) : null;
    if (!f && !dotted) out.push(`${field}: not a field name (name, name[2] for a position, or name.field for a field of a value)`);
    else if (path) out.push(`${field}: ${path}`);
    else if (f && !known.has(f[1])) out.push(`${field}: not a field of this model`);
    else if (f?.[2] && !known.get(f[1])) out.push(`${field}: ${f[1]} is not an array, so it has no positions`);
    if (!isObject(m) || !('to' in m)) { out.push(`${field}: needs "to" (the corresponding item, or null when there is none)`); continue; }
    if (m.to !== null && (typeof m.to !== 'string' || !m.to.trim())) out.push(`${field}: "to" must be a non-empty string or null`);
    for (const k of Object.keys(m)) if (!ROW.includes(k)) out.push(`${field}: unknown key "${k}" (allowed: ${ROW.join(', ')})`);
    if (m.note !== undefined && !textsIn(m.note, languages)) out.push(needsTexts(`${field}: note`));
    const converts = ['column', 'transform', 'values', 'value', 'via'].some((k) => m[k] !== undefined);
    if ([m.column !== undefined, m.value !== undefined, m.via !== undefined].filter(Boolean).length > 1) out.push(`${field}: use one of column, value and via`);
    // convert writes a value under the field's name, so a row for a position in an array only documents it.
    if (converts && f?.[2]) out.push(`${field}: a position in an array cannot have a conversion rule (column, transform, values, value or via); convert fills the whole array`);
  }
  // The rules as convert applies them (transform names, columns per transform, values), with every mapping of the node as a via target.
  const targets = Object.fromEntries([...mappingNames].map((n) => [n, {}]));
  const rules = Object.fromEntries(Object.entries(fields).filter(([, m]) => isObject(m)).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).filter(([key]) => key !== 'to' && key !== 'note'))]));
  for (const p of ruleProblems({ fields: rules }, targets)) out.push(p.replace(/: no mapping (.*)$/, ': via must name a mapping file of this node as subject/Type/name, got $1'));
  return out;
}
