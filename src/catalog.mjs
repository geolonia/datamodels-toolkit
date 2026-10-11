// The catalog's published files: catalog.json, the schemas and the mapping
// files, read from https://datamodels.jp or from a local copy of the site (a
// directory laid out like it, such as the dist/ that geolonia/datamodels
// builds). URLs in the catalog always name https://datamodels.jp; a site
// argument only changes where they are read from.
import { readFile } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import YAML from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const SITE = 'https://datamodels.jp';
export const CORE_CONTEXT_URL = 'https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.8.jsonld';

/** A reader for catalog URLs. `site` is a URL (default datamodels.jp) or a directory. */
export function siteReader(site = SITE) {
  const root = site.replace(/(.)\/+$/, '$1');
  const local = !/^https?:\/\//.test(root);
  // Each file is read once: mapping, check and convert may ask for the same catalog.json and schemas.
  const cache = new Map();
  const text = (url) => {
    if (!cache.has(url)) cache.set(url, read(url));
    return cache.get(url);
  };
  const read = async (url) => {
    // Parsed, so dot segments (/../) are resolved before the origin is checked.
    let u;
    try { u = new URL(url); } catch { throw new Error(`${url}: not a URL`); }
    if (u.origin !== SITE) throw new Error(`${url}: not a ${SITE} URL`);
    if (local) {
      // An encoded slash (%2F) can still climb after decoding: the file must stay inside the site directory.
      const base = resolve(root);
      let path;
      try { path = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch { throw new Error(`${url}: malformed path`); }
      const file = resolve(base, path);
      if (!file.startsWith(base + sep)) throw new Error(`${url}: outside the site directory ${base}`);
      try { return await readFile(file, 'utf8'); } catch (e) { throw new Error(`${file}: ${e.code ?? e.message}`); }
    }
    const res = await fetch(`${root}${u.pathname}`);
    if (!res.ok) throw new Error(`${root}${u.pathname}: HTTP ${res.status}`);
    return res.text();
  };
  return { text, json: async (url) => JSON.parse(await text(url)), yaml: async (url) => YAML.parse(await text(url)) };
}

/** The URL of a mapping file named the way `via` names it: subject/Type/name. */
export const mappingUrl = (name) => `${SITE}/mapping/${name}.yaml`;

/** The mapping argument names a file of your own (./my-list.yaml), not one of the catalog's mappings. */
export const isMappingFile = (name) => /[\\/]/.test(name) || /\.ya?ml$/i.test(name);
/** A via in a file of your own that names another file, relative to it (address.yaml, ../common/address.yml). */
export const isViaFile = (via) => /\.ya?ml$/i.test(via);

/**
 * A mapping file of your own: the parsed YAML and its TODO comments ("# TODO:"),
 * which `datamodels mapping` writes where it found no column ({ line, text }).
 */
export async function readMappingFile(path) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (e) { throw new Error(`${path}: ${e.code ?? e.message}`); }
  let mapping;
  try { mapping = YAML.parse(text); } catch (e) { throw new Error(`${path}: not valid YAML: ${e.message.split('\n')[0]}`); }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error(`${path}: not a mapping file (it needs fields:)`);
  const todos = text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t.trim() })).filter((l) => /#\s*TODO[:：]/.test(l.text));
  return { mapping, todos };
}

/**
 * What converting into one model needs: its catalog entry, the mapping file,
 * every mapping that file reaches through `via` (by subject/Type/name), and a
 * validator for the model's schema, with the value schemas it references read
 * from the same site.
 *
 * `mappingName` is one of the model's mappings in the catalog, or the path of
 * a mapping file of your own (isMappingFile). A file of your own may name
 * other files in `via` (isViaFile), relative to its own folder; they are
 * listed in `mappings` under their path from the current directory (their
 * full path outside it), and the via is rewritten to it. A catalog mapping never reads a local file.
 * `options.mapping` gives the mapping itself (the CSV template's rules).
 * Returns also the TODO comments of the local files read: `todos` ({ file, line, text }).
 */
export async function loadTarget(reader, target, mappingName, options = {}) {
  const catalog = await reader.json(`${SITE}/catalog.json`);
  const entry = catalog.models.find((m) => `${m.subject}/${m.type}` === target);
  if (!entry) throw new Error(`no model ${target} in the catalog (has: ${catalog.models.map((m) => `${m.subject}/${m.type}`).join(', ')})`);
  // Each local file is read once, also when vias lead back to it.
  const todos = [], read = new Map();
  const local = async (path) => {
    if (!read.has(resolve(path))) { const r = await readMappingFile(path); todos.push(...r.todos.map((t) => ({ file: path, ...t }))); read.set(resolve(path), r.mapping); }
    return read.get(resolve(path));
  };
  let mapping, file;
  if (options.mapping) mapping = options.mapping;
  else if (isMappingFile(mappingName)) { file = mappingName; mapping = await local(file); }
  else {
    const names = (entry.mappingUrls ?? []).map((u) => u.split('/').pop().replace(/\.yaml$/, ''));
    if (!names.includes(mappingName)) throw new Error(`${target} has no mapping ${mappingName} (has: ${names.join(', ') || 'none'})`);
    mapping = await reader.yaml(mappingUrl(`${target}/${mappingName}`));
  }
  // The mappings reached through via, each read once; the converter reports a cycle.
  // from: the path of a local mapping file, whose file vias are read relative to it.
  // done: the mappings whose vias were followed, so a file's vias are rewritten only once.
  const mappings = {}, done = new Set();
  const pending = [[mapping, file]];
  while (pending.length) {
    const [map, from] = pending.pop();
    if (done.has(map) || !map?.fields || typeof map.fields !== 'object') continue;
    done.add(map);
    for (const rule of Object.values(map.fields)) {
      if (typeof rule?.via !== 'string') continue;
      if (from && isViaFile(rule.via)) {
        // Named from the current directory when it is below it, else by its full path.
        const path = resolve(dirname(from), rule.via);
        rule.via = relative('.', path).startsWith('..') ? path : relative('.', path);
        if (rule.via in mappings) continue;
        mappings[rule.via] = await local(rule.via);
        pending.push([mappings[rule.via], rule.via]);
        continue;
      }
      if (rule.via in mappings) continue;
      mappings[rule.via] = await reader.yaml(mappingUrl(rule.via));
      pending.push([mappings[rule.via], undefined]);
    }
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false, loadSchema: (uri) => reader.json(uri) });
  addFormats(ajv);
  const schema = await reader.json(entry.schemaUrl);
  const validate = await ajv.compileAsync(schema);
  return { entry, schema, mapping, mappings, validate, errorsText: (errors) => ajv.errorsText(errors), todos };
}
