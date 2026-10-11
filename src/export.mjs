// datamodels export: the files of one or more adapters (src/adapters/) for one
// entity model, from this node or from another node's catalog.json (such as
// datamodels.jp's), as convert and extend read them.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadNode } from './build/node.mjs';
import { catalogUrls } from './build/urls.mjs';
import { ADAPTERS, getter, textsOfEntry, readRefs, localRefs, schemaPrefixes, normalUrl } from './adapters/index.mjs';

const DEFAULT_INDEX = 'https://datamodels.jp/catalog.json';

/** A model of another node, from its catalog.json, shaped as loadSubjects() shapes one. */
export async function remoteModel(target, from, get) {
  const catalog = await get(from);
  if (!Array.isArray(catalog?.models)) throw new Error(`${from}: no models (is it a catalog.json?)`);
  const entry = /^https?:\/\//.test(target) ? catalog.models.find((m) => m.typeIri === target) : catalog.models.find((m) => `${m.subject}/${m.type}` === target);
  if (!entry) throw new Error(`${target} is not a model in ${from}${/^https?:/.test(target) ? '' : ' (give <subject>/<Type> as listed there, or its type IRI)'}`);
  if (!entry.schemaUrl) throw new Error(`${from}: ${target} has no schemaUrl`);
  // Only a schema of that catalog's own site, as for the $refs (src/adapters/index.mjs).
  const schemaRoot = new URL('schema/', new URL('.', from)).href;
  const schemaUrl = normalUrl(entry.schemaUrl);
  if (!schemaUrl?.startsWith(schemaRoot)) throw new Error(`${from}: the schema of ${target} (${entry.schemaUrl}) is not under ${schemaRoot}, not read`);
  const schema = await get(schemaUrl);
  // The catalog's languages, in the order its titles give them (datamodels.jp: ja, en).
  const languages = Object.keys(entry.title ?? {}).length ? Object.keys(entry.title) : ['en'];
  const subject = { name: entry.subject, version: entry.version };
  const model = {
    type: entry.type, kind: entry.kind ?? 'entity', schema,
    catalog: { title: entry.title, description: entry.description, attributes: textsOfEntry(entry) },
    links: { typeIri: entry.typeIri, schemaUrl: entry.schemaUrl, contextUrl: entry.contextAliasUrl ?? entry.contextUrl, pageUrl: entry.pageUrl },
  };
  // Its schemas may refer to its own and those of the nodes it lists, such as datamodels.jp's.
  const nodes = [{ url: new URL('.', from).href }, ...(Array.isArray(catalog.nodes) ? catalog.nodes : [])];
  return { subject, model, languages, urls: catalogUrls(new URL('.', from).href), entries: catalog.models, nodes };
}

/**
 * The files of the adapters `names` for one entity model: { files: [{ adapter, name, content }], from, typeIri }.
 * `target`: <subject>/<Type>, or a type IRI for a model of another node.
 * The model is this node's when `dir` is a node that has it and no `index` is
 * given; otherwise it is read from `index` (default: the first node in
 * node.yaml, else datamodels.jp).
 */
export async function exportModel(target, names, { dir = '.', index, fetch: fetchUrl = globalThis.fetch, timeout = 20000 } = {}) {
  const adapters = names.map((n) => {
    const a = ADAPTERS.find((x) => x.name === n);
    if (!a) throw new Error(`no adapter ${n} (has: ${ADAPTERS.map((x) => x.name).join(', ')})`);
    return a;
  });
  let local = null;
  if (!index) local = await loadNode(dir).catch((e) => (/node\.yaml: not found/.test(e.message) ? null : Promise.reject(e)));
  // <subject>/<Type>, or a type IRI: this node's model when it has one with that IRI.
  const byIri = /^https?:\/\//.test(target);
  const [subjectName, type] = byIri ? [] : String(target).split('/');
  const pairs = (local?.subjects ?? []).flatMap((x) => x.models.map((m) => [x, m]));
  let [subject, model] = pairs.find(([x, m]) => (byIri ? local.urls.modelUrls(x, m).typeIri === target : x.name === subjectName && m.type === type)) ?? [];
  let context, from;
  if (model) {
    const { refs, problems } = await readRefs([model], { local: localRefs(local.subjects, local.urls), fetch: fetchUrl, timeout, trusted: schemaPrefixes(local.node.nodes) });
    if (problems.length) throw new Error(problems.join('\n'));
    context = { urls: local.urls, languages: local.node.languages, refs };
    from = dir;
  } else {
    from = index ?? local?.node.nodes?.[0]?.index ?? DEFAULT_INDEX;
    const r = await remoteModel(target, from, getter(fetchUrl, timeout));
    ({ subject, model } = r);
    const { refs, problems } = await readRefs([model], { entries: r.entries, fetch: fetchUrl, timeout, trusted: schemaPrefixes(r.nodes) });
    if (problems.length) throw new Error(problems.join('\n'));
    context = { urls: r.urls, languages: r.languages, refs };
  }
  if (model.kind !== 'entity') throw new Error(`${target} is a value type; the adapters write files for entity types`);
  const files = adapters.map((a) => {
    const url = a.urlFor(subject, model, context);
    if (!url) {
      // The adapter's own reason, when its content says one.
      let why = '';
      try { a.content(subject, model, context); } catch (e) { why = `: ${e.message}`; }
      throw new Error(`${target}: ${a.name} has no file for this model${why}`);
    }
    return { adapter: a.name, name: url.split('/').pop(), content: a.content(subject, model, context) };
  });
  return { files, from, typeIri: model.links?.typeIri ?? context.urls.modelUrls(subject, model).typeIri };
}

/** Write the files of exportModel() into `out`, over files of the same name. Returns the paths written. */
export async function writeExport(files, out) {
  await mkdir(out, { recursive: true });
  const written = [];
  for (const f of files) { const p = join(out, f.name); await writeFile(p, f.content); written.push(p); }
  return written;
}
