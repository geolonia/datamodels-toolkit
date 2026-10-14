// datamodels extend (#13): start a model of this node from a model of another
// node, such as datamodels.jp's, what the extension builder on datamodels.jp
// does in the browser. The new model copies the other model's schema at its
// version, imports its @context, and records it in `extends`, so check keeps
// its names and meanings. Then add the attributes this node needs.
//
// Two kinds (docs/node.md, section 3):
//   - an extension (default): the same type with more attributes; the type
//     keeps the other model's IRI (x-alias-of).
//   - a subtype (--subclass): a type of its own in this node's namespace, with
//     the other model as its parent (x-subclass-of).
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { readNode } from './build/node.mjs';
import { parseYaml } from './build/load.mjs';
import { catalogUrls } from './build/urls.mjs';
import { placeModel } from './add.mjs';
import { getter, normalUrl } from './adapters/index.mjs';
import { DEFAULT_INDEX, OWN_INDEX_TIMEOUT, TYPE_NAME, indexForModel, triedFirst, usableEntry } from './discover.mjs';

const exists = (p) => stat(p).then(() => true, () => false);
// Keys of the other catalog's schema that describe it, not the copy.
const NOT_COPIED = ['$id', 'title', 'x-version', 'x-license-url', 'x-model-tags', 'x-derived-from', 'x-alias-of', 'x-subclass-of'];

/**
 * The models of an index that can be extended: entities, with the URLs extend needs.
 * Read through the adapters' getter: https on a public host name only.
 */
export async function extendableModels(index, { fetch: fetchUrl = globalThis.fetch, timeout = 20000 } = {}) {
  return entityModels(await getter(fetchUrl, timeout)(index), index);
}

/**
 * Whether a catalog entry can be extended: an entity with a plain type name and
 * x.y.z version (they go into the YAML this writes), a type IRI and the URLs extend needs.
 */
const extendable = (m) => (m?.kind ?? 'entity') === 'entity' && usableEntry(m)
  && typeof m.typeIri === 'string' && /^https?:\/\/\S+$/.test(m.typeIri) && typeof m.contextUrl === 'string';

/** Text from another catalog for a YAML comment: one line, no control characters. */
const oneLine = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');

/**
 * What the picker of `datamodels extend` offers: the models of `index`, else of
 * the first node in node.yaml, else of datamodels.jp. Returns { index, models }:
 * the model picked is extended from that index, not from the index of the node
 * that minted its IRI (an alias has another node's IRI).
 */
export async function extendChoices(dir, index, options = {}) {
  const from = index ?? (await readNode(dir)).nodes?.[0]?.index ?? DEFAULT_INDEX;
  return { index: from, models: await extendableModels(from, options) };
}

/** The line extend prints when it is done. */
export const extendMessage = (target, r) => `${target}: ${r.typeIri}, extends ${r.extends.typeIri} v${r.extends.version}, from ${r.extends.index}. Next: this node's attributes in schema.json (each with x-iri), context.jsonld and catalog.yaml, then datamodels check.`;

/** The models of a catalog that can be extended (extendableModels). */
function entityModels(catalog, index) {
  if (!Array.isArray(catalog?.models)) throw new Error(`${index}: no models (is it a catalog.json?)`);
  return catalog.models.filter(extendable);
}

/**
 * Extend `source` (a type IRI, or <subject>/<Type> as in the index) as
 * `target` (<subject>/<Type> of this node). Options: `index` (default: for a
 * type IRI the index of the node that minted it, when that index lists it;
 * else the first node in node.yaml, else datamodels.jp), `subclass`, `fetch`, `timeout`,
 * `guessTimeout` (how long that first read may take).
 * Returns { added, changed, typeIri, extends }.
 */
export async function extendModel(dir, source, target, { index, subclass = false, fetch: fetchUrl = globalThis.fetch, timeout = 20000, guessTimeout = OWN_INDEX_TIMEOUT } = {}) {
  const [subjectName, type, ...rest] = String(target).split('/');
  if (!subjectName || !type || rest.length) throw new Error(`the new model is <subject>/<Type>, for example road/RoadTask; got ${JSON.stringify(target)}`);
  if (!TYPE_NAME.test(type)) throw new Error(`type name "${type}" must be UpperCamelCase ASCII (letters and digits), for example RoadTask`);
  const node = await readNode(dir);
  const subjectDir = join(dir, 'models', subjectName);
  if (!(await exists(join(subjectDir, 'subject.yaml')))) throw new Error(`no subject ${subjectName} in ${join(dir, 'models')} (datamodels init writes the first one)`);
  const subject = await parseYaml(join(subjectDir, 'subject.yaml'), join(dir, 'models'));
  const usual = index ?? node.nodes?.[0]?.index ?? DEFAULT_INDEX;
  // A type IRI without --index: the index of the node that minted it first, when it lists
  // the IRI as a model that can be extended.
  const byIri = /^https?:\/\//.test(source);
  const where = byIri && !index ? await indexForModel(source, usual, { fetch: fetchUrl, timeout, cap: guessTimeout, accepts: extendable, what: 'an entity type with a version, @context and schema' }) : { from: usual, tried: null };
  const from = where.from;
  // Every read (the index, the schema, the example) goes through the adapters' getter:
  // https on a public host name only, checked again on every redirect.
  const get = getter(fetchUrl, timeout);

  const entry = await (async () => {
    const models = where.catalog ? entityModels(where.catalog, from) : await extendableModels(from, { fetch: fetchUrl, timeout });
    const found = byIri ? models.find((m) => m.typeIri === source) : models.find((m) => `${m.subject}/${m.type}` === source);
    if (!found) throw new Error(`${source} is not an entity type in ${from}${byIri ? '' : ' (give <subject>/<Type> as listed there, or its type IRI)'}`);
    return found;
  })().catch((e) => { throw triedFirst(e, where.tried); });

  // This node imports the other node's @context, so it must list that node (node.yaml, nodes).
  // The other node's base URL is where its catalog.json is, a path included (a GitHub Pages project site).
  // A node imports contexts from <node>/context/ only (the build checks it), so another place is refused here.
  // Its schema and example are read only from its own schema/ and examples/ (redirects too), as export does
  // (src/export.mjs), and only after these checks.
  // The URLs as they are requested (dot segments, also %2e%2e, resolved), so a prefix check sees the real path.
  const nodeUrl = new URL('.', from).href;
  const contextUrl = normalUrl(entry.contextUrl);
  if (!contextUrl?.startsWith(`${nodeUrl}context/`)) throw new Error(`${entry.contextUrl} is not under ${nodeUrl}context/, where ${from} publishes its @contexts, so a node cannot import it (docs/node.md)`);
  const schemaUrl = normalUrl(entry.schemaUrl);
  if (!schemaUrl?.startsWith(`${nodeUrl}schema/`)) throw new Error(`${from}: the schema of ${entry.typeIri} (${entry.schemaUrl}) is not under ${nodeUrl}schema/, not read`);
  const keyValues = (Array.isArray(entry.exampleUrls) ? entry.exampleUrls : []).find((u) => typeof u === 'string' && /\/example\.json$/.test(u));
  const exampleUrl = keyValues === undefined ? null : normalUrl(keyValues);
  if (keyValues !== undefined && !exampleUrl?.startsWith(`${nodeUrl}examples/`)) throw new Error(`${from}: the example of ${entry.typeIri} (${keyValues}) is not under ${nodeUrl}examples/, not read`);
  const theirs = await get(schemaUrl, { under: `${nodeUrl}schema/` });
  const listed = (node.nodes ?? []).some((n) => contextUrl.startsWith(normalUrl(`${n.url.replace(/\/+$/, '')}/context/`)));
  let nodeYaml;
  if (!listed) {
    // The document API keeps the comments init wrote. Written once the model is in place.
    const doc = YAML.parseDocument(await readFile(join(dir, 'node.yaml'), 'utf8'));
    if (!doc.has('nodes')) doc.set('nodes', doc.createNode([]));
    const item = doc.createNode({ url: nodeUrl, index: from });
    item.flow = true;
    doc.get('nodes').items.push(item);
    nodeYaml = doc.toString({ lineWidth: 0 });
  }

  const urls = catalogUrls(node.baseUrl, { iris: node.iris });
  const ownIri = urls.term(subjectName, type);
  const typeIri = subclass ? ownIri : entry.typeIri;
  const pick = (texts, fallback) => Object.fromEntries(node.languages.map((l) => [l, texts?.[l] ?? texts?.en ?? Object.values(texts ?? {})[0] ?? fallback]));
  const schema = {
    $schema: theirs.$schema ?? 'https://json-schema.org/draft/2020-12/schema',
    $id: urls.modelUrls({ name: subjectName, version: subject.version }, { type, schema: {} }).schemaExact,
    title: type,
    ...(subclass ? { 'x-subclass-of': entry.typeIri } : { 'x-alias-of': entry.typeIri }),
    ...Object.fromEntries(Object.entries(theirs).filter(([k]) => !NOT_COPIED.includes(k) && k !== '$schema')),
  };
  schema.properties = { ...theirs.properties, type: { ...(theirs.properties?.type ?? { type: 'string' }), const: type } };
  // An attribute's description in each language of this node, from the other catalog when it has one.
  const attributes = Object.fromEntries((entry.attributes ?? []).filter((a) => schema.properties[a.name]).map((a) => [a.name, pick(a.description, a.name)]));
  for (const name of Object.keys(schema.properties)) if (!['id', 'type', '@context'].includes(name) && !attributes[name]) attributes[name] = pick(undefined, schema.properties[name]?.description ?? name);
  const kind = subclass ? `a subtype of ${entry.type}` : `${entry.type} with the attributes of this node`;
  const catalog = `# ${type}: ${oneLine(kind)}, from ${oneLine(entry.typeIri)} v${oneLine(entry.version)}.
# The schema is a copy at that version. Add this node's attributes to schema.json (each with x-iri),
# to the subject's context.jsonld and here under attributes, in each language.
${YAML.stringify({
    // A subtype is a type of its own: its own title, and a description that names its parent.
    title: subclass ? pick(undefined, type) : pick(entry.title, type),
    description: subclass ? pick(undefined, `A subtype of ${entry.type} (${entry.typeIri}).`) : pick(entry.description, `One ${type}.`),
    status: 'draft',
    attributes,
    extends: [{ typeIri: entry.typeIri, version: entry.version, index: from }],
  }, { lineWidth: 0 })}`;

  // The other catalog's example, with this type; a minimal one when there is none.
  let example = { id: `urn:ngsi-ld:${type}:example-1`, type };
  if (exampleUrl) {
    try {
      const theirExample = await get(exampleUrl, { under: `${nodeUrl}examples/` });
      example = { ...theirExample, id: String(theirExample.id ?? '').replace(`:${entry.type}:`, `:${type}:`) || example.id, type };
    } catch { /* the minimal example */ }
  }

  const notes = `# Notes: the sources, the decisions and their reasons, what is left out. Shown on the model's page.
# Why this model extends ${oneLine(entry.typeIri)} v${oneLine(entry.version)}, and what it adds. One item per note, in each language of the node:
#   - { ${node.languages.map((l) => `${l}: …`).join(', ')} }
notes: []
`;
  await placeModel(subjectDir, type, { schema, catalog, example, notes }, (context, terms) => {
    // Import the other model's @context at its exact version, first, so this node's terms come after it.
    const parts = Array.isArray(context['@context']) ? context['@context'] : [context['@context']];
    if (!parts.includes(contextUrl)) context['@context'] = [contextUrl, ...parts];
    const namespace = urls.subjectUrls({ name: subjectName, version: subject.version }).namespace;
    const prefix = Object.entries(terms).find(([, v]) => v === namespace)?.[0];
    terms[type] = subclass ? (prefix ? `${prefix}:${type}` : ownIri) : entry.typeIri;
  });
  if (nodeYaml) await writeFile(join(dir, 'node.yaml'), nodeYaml);
  const at = `models/${subjectName}`;
  return {
    added: [`${at}/${type}/schema.json`, `${at}/${type}/catalog.yaml`, `${at}/${type}/examples/example.json`, `${at}/${type}/notes.yaml`],
    changed: [...(nodeYaml ? ['node.yaml'] : []), `${at}/context.jsonld`],
    typeIri,
    extends: { typeIri: entry.typeIri, version: entry.version, index: from },
  };
}
