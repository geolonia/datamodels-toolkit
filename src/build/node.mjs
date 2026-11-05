// A node of the web of data models (geolonia/datamodels docs/node.md): its
// settings in node.yaml and its models in models/, built into the files the
// node publishes (#12).
//
//   baseUrl: https://models.example.org
//   iris: hash                      # or slash (needs w3id.org or a server that redirects)
//   languages: [en]
//   title: { en: Road models }                       # optional: the node's name, in every language
//   description: { en: Models for road maintenance. } # optional: what it publishes, in every language
//   publisher: { name: { en: Example Inc. }, url: https://example.org/ }
//   license: CC0-1.0
//   licenseUrl: https://models.example.org/LICENSE   # optional
//   nodes:                                           # optional: other nodes this node knows
//     - { url: https://datamodels.jp/, index: https://datamodels.jp/catalog.json }
//   prerelease: true                                 # optional: published versions may still be corrected (check --base)
//   adapters: [geonicdb]                             # optional: product adapters to turn on (the generic ones always are)
import { readFile, writeFile, mkdir, stat, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { catalogUrls } from './urls.mjs';
import { loadSubjects } from './load.mjs';
import { publishCatalog } from './publish.mjs';
import { llmsTxt } from './llms.mjs';
import { writePages } from './pages.mjs';
import { headersFile, redirectsFile, redirectsNote } from './hosts.mjs';
import { ADAPTERS, PRODUCT_ADAPTERS, readRefs, localRefs, refsRead, schemaPrefixes, getter } from '../adapters/index.mjs';
import { needsTerms } from '../adapters/geonicdb/custom-data-model.mjs';

// Every URL here is published: one with a user name or password in it would publish them too.
export const httpUrl = (s) => { if (typeof s !== 'string') return false; try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password; } catch { return false; } };
// Another node's address or index: https only, as the toolkit reads other nodes (src/adapters/index.mjs).
export const httpsUrl = (s) => httpUrl(s) && new URL(s).protocol === 'https:';
// A language tag, as node.yaml lists them: en, ja, pt-BR.
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;
const texts = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0 && Object.values(o).every((v) => typeof v === 'string' && v.trim());
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** What is wrong with a text that needs every language of the node and nothing but language tags, or null. */
export function textsProblem(v, languages) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `must be { ${languages.join(', ')} }`;
  const missing = languages.filter((l) => !nonEmpty(v[l]));
  if (missing.length) return `needs a non-empty ${missing.join(' and ')} text`;
  const other = Object.keys(v).filter((k) => !LANGUAGE_TAG.test(k) || !nonEmpty(v[k]));
  if (other.length) return `has ${other.map((k) => JSON.stringify(k)).join(', ')}, which is not a language with a text`;
  return null;
}

// The node's own texts: optional, and when given, in every language of the node. The title names the
// site on every page, in catalog.json, llms.txt and datamodels nodes; the home page shows the description.
const NODE_TEXTS = ['title', 'description'];

/** The problems of the settings of a node, as node.yaml holds them (also used by init before it writes). */
export function settingsProblems(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return ['must be a mapping of settings'];
  const problems = [];
  const { baseUrl, iris = 'hash', languages = ['en'], publisher, license, licenseUrl, nodes, prerelease, adapters } = node;
  if (adapters !== undefined && (!Array.isArray(adapters) || !adapters.every((a) => PRODUCT_ADAPTERS.some((p) => p.name === a)))) problems.push(`adapters must be a list of product adapters to turn on (${PRODUCT_ADAPTERS.map((p) => p.name).join(', ')}); the generic ones are always on`);
  if (!httpUrl(baseUrl) || new URL(baseUrl).search || new URL(baseUrl).hash) problems.push('baseUrl must be an http(s) URL without credentials, query or fragment');
  if (!['hash', 'slash'].includes(iris)) problems.push('iris must be hash or slash');
  if (!Array.isArray(languages) || !languages.length || !languages.every((l) => typeof l === 'string' && LANGUAGE_TAG.test(l))) problems.push('languages must be a list of language tags, for example [en] or [ja, en]');
  if (!texts(publisher?.name) || !httpUrl(publisher?.url)) problems.push('publisher needs a name in at least one language and an http(s) url');
  if (typeof license !== 'string' || !license.trim()) problems.push('license is required (an SPDX identifier such as CC0-1.0)');
  if (licenseUrl !== undefined && !httpUrl(licenseUrl)) problems.push('licenseUrl must be an http(s) URL');
  if (prerelease !== undefined && typeof prerelease !== 'boolean') problems.push('prerelease must be true or false');
  if (nodes !== undefined && (!Array.isArray(nodes) || !nodes.every((n) => httpsUrl(n?.url) && httpsUrl(n?.index)))) problems.push('nodes must be a list of { url, index }, both https URLs (other nodes are read only over https: change http:// to https://)');
  // Only a missing title or description means none; null or an empty one is a mistake.
  const langs = Array.isArray(languages) ? languages.filter((l) => typeof l === 'string') : [];
  for (const field of NODE_TEXTS) {
    const p = node[field] === undefined ? null : textsProblem(node[field], langs);
    if (p) problems.push(`${field} ${p}`);
  }
  return problems;
}

/** The settings in `<dir>/node.yaml`, checked; every problem in one error. */
export async function readNode(dir) {
  const file = join(dir, 'node.yaml');
  let node;
  try { node = YAML.parse(await readFile(file, 'utf8')); } catch (e) { throw new Error(`${file}: ${e.code === 'ENOENT' ? 'not found (a node needs node.yaml)' : e.message}`); }
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`${file}: must be a mapping of settings`);
  const problems = settingsProblems(node);
  if (problems.length) throw new Error(`${file}:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  const { baseUrl, iris = 'hash', languages = ['en'], title, description, publisher, license, licenseUrl, nodes, prerelease, adapters } = node;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), iris, languages, ...(title ? { title } : {}), ...(description ? { description } : {}), publisher, license, ...(licenseUrl ? { licenseUrl } : {}), ...(nodes?.length ? { nodes } : {}), ...(prerelease !== undefined ? { prerelease } : {}), ...(adapters?.length ? { adapters: [...new Set(adapters)] } : {}) };
}

/** The node in `dir`: its settings, URLs and subjects with their models, checked. Returns { node, urls, subjects }. */
export async function loadNode(dir) {
  const node = await readNode(dir);
  // English pages of their own (under /en/) when English is not the first language, as on datamodels.jp.
  const pageEn = node.languages.includes('en') && node.languages[0] !== 'en' ? (url) => url.replace(node.baseUrl, `${node.baseUrl}/en`) : null;
  const urls = catalogUrls(node.baseUrl, { iris: node.iris, pageEn });
  const modelsDir = join(dir, 'models');
  if (!(await stat(modelsDir).then((s) => s.isDirectory(), () => false))) throw new Error(`${modelsDir}: not found (the models of a node are in models/)`);
  // A context may import the contexts of the nodes this node knows, such as datamodels.jp's.
  // Compared as URLs are requested: the host in lower case, no default port (new URL().href).
  const known = (node.nodes ?? []).map((n) => new URL(`${n.url.replace(/\/+$/, '')}/context/`).href);
  const importable = (url) => { try { const href = new URL(url).href; return known.some((prefix) => href.startsWith(prefix)); } catch { return false; } };
  const subjects = await loadSubjects(modelsDir, { urls, languages: node.languages, subjectFields: ['title', 'description'], importable });
  // extends goes into catalog.json as written, so it is checked here (docs/node.md, section 3).
  for (const s of subjects) for (const m of s.models) {
    const ext = m.catalog?.extends;
    if (ext === undefined) continue;
    if (!Array.isArray(ext) || !ext.every((e) => httpUrl(e?.typeIri) && typeof e?.version === 'string' && /^\d+\.\d+\.\d+$/.test(e.version) && httpsUrl(e?.index))) {
      throw new Error(`${s.name}/${m.type}/catalog.yaml: extends must be a list of { typeIri, version: X.Y.Z, index }, typeIri an http(s) URL and index an https URL (other nodes are read only over https: change http:// to https://)`);
    }
  }
  return { node, urls, subjects };
}

/**
 * The toolkit's adapters (src/adapters/) bound to a node: { name, label, note,
 * urlFor(subject, model), content(subject, model) }, the interface
 * publishCatalog() takes. The schemas the models refer to are read first, from
 * the node or online; a model whose schemas cannot be read gets no adapter
 * files, and `notes` says why.
 */
export async function nodeAdapters(subjects, { urls, languages, fetch, timeout, offline = false, nodes = [], enabled = [] }) {
  const models = subjects.flatMap((s) => s.models.filter((m) => m.kind === 'entity'));
  // Schemas of other sites only from the nodes this node knows (node.yaml), as for @context imports.
  const { refs, problems } = await readRefs(models, { local: localRefs(subjects, urls), fetch, timeout, offline, trusted: schemaPrefixes(nodes) });
  const products = PRODUCT_ADAPTERS.filter((p) => enabled.includes(p.name));
  const notes = problems.map((p) => `no adapter files for the models that use it: ${p}`);
  // The terms of the contexts, imports included, for the product adapters that expand terms (GeonicDB):
  // only for the subjects with a model that needs them, so other builds read nothing more.
  const withTerms = products.length ? subjects.filter((s) => s.models.some((m) => m.kind === 'entity' && needsTerms(m))) : [];
  const terms = withTerms.length ? await subjectTerms(subjects, { urls, fetch, timeout, offline, only: withTerms.map((s) => s.name) }) : { terms: {}, problems: {} };
  const context = { urls, languages, refs, terms: terms.terms, termsProblems: terms.problems, warn: (text) => notes.push(text) };
  for (const [name, why] of Object.entries(terms.problems)) {
    const affected = subjects.find((s) => s.name === name)?.models.filter((m) => m.kind === 'entity' && needsTerms(m)).map((m) => m.type) ?? [];
    if (affected.length) notes.push(`no GeonicDB files for ${affected.map((t) => `${name}/${t}`).join(', ')}: the terms of the ${name} context are not known (${why})`);
  }
  const bind = (a) => ({
    name: a.name, label: a.label, note: a.note,
    urlFor: (subject, model) => (refsRead(model, refs) ? a.urlFor(subject, model, context) : null),
    content: (subject, model) => a.content(subject, model, context),
  });
  // A product adapter is turned on by the node, not part of its models: a model it cannot convert
  // (allowed terms that do not expand, its context's imports not read) gets no file and a note,
  // instead of a wrong file or a failed build. Each body is made once.
  const bindProduct = (a) => {
    const made = new Map();
    const make = (subject, model) => {
      const key = `${subject.name}/${model.type}`;
      if (!made.has(key)) {
        let content = null;
        if (model.kind === 'entity' && refsRead(model, refs) && (!needsTerms(model) || Object.hasOwn(terms.terms, subject.name))) {
          try { content = a.content(subject, model, context); } catch (e) { notes.push(`no ${a.label.en} file for ${key}: ${e.message}`); }
        }
        made.set(key, content);
      }
      return made.get(key);
    };
    return {
      name: a.name, label: a.label, note: a.note, product: true,
      urlFor: (subject, model) => (make(subject, model) === null ? null : a.urlFor(subject, model, context)),
      content: (subject, model) => make(subject, model),
    };
  };
  return { adapters: [...ADAPTERS.map(bind), ...products.map(bindProduct)], notes };
}

/**
 * The terms of each subject's @context, imports included, as a JSON-LD
 * processor resolves them (resolveContext): { terms: { subject: { term: IRI } },
 * problems: { subject: why } }. The contexts of `subjects` (current version, and
 * the alias of its major version) come from their sources; any other import is
 * read online, as `check` reads it: the imports a node's own contexts may make
 * are limited to the nodes it knows (loadNode), and what those contexts import
 * in turn is read only from public https hosts (getter). A subject whose context
 * cannot be resolved for certain has no terms. `only`: the names of the subjects
 * to resolve (default all); the others still serve as local contexts.
 */
export async function subjectTerms(subjects, { urls, fetch, timeout = 20000, offline = false, only }) {
  const { resolveContext } = await import('./check.mjs');
  const own = new Map();
  for (const s of subjects) {
    const su = urls.subjectUrls(s);
    for (const url of [su.contextExact, su.contextAlias]) own.set(url, s.context);
  }
  const local = async (url) => own.get(url);
  const getJson = getter(fetch, timeout);
  const terms = {};
  const problems = {};
  for (const s of subjects.filter((x) => !only || only.includes(x.name))) {
    try {
      const resolved = await resolveContext(s.context['@context'], getJson, { offline, local, written: true });
      if (resolved.open || resolved.uncertain.size) { problems[s.name] = resolved.notes.join('; ') || 'a context it imports was not read'; continue; }
      terms[s.name] = Object.fromEntries([...resolved.iris].filter(([, iri]) => iri));
    } catch (e) { problems[s.name] = e.message; }
  }
  return { terms, problems };
}

// Every page the toolkit writes says so: <meta name="generator" content="datamodels-toolkit <version>">.
const TOOLKIT_PAGE = /<meta name="generator" content="datamodels-toolkit[ "]/;

/**
 * Builds before 0.3.7 wrote an adapters page (/adapters/, /<lang>/adapters/);
 * datamodels.jp explains the files now. The output folder is not emptied, so a
 * page left from such a build would still be published: remove it, at the root
 * and in every folder named like a language (also one node.yaml no longer
 * lists). Only a page the toolkit wrote: any other file stays, such as a page
 * of the publisher's own or the adapters' files next to it.
 */
async function removeOldAdaptersPages(out) {
  const dirs = (await readdir(out, { withFileTypes: true })).filter((d) => d.isDirectory() && LANGUAGE_TAG.test(d.name)).map((d) => d.name);
  await Promise.all(['', ...dirs].map(async (dir) => {
    const file = join(out, dir, 'adapters', 'index.html');
    // No page there is the usual case; any other read error fails the build, or a stale page could stay published.
    const html = await readFile(file, 'utf8').catch((err) => {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return '';
      throw err;
    });
    if (TOOLKIT_PAGE.test(html)) await rm(file, { force: true });
  }));
}

/**
 * Build the node in `dir` into `out` (default `<dir>/_site`): the files of
 * publishCatalog() with the files of the toolkit's adapters, llms.txt and the
 * pages (unless `pages: false`), and `_headers` and `_redirects` for hosts
 * other than GitHub Pages (hosts.mjs). `fetch` and `timeout` read the schemas of
 * other nodes that models refer to (tests pass a stand-in); `offline` reads
 * none, and those models get no adapter files. Returns
 * { node, subjects, catalog, exactPaths, redirects, pages, notes }.
 */
export async function buildNode(dir, { out = join(dir, '_site'), now, pages: withPages = true, fetch = globalThis.fetch, timeout = 20000, offline = false, verifyReleases = true } = {}) {
  const { node, urls, subjects } = await loadNode(dir);
  // The node's title and description first, when it has them; without them catalog.json is as before.
  const head = { ...(node.title ? { title: node.title } : {}), ...(node.description ? { description: node.description } : {}), publisher: node.publisher, license: node.license, ...(node.licenseUrl ? { licenseUrl: node.licenseUrl } : {}), ...(node.nodes ? { nodes: node.nodes } : {}) };
  await mkdir(out, { recursive: true });
  await removeOldAdaptersPages(out);
  const { adapters, notes } = await nodeAdapters(subjects, { urls, languages: node.languages, fetch, timeout, offline, nodes: node.nodes, enabled: node.adapters ?? [] });
  const result = await publishCatalog(subjects, { urls, outDir: out, languages: node.languages, head, adapters, verify: verifyReleases, ...(now ? { now } : {}) });
  // English where a text has it, as in llms.txt; else the node's first language that does.
  const pickText = (o) => o?.en ?? node.languages.map((l) => o?.[l]).find(Boolean) ?? Object.values(o ?? {})[0];
  const name = pickText(node.publisher.name);
  await writeFile(join(out, 'llms.txt'), llmsTxt(subjects, { urls, name: `Data models by ${name}`, title: pickText(node.title), description: pickText(node.description), languages: node.languages }));
  const pages = withPages ? await writePages(subjects, { urls, node, out, adapters }) : [];
  await writeFile(join(out, '_headers'), headersFile());
  const redirectRules = redirectsFile(result.redirects);
  // No redirects (hash IRIs): remove the file an earlier build with slash IRIs left.
  if (redirectRules) await writeFile(join(out, '_redirects'), redirectRules);
  else await rm(join(out, '_redirects'), { force: true });
  const tooMany = redirectsNote(result.redirects.length);
  if (tooMany) notes.push(tooMany);
  return { node, subjects, ...result, pages, notes };
}
