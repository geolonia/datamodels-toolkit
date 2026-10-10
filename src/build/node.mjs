// A node of the web of data models (geolonia/datamodels docs/node.md): its
// settings in node.yaml and its models in models/, built into the files the
// node publishes (#12).
//
//   baseUrl: https://models.example.org
//   iris: hash                      # or slash (needs w3id.org or a server that redirects)
//   languages: [en]
//   publisher: { name: { en: Example Inc. }, url: https://example.org/ }
//   license: CC0-1.0
//   licenseUrl: https://models.example.org/LICENSE   # optional
//   nodes:                                           # optional: other nodes this node knows
//     - { url: https://datamodels.jp/, index: https://datamodels.jp/catalog.json }
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { catalogUrls } from './urls.mjs';
import { loadSubjects } from './load.mjs';
import { publishCatalog } from './publish.mjs';
import { llmsTxt } from './llms.mjs';
import { writePages } from './pages.mjs';

const httpUrl = (s) => { try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && !!u.hostname; } catch { return false; } };
const texts = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0 && Object.values(o).every((v) => typeof v === 'string' && v.trim());

/** The settings in `<dir>/node.yaml`, checked; every problem in one error. */
export async function readNode(dir) {
  const file = join(dir, 'node.yaml');
  let node;
  try { node = YAML.parse(await readFile(file, 'utf8')); } catch (e) { throw new Error(`${file}: ${e.code === 'ENOENT' ? 'not found (a node needs node.yaml)' : e.message}`); }
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`${file}: must be a mapping of settings`);
  const problems = [];
  const { baseUrl, iris = 'hash', languages = ['en'], publisher, license, licenseUrl, nodes } = node;
  if (!httpUrl(baseUrl) || new URL(baseUrl).search || new URL(baseUrl).hash) problems.push('baseUrl must be an http(s) URL without query or fragment');
  if (!['hash', 'slash'].includes(iris)) problems.push('iris must be hash or slash');
  if (!Array.isArray(languages) || !languages.length || !languages.every((l) => typeof l === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(l))) problems.push('languages must be a list of language tags, for example [en] or [ja, en]');
  if (!texts(publisher?.name) || !httpUrl(publisher?.url)) problems.push('publisher needs a name in at least one language and an http(s) url');
  if (typeof license !== 'string' || !license.trim()) problems.push('license is required (an SPDX identifier such as CC0-1.0)');
  if (licenseUrl !== undefined && !httpUrl(licenseUrl)) problems.push('licenseUrl must be an http(s) URL');
  if (nodes !== undefined && (!Array.isArray(nodes) || !nodes.every((n) => httpUrl(n?.url) && httpUrl(n?.index)))) problems.push('nodes must be a list of { url, index }, both http(s) URLs');
  if (problems.length) throw new Error(`${file}:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  return { baseUrl: baseUrl.replace(/\/+$/, ''), iris, languages, publisher, license, ...(licenseUrl ? { licenseUrl } : {}), ...(nodes?.length ? { nodes } : {}) };
}

/**
 * Build the node in `dir` into `out` (default `<dir>/_site`): the files of
 * publishCatalog(), llms.txt and the pages. Returns { node, subjects, catalog, exactPaths, redirects, pages }.
 */
export async function buildNode(dir, { out = join(dir, '_site'), now } = {}) {
  const node = await readNode(dir);
  const urls = catalogUrls(node.baseUrl, { iris: node.iris });
  const modelsDir = join(dir, 'models');
  if (!(await stat(modelsDir).then((s) => s.isDirectory(), () => false))) throw new Error(`${modelsDir}: not found (the models of a node are in models/)`);
  // A context may import the contexts of the nodes this node knows, such as datamodels.jp's.
  const known = (node.nodes ?? []).map((n) => `${n.url.replace(/\/+$/, '')}/context/`);
  const importable = (url) => known.some((prefix) => url.startsWith(prefix));
  const subjects = await loadSubjects(modelsDir, { urls, languages: node.languages, subjectFields: ['title', 'description'], importable });
  // extends goes into catalog.json as written, so it is checked here (docs/node.md, section 3).
  for (const s of subjects) for (const m of s.models) {
    const ext = m.catalog?.extends;
    if (ext === undefined) continue;
    if (!Array.isArray(ext) || !ext.every((e) => httpUrl(e?.typeIri) && /^\d+\.\d+\.\d+$/.test(String(e?.version)) && httpUrl(e?.index))) {
      throw new Error(`${s.name}/${m.type}/catalog.yaml: extends must be a list of { typeIri, version: X.Y.Z, index }, with http(s) URLs`);
    }
  }
  const head = { publisher: node.publisher, license: node.license, ...(node.licenseUrl ? { licenseUrl: node.licenseUrl } : {}), ...(node.nodes ? { nodes: node.nodes } : {}) };
  await mkdir(out, { recursive: true });
  const result = await publishCatalog(subjects, { urls, outDir: out, languages: node.languages, head, ...(now ? { now } : {}) });
  const name = node.publisher.name.en ?? node.languages.map((l) => node.publisher.name[l]).find(Boolean) ?? Object.values(node.publisher.name)[0];
  await writeFile(join(out, 'llms.txt'), llmsTxt(subjects, { urls, name: `Data models by ${name}`, languages: node.languages }));
  const pages = await writePages(subjects, { urls, node, out });
  return { node, subjects, ...result, pages };
}
