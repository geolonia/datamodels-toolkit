// Load a models folder: <subject>/{subject.yaml, context.jsonld, <Type>/...}.
// Moved from geolonia/datamodels (scripts/lib/models.mjs, loadSubjects), with
// the folder, the base URL and the required languages as options (#10).
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';

const SEMVER = /^\d+\.\d+\.\d+$/;

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function readYaml(file) { return YAML.parse(await readFile(file, 'utf8')); }
async function isDir(p) { try { return (await stat(p)).isDirectory(); } catch { return false; } }
async function exists(p) { try { await stat(p); return true; } catch { return false; } }

/**
 * The subjects of a models folder, each with its models.
 *
 * Options:
 * - `urls`: from catalogUrls(); contexts may import the catalog's own contexts by URL.
 * - `languages`: the languages every title, summary and description needs (datamodels.jp: ja and en).
 * - `subjectFields`: the text fields a subject.yaml needs in those languages.
 * - `importable(url)`: other context URLs a subject may import (a node may import the contexts it extends).
 */
export async function loadSubjects(modelsDir, { urls, languages = ['ja', 'en'], subjectFields = ['title', 'summary', 'description'], importable = () => false } = {}) {
  const subjects = [];
  for (const name of (await readdir(modelsDir)).sort()) {
    const dir = join(modelsDir, name);
    if (!(await isDir(dir))) continue;
    const meta = await readYaml(join(dir, 'subject.yaml'));
    if (meta.name !== name) throw new Error(`${name}/subject.yaml: name "${meta.name}" does not match folder`);
    if (!SEMVER.test(meta.version)) throw new Error(`${name}/subject.yaml: version must be X.Y.Z`);
    for (const field of subjectFields) {
      for (const lang of languages) {
        if (typeof meta[field]?.[lang] !== 'string' || !meta[field][lang].trim()) throw new Error(`${name}/subject.yaml: ${field}.${lang} is required (pages are rendered in ${languages.join(' and ')})`);
      }
    }
    if (!['minted', 'profile', 'global'].includes(meta.source)) throw new Error(`${name}/subject.yaml: source must be minted, profile or global`);
    const context = await readJson(join(dir, 'context.jsonld'));
    if (!context['@context'] || typeof context['@context'] !== 'object') throw new Error(`${name}/context.jsonld: missing @context (object or array)`);
    // A context may be an array that imports other contexts by URL (for
    // example the common subject) followed by inline term definitions.
    const parts = Array.isArray(context['@context']) ? context['@context'] : [context['@context']];
    const imports = parts.filter((p) => typeof p === 'string');
    const inlineTerms = Object.assign({}, ...parts.filter((p) => p && typeof p === 'object'));
    for (const url of imports) {
      if (!url.startsWith(`${urls.baseUrl}/context/`) && !importable(url)) throw new Error(`${name}/context.jsonld: only catalog contexts may be imported by URL, got ${url}`);
    }
    const models = [];
    for (const type of (await readdir(dir)).sort()) {
      const mdir = join(dir, type);
      if (!(await isDir(mdir)) || type === 'releases') continue;
      if (!(await exists(join(mdir, 'schema.json')))) throw new Error(`${name}/${type}: a model folder needs schema.json`);
      const schema = await readJson(join(mdir, 'schema.json'));
      const catalog = await readYaml(join(mdir, 'catalog.yaml'));
      const notes = (await exists(join(mdir, 'notes.yaml'))) ? await readYaml(join(mdir, 'notes.yaml')) : {};
      // Systems that use the model; null when the file is missing.
      const adopters = (await exists(join(mdir, 'ADOPTERS.yaml'))) ? await readYaml(join(mdir, 'ADOPTERS.yaml')) : null;
      // Correspondence tables to external standards (mapping/<name>.yaml).
      const mappings = [];
      const mdirMapping = join(mdir, 'mapping');
      if (await isDir(mdirMapping)) for (const f of (await readdir(mdirMapping)).sort()) if (f.endsWith('.yaml')) mappings.push({ name: f.replace(/\.yaml$/, ''), ...(await readYaml(join(mdirMapping, f))) });
      // Known extensions by other organisations (extensions/<name>.yaml).
      const extensions = [];
      const mdirExt = join(mdir, 'extensions');
      if (await isDir(mdirExt)) for (const f of (await readdir(mdirExt)).sort()) if (f.endsWith('.yaml')) {
        // The file name is the id; fileKeys lets a validator reject a name: written in the file.
        const data = (await readYaml(join(mdirExt, f))) ?? {};
        const fileKeys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
        extensions.push({ ...data, name: f.replace(/\.yaml$/, ''), fileKeys });
      }
      const examples = {};
      for (const f of ['example.json', 'example-normalized.jsonld']) {
        const p = join(mdir, 'examples', f);
        if (await exists(p)) examples[f] = await readJson(p);
      }
      // kind: 'entity' (an NGSI-LD entity type) or 'value' (a reusable value
      // structure such as an address, referenced from entity schemas).
      const kind = schema['x-kind'] ?? 'entity';
      if (!['entity', 'value'].includes(kind)) throw new Error(`${name}/${type}/schema.json: x-kind must be entity or value`);
      models.push({ type, kind, dir: mdir, schema, catalog, notes, adopters, examples, mappings, extensions });
    }
    subjects.push({ name, dir, ...meta, context, imports, inlineTerms, models });
  }
  return subjects;
}
