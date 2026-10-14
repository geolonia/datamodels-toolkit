// The checks of a model's schema rules, its examples and the JSON-LD they
// make. Moved from geolonia/datamodels (scripts/validate-models.mjs,
// geolonia/datamodels#226), with the node's URLs instead of datamodels.jp's.
//
//   - schema.json: the type's const, $id and x-version fit the folder and the
//     subject, and every x-ngsi.type is an NGSI-LD attribute type.
//   - example.json validates with its json and vocab wrappers removed, also
//     with the @context that data may carry, and its polygons close.
//   - example-normalized.jsonld, when there is one, follows the NGSI-LD rules:
//     the attribute types of the schema, typed dates, the same id and vocab
//     values as example.json, and a key-values form that validates.
//   - A JSON-LD processor expands it: every attribute to its IRI, the type to
//     the model's IRI, and nothing is lost on the way back (compaction). A
//     value type is tried inside an entity, and the vocabulary must expand too.
import jsonld from 'jsonld';
import { readFileSync } from 'node:fs';
import { attributesOf } from './urls.mjs';
import { buildVocabulary } from './vocab.mjs';
import { NGSI_TYPES, toKeyValues, unwrapKeyValues, attributeProblems, unclosedRings } from '../ngsi.mjs';

export const CORE_CONTEXT_URL = 'https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.8.jsonld';
const CORE_DOCUMENT = JSON.parse(readFileSync(new URL('./ngsi-ld-core-context-v1.8.jsonld', import.meta.url), 'utf8'));
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const HAS_VOCAB = 'https://uri.etsi.org/ngsi-ld/hasVocab';
const DEFAULT_CONTEXT = 'https://uri.etsi.org/ngsi-ld/default-context/';
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Every key at any depth of an object tree, as "a.b.c" paths; JSON-LD keywords
 * left out. The objects in an array (the instances of a multi-valued
 * attribute) are followed under the array's path.
 */
export function keyPaths(obj, prefix = '') {
  if (Array.isArray(obj)) return [...new Set(obj.flatMap((v) => keyPaths(v, prefix)))];
  if (!isObject(obj)) return [];
  return Object.entries(obj).filter(([k]) => !k.startsWith('@')).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return [path, ...keyPaths(v, path)];
  });
}

/** The rules of a model's schema.json that the schema itself cannot state. `urls` from catalogUrls(). */
export function schemaRuleProblems(subject, model, urls) {
  const where = `${subject.name}/${model.type}/schema.json`;
  const { schema } = model;
  const out = [];
  if (model.kind === 'entity' && schema.properties?.type?.const !== model.type) out.push(`${where}: properties.type.const must be "${model.type}", the name of its folder`);
  const id = urls.modelUrls(subject, model).schemaExact;
  if (schema.$id !== id) out.push(`${where}: $id must be ${id}, where the build publishes it`);
  if (schema['x-version'] !== undefined && schema['x-version'] !== subject.version) out.push(`${where}: x-version must be ${subject.version}, the version of the subject`);
  for (const [name, prop] of attributesOf(model)) {
    const type = prop?.['x-ngsi']?.type;
    if (type !== undefined && !NGSI_TYPES.includes(type)) out.push(`${where}: ${name}: x-ngsi.type must be one of ${NGSI_TYPES.join(', ')}, got ${JSON.stringify(type)}`);
  }
  return out;
}

/**
 * The problems of a model's examples. `validate` is the model's schema
 * compiled by ajv, `errorsText` ajv's errorsText. JsonProperty and
 * VocabProperty keep a {"json": ...} or {"vocab": ...} wrapper in key-values
 * form; the schema describes what is inside it.
 */
export function exampleProblems(subject, model, { urls, validate, errorsText }) {
  const problems = [];
  const at = (f) => `${subject.name}/${model.type}/examples/${f}`;
  const su = urls.subjectUrls(subject);
  const attrs = attributesOf(model);
  const kv = model.examples['example.json'];
  if (kv !== undefined) {
    let plain;
    try { plain = unwrapKeyValues(kv, model.schema); } catch (e) { problems.push(`${at('example.json')}: ${e.message}`); }
    if (plain && !validate(plain)) problems.push(`${at('example.json')}: ${errorsText(validate.errors)}`);
    else if (plain && model.kind === 'entity') {
      // Data in key-values form may carry its @context, as one URL or a list (NGSI-LD, section 5.2.4).
      for (const context of [su.contextAlias, [su.contextExact, CORE_CONTEXT_URL]]) {
        if (!validate({ ...plain, '@context': context })) problems.push(`${subject.name}/${model.type}/schema.json: rejects example.json with "@context": ${JSON.stringify(context)} (${errorsText(validate.errors)}); an entity schema accepts @context as a string or a list of strings`);
      }
    }
    for (const p of unclosedRings(kv)) problems.push(`${at('example.json')}: ${p}: the polygon ring does not close (its first and last positions must be the same, RFC 7946)`);
  }

  // A value type has no normalized form of its own.
  const norm = model.examples['example-normalized.jsonld'];
  if (norm === undefined || model.kind !== 'entity') return problems;
  const f = at('example-normalized.jsonld');
  if (!isObject(norm)) return [...problems, `${f}: must be one entity, a JSON object`];
  if (isObject(kv) && norm.id !== kv.id) problems.push(`${f}: id must be example.json's id ${kv.id}`);
  for (const p of attributeProblems(norm, attrs)) {
    const a = `${f}: attribute "${p.attribute}"`;
    if (p.rule === 'multi') problems.push(`${a} has several instances, but schema.json does not declare x-ngsi.multi`);
    // An instance that is not an attribute object is reported with the key-values form below.
    else if (p.rule === 'type') problems.push(`${a} is a ${p.found}, but schema.json makes it a ${p.expected}${p.implicit ? ' (no x-ngsi.type)' : ''}`);
    // A date or date-time value carries its NGSI-LD type, and the type fits the value.
    else if (p.rule === 'date') problems.push(`${a}: the value must be { "@type": "${p.expected['@type']}", "@value": ${JSON.stringify(p.expected['@value'])} }`);
  }
  const multi = new Set(attrs.filter(([, p]) => p?.['x-ngsi']?.multi).map(([n]) => n));
  let projected;
  try { projected = toKeyValues(norm, { multi }); } catch (e) { return [...problems, `${f}: ${e.message}`]; }
  // Both examples describe the same entity, with the same vocabulary.
  if (isObject(kv)) for (const [name, prop] of attrs) {
    if (prop?.['x-ngsi']?.type !== 'VocabProperty' || !Object.hasOwn(kv, name) || !Object.hasOwn(norm, name)) continue;
    const vocabs = (x) => JSON.stringify([x].flat().map((i) => i?.vocab));
    if (vocabs(kv[name]) !== vocabs(norm[name])) problems.push(`${at('example.json')}: attribute "${name}": vocab ${vocabs(kv[name])} differs from example-normalized.jsonld's ${vocabs(norm[name])}`);
  }
  let plain;
  try { plain = unwrapKeyValues(projected, model.schema); } catch (e) { return [...problems, `${f}: ${e.message}`]; }
  if (!validate(plain)) problems.push(`${f}: its key-values form: ${errorsText(validate.errors)}`);
  for (const p of unclosedRings(projected)) problems.push(`${f}: ${p}: the polygon ring does not close (its first and last positions must be the same, RFC 7946)`);
  // Data names the alias of the major version, and the examples are what people copy.
  if (!Array.isArray(norm['@context']) || !norm['@context'].includes(su.contextAlias)) problems.push(`${f}: @context must be a list that includes ${su.contextAlias}`);
  return problems;
}

/**
 * A JSON-LD document loader for check: this node's own documents from
 * `local(url)` (see resolveContext), the NGSI-LD core context from the copy in
 * this package, any other https URL with `getJson` (not with `offline`).
 * `unread` collects the URLs that could not be read, so a failure they cause
 * is noted, not a problem.
 */
export function contextLoader({ local, getJson, offline = false }) {
  const unread = new Set();
  const documentLoader = async (url) => {
    if (url === CORE_CONTEXT_URL) return { documentUrl: url, document: CORE_DOCUMENT };
    // One of this node's files that the build did not write is a problem, not a note.
    const own = await local(url);
    if (own !== undefined) return { documentUrl: url, document: own };
    try {
      if (offline) throw new Error('not read with --offline');
      if (!url.startsWith('https://')) throw new Error('only https is read');
      return { documentUrl: url, document: await getJson(url) };
    } catch (e) {
      unread.add(`${url} (${e.cause?.code ?? e.message})`);
      throw e;
    }
  };
  return { documentLoader, unread };
}

/** Run a JSON-LD step: { problem } when it fails, { note } when it failed on a context that could not be read. */
async function attempt(loader, what, fn) {
  loader.unread.clear();
  try { await fn(); return {}; } catch (e) {
    if (loader.unread.size) return { note: `${what}: not checked, ${[...loader.unread].join('; ')}` };
    // jsonld wraps the loader's error in a long one of its own.
    return { problem: `${what}: JSON-LD processing failed: ${e.details?.cause?.message ?? e.message}` };
  }
}

/**
 * The JSON-LD of a model: its normalized example expands and compacts back
 * without losing anything, or, for a value type, its example does inside an
 * entity. `loader` from contextLoader(); `iriOf(name)` the IRI the subject's
 * @context gives a term (undefined when that is not known for sure). Returns
 * { problems, notes }.
 */
export async function jsonldProblems(subject, model, { urls, loader, iriOf }) {
  const problems = [];
  const notes = [];
  const { documentLoader } = loader;
  const keep = (r) => { if (r.problem) problems.push(r.problem); if (r.note) notes.push(r.note); };
  const at = (f) => `${subject.name}/${model.type}/examples/${f}`;
  const su = urls.subjectUrls(subject);

  if (model.kind === 'value') {
    const kv = model.examples['example.json'];
    // An example that is not an object is already a problem of exampleProblems().
    if (!isObject(kv)) return { problems, notes };
    // Inside an entity: as its location when the values are geometries, else as a Property (NGSI-LD core terms both).
    const geo = model.schema['x-ngsi']?.type === 'GeoProperty';
    const probe = { '@context': [su.contextExact, CORE_CONTEXT_URL], id: 'urn:ngsi-ld:Probe:1', type: 'Probe', [geo ? 'location' : 'description']: { type: geo ? 'GeoProperty' : 'Property', value: kv } };
    keep(await attempt(loader, at('example.json'), async () => {
      const expanded = await jsonld.expand(probe, { documentLoader });
      const after = new Set(keyPaths(await jsonld.compact(expanded, { '@context': probe['@context'] }, { documentLoader })));
      for (const k of keyPaths(probe)) if (!after.has(k) && k !== 'type') problems.push(`${at('example.json')}: field "${k.replace(/^\w+\.value\./, '')}" is not defined by the @context, and JSON-LD drops it`);
    }));
    return { problems, notes };
  }

  const norm = model.examples['example-normalized.jsonld'];
  if (!isObject(norm)) return { problems, notes };
  const f = at('example-normalized.jsonld');
  const typeIri = urls.modelUrls(subject, model).typeIri;
  keep(await attempt(loader, f, async () => {
    const expanded = await jsonld.expand(norm, { documentLoader });
    const node = expanded[0] ?? {};
    for (const [name, prop] of attributesOf(model)) {
      if (!Object.hasOwn(norm, name)) continue;
      const iri = iriOf(name);
      if (!iri) continue;
      if (!Object.hasOwn(node, iri)) { problems.push(`${f}: attribute "${name}" does not expand to ${iri}`); continue; }
      // A VocabProperty value is an IRI: a word no context defines ends up in the NGSI-LD default context, which means nothing.
      if (prop?.['x-ngsi']?.type !== 'VocabProperty') continue;
      for (const inst of node[iri]) for (const v of inst[HAS_VOCAB] ?? []) {
        if (String(v['@id']).startsWith(DEFAULT_CONTEXT)) problems.push(`${f}: attribute "${name}": the vocab value expands to ${v['@id']}; define it in the @context or write a full IRI`);
      }
    }
    if (node['@type']?.[0] !== typeIri) problems.push(`${f}: the type expands to ${node['@type']?.[0]}, not ${typeIri}`);
    // Every key at every depth comes back: expansion drops a field that no context defines.
    const after = new Set(keyPaths(await jsonld.compact(expanded, { '@context': norm['@context'] }, { documentLoader })));
    for (const k of keyPaths(norm)) if (!after.has(k) && !/(^|\.)(type|value|object|datasetId|json|vocab)$/.test(k)) problems.push(`${f}: "${k}" is lost when JSON-LD expands and compacts it (is it in the @context?)`);
  }));
  return { problems, notes };
}

/** The vocabulary of a subject is valid JSON-LD and states every x-subclass-of. `options`: { urls, languages }. */
export async function vocabularyProblems(subject, options, loader) {
  const problems = [];
  const where = `${subject.name}: vocabulary`;
  const r = await attempt(loader, where, async () => {
    const expanded = await jsonld.expand(buildVocabulary(subject, options), { documentLoader: loader.documentLoader });
    for (const model of subject.models) {
      const parent = model.schema['x-subclass-of'];
      if (!parent || model.schema['x-alias-of']) continue;
      const cls = expanded.find((n) => n['@id'] === options.urls.modelUrls(subject, model).typeIri);
      if (!cls?.[`${RDFS}subClassOf`]?.some((o) => o['@id'] === parent)) problems.push(`${where}: ${model.type} is not rdfs:subClassOf ${parent} (is x-subclass-of a full IRI?)`);
    }
  });
  return { problems: [...problems, ...(r.problem ? [r.problem] : [])], notes: r.note ? [r.note] : [] };
}
