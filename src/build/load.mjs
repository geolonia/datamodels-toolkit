// Load a models folder: <subject>/{subject.yaml, context.jsonld, <Type>/...}.
// Moved from geolonia/datamodels (scripts/lib/models.mjs, loadSubjects), with
// the folder, the base URL and the required languages as options (#10).
import { readFile, readdir, stat, lstat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';

const SEMVER = /^\d+\.\d+\.\d+$/;

// A file that does not parse is named in the error, from the models folder on (task/Task/examples/example.json: ...).
const reader = (parse) => async (file, base) => {
  const text = await readFile(file, 'utf8');
  try { return parse(text); } catch (e) { throw new Error(`${relative(base, file)}: ${e.message}`, { cause: e }); }
};
/** Read and parse a file of a models folder; `base` is the folder its name in an error starts from. */
export const parseJson = reader((t) => JSON.parse(t));
export const parseYaml = reader((t) => YAML.parse(t));
async function isDir(p) { try { return (await stat(p)).isDirectory(); } catch { return false; } }
async function exists(p) { try { await stat(p); return true; } catch { return false; } }

/**
 * Write a file of the node without following a symbolic link at its path, so
 * a link put there after the checks below (by another process) is not written
 * through. `create`: the file must not exist yet. O_NOFOLLOW is POSIX; where
 * it does not exist (Windows), the earlier checks are the only guard.
 */
export async function writeNoFollow(file, content, { create = false } = {}) {
  const { O_WRONLY, O_CREAT, O_EXCL, O_TRUNC, O_NOFOLLOW = 0 } = constants;
  try {
    await writeFile(file, content, { flag: O_WRONLY | O_CREAT | (create ? O_EXCL : O_TRUNC) | O_NOFOLLOW });
  } catch (e) {
    if (e.code === 'ELOOP' || (create && e.code === 'EEXIST' && (await lstat(file)).isSymbolicLink())) throw new Error(`${file} is a symbolic link, not written`, { cause: e });
    throw e;
  }
}

/**
 * Refuse symbolic links in a models folder. Mapping files and release
 * snapshots are published byte for byte, so a link would publish whatever it
 * points to, a file outside the node included, and release would write
 * through one. A node has no use for links, so none is allowed anywhere in it.
 * Walked by hand: readdir's recursive option descends into linked folders.
 */
export async function refuseLinks(modelsDir) {
  if ((await lstat(modelsDir)).isSymbolicLink()) throw new Error(`${modelsDir} is a symbolic link. A node's models folder must hold real files and folders`);
  const links = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) links.push(relative(modelsDir, p));
      else if (e.isDirectory()) await walk(p);
    }
  };
  await walk(modelsDir);
  links.sort();
  if (links.length) throw new Error(`${links.length === 1 ? 'a symbolic link' : `${links.length} symbolic links`} in ${modelsDir}: ${links.slice(0, 5).join(', ')}${links.length > 5 ? ', …' : ''}. Files there are published as they are, so the folder must hold real files and folders: replace each link with the file or folder it points to, or remove it`);
}

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
  const readJson = (file) => parseJson(file, modelsDir);
  const readYaml = (file) => parseYaml(file, modelsDir);
  await refuseLinks(modelsDir);
  const subjects = [];
  for (const name of (await readdir(modelsDir)).sort()) {
    const dir = join(modelsDir, name);
    if (!(await isDir(dir))) continue;
    // An empty subject.yaml (or one with only comments) is null: its missing name is reported below.
    const meta = (await readYaml(join(dir, 'subject.yaml'))) ?? {};
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
      // Checked as it is requested: dot segments (also %2e%2e) resolved, so a prefix check sees the real path.
      let href = null;
      try { href = new URL(url).href; } catch { /* not a URL: refused below */ }
      if (!href || (!href.startsWith(new URL(`${urls.baseUrl}/context/`).href) && !importable(href))) throw new Error(`${name}/context.jsonld: only catalog contexts may be imported by URL, got ${url}`);
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
      if (await isDir(mdirMapping)) for (const f of (await readdir(mdirMapping)).sort()) if (f.endsWith('.yaml')) {
        // The file name is the name (via and the published URL use it); fileKeys lets check reject a name: written in the file.
        const data = (await readYaml(join(mdirMapping, f))) ?? {};
        const fileKeys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
        mappings.push({ ...data, name: f.replace(/\.yaml$/, ''), fileKeys });
      }
      // Known extensions by other organisations (extensions/<name>.yaml).
      const extensions = [];
      const mdirExt = join(mdir, 'extensions');
      if (await isDir(mdirExt)) for (const f of (await readdir(mdirExt)).sort()) if (f.endsWith('.yaml')) {
        // The file name is the id; fileKeys lets a validator reject a name: written in the file.
        const data = (await readYaml(join(mdirExt, f))) ?? {};
        const fileKeys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
        extensions.push({ ...data, name: f.replace(/\.yaml$/, ''), fileKeys });
      }
      // A model has one example, in key-values and optionally normalized; other files in examples/ are not read (check notes them).
      const EXAMPLES = ['example.json', 'example-normalized.jsonld'];
      const examples = {};
      for (const f of EXAMPLES) {
        const p = join(mdir, 'examples', f);
        if (await exists(p)) examples[f] = await readJson(p);
      }
      const mdirExamples = join(mdir, 'examples');
      const unreadExamples = (await isDir(mdirExamples)) ? (await readdir(mdirExamples)).filter((f) => !EXAMPLES.includes(f) && !f.startsWith('.')).sort() : [];
      // kind: 'entity' (an NGSI-LD entity type) or 'value' (a reusable value
      // structure such as an address, referenced from entity schemas).
      const kind = schema['x-kind'] ?? 'entity';
      if (!['entity', 'value'].includes(kind)) throw new Error(`${name}/${type}/schema.json: x-kind must be entity or value`);
      models.push({ type, kind, dir: mdir, schema, catalog, notes, adopters, examples, unreadExamples, mappings, extensions });
    }
    subjects.push({ name, dir, ...meta, context, imports, inlineTerms, models });
  }
  return subjects;
}
