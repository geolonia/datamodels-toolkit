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
import { catalogUrls } from './build/urls.mjs';
import { placeModel } from './add.mjs';

const TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/;
const DEFAULT_INDEX = 'https://datamodels.jp/catalog.json';
const exists = (p) => stat(p).then(() => true, () => false);
// Keys of the other catalog's schema that describe it, not the copy.
const NOT_COPIED = ['$id', 'title', 'x-version', 'x-license-url', 'x-model-tags', 'x-derived-from', 'x-alias-of', 'x-subclass-of'];

/** The models of an index that can be extended: entities, with the URLs extend needs. */
export async function extendableModels(index, { fetch: fetchUrl = globalThis.fetch, timeout = 20000 } = {}) {
  const res = await fetchUrl(index, { signal: AbortSignal.timeout(timeout) }).catch((e) => { throw new Error(`${index} could not be read (${e.cause?.code ?? e.message})`); });
  if (!res.ok) throw new Error(`${index}: HTTP ${res.status}`);
  const catalog = await res.json().catch(() => { throw new Error(`${index}: not JSON`); });
  if (!Array.isArray(catalog?.models)) throw new Error(`${index}: no models (is it a catalog.json?)`);
  return catalog.models.filter((m) => (m.kind ?? 'entity') === 'entity' && m.typeIri && m.version && m.contextUrl && m.schemaUrl);
}

/**
 * Extend `source` (a type IRI, or <subject>/<Type> as in the index) as
 * `target` (<subject>/<Type> of this node). Options: `index` (default: the
 * first node in node.yaml, else datamodels.jp), `subclass`, `fetch`, `timeout`.
 * Returns { added, changed, typeIri, extends }.
 */
export async function extendModel(dir, source, target, { index, subclass = false, fetch: fetchUrl = globalThis.fetch, timeout = 20000 } = {}) {
  const [subjectName, type, ...rest] = String(target).split('/');
  if (!subjectName || !type || rest.length) throw new Error(`the new model is <subject>/<Type>, for example road/RoadTask; got ${JSON.stringify(target)}`);
  if (!TYPE_NAME.test(type)) throw new Error(`type name "${type}" must be UpperCamelCase ASCII (letters and digits), for example RoadTask`);
  const node = await readNode(dir);
  const subjectDir = join(dir, 'models', subjectName);
  if (!(await exists(join(subjectDir, 'subject.yaml')))) throw new Error(`no subject ${subjectName} in ${join(dir, 'models')} (datamodels init writes the first one)`);
  const subject = YAML.parse(await readFile(join(subjectDir, 'subject.yaml'), 'utf8'));
  const from = index ?? node.nodes?.[0]?.index ?? DEFAULT_INDEX;
  const get = async (url) => {
    let res;
    try { res = await fetchUrl(url, { signal: AbortSignal.timeout(timeout) }); } catch (e) { throw new Error(`${url} could not be read (${e.cause?.code ?? e.message})`); }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  };

  const models = await extendableModels(from, { fetch: fetchUrl, timeout });
  const entry = /^https?:\/\//.test(source) ? models.find((m) => m.typeIri === source) : models.find((m) => `${m.subject}/${m.type}` === source);
  if (!entry) throw new Error(`${source} is not an entity type in ${from}${/^https?:/.test(source) ? '' : ' (give <subject>/<Type> as listed there, or its type IRI)'}`);
  const theirs = await get(entry.schemaUrl);

  // This node imports the other node's @context, so it must list that node (node.yaml, nodes).
  const nodeUrl = new URL('/', entry.contextUrl).href;
  const listed = (node.nodes ?? []).some((n) => entry.contextUrl.startsWith(`${n.url.replace(/\/+$/, '')}/context/`));
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
  const catalog = `# ${type}: ${kind}, from ${entry.typeIri} v${entry.version}.
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
  const keyValues = (entry.exampleUrls ?? []).find((u) => /\/example\.json$/.test(u));
  if (keyValues) {
    try {
      const theirExample = await get(keyValues);
      example = { ...theirExample, id: String(theirExample.id ?? '').replace(`:${entry.type}:`, `:${type}:`) || example.id, type };
    } catch { /* the minimal example */ }
  }

  await placeModel(subjectDir, type, { schema, catalog, example }, (context, terms) => {
    // Import the other model's @context at its exact version, first, so this node's terms come after it.
    const parts = Array.isArray(context['@context']) ? context['@context'] : [context['@context']];
    if (!parts.includes(entry.contextUrl)) context['@context'] = [entry.contextUrl, ...parts];
    const namespace = urls.subjectUrls({ name: subjectName, version: subject.version }).namespace;
    const prefix = Object.entries(terms).find(([, v]) => v === namespace)?.[0];
    terms[type] = subclass ? (prefix ? `${prefix}:${type}` : ownIri) : entry.typeIri;
  });
  if (nodeYaml) await writeFile(join(dir, 'node.yaml'), nodeYaml);
  const at = `models/${subjectName}`;
  return {
    added: [`${at}/${type}/schema.json`, `${at}/${type}/catalog.yaml`, `${at}/${type}/examples/example.json`],
    changed: [...(nodeYaml ? ['node.yaml'] : []), `${at}/context.jsonld`],
    typeIri,
    extends: { typeIri: entry.typeIri, version: entry.version, index: from },
  };
}
