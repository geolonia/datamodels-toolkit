// The catalog's published files: catalog.json, the schemas and the mapping
// files, read from https://datamodels.jp or from a local copy of the site (a
// directory laid out like it, such as the dist/ that geolonia/datamodels
// builds). URLs in the catalog always name https://datamodels.jp; a site
// argument only changes where they are read from.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const SITE = 'https://datamodels.jp';
export const CORE_CONTEXT_URL = 'https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.8.jsonld';

/** A reader for catalog URLs. `site` is a URL (default datamodels.jp) or a directory. */
export function siteReader(site = SITE) {
  const root = site.replace(/\/+$/, '');
  const local = !/^https?:\/\//.test(root);
  const text = async (url) => {
    if (!url.startsWith(`${SITE}/`)) throw new Error(`${url}: not a ${SITE} URL`);
    const path = url.slice(SITE.length + 1);
    if (local) {
      try { return await readFile(join(root, path), 'utf8'); } catch (e) { throw new Error(`${join(root, path)}: ${e.code ?? e.message}`); }
    }
    const res = await fetch(`${root}/${path}`);
    if (!res.ok) throw new Error(`${root}/${path}: HTTP ${res.status}`);
    return res.text();
  };
  return { text, json: async (url) => JSON.parse(await text(url)), yaml: async (url) => YAML.parse(await text(url)) };
}

/** The URL of a mapping file named the way `via` names it: subject/Type/name. */
export const mappingUrl = (name) => `${SITE}/mapping/${name}.yaml`;

/**
 * What converting into one model needs: its catalog entry, the mapping file,
 * every mapping that file reaches through `via` (by subject/Type/name), and a
 * validator for the model's schema, with the value schemas it references read
 * from the same site.
 */
export async function loadTarget(reader, target, mappingName) {
  const catalog = await reader.json(`${SITE}/catalog.json`);
  const entry = catalog.models.find((m) => `${m.subject}/${m.type}` === target);
  if (!entry) throw new Error(`no model ${target} in the catalog (has: ${catalog.models.map((m) => `${m.subject}/${m.type}`).join(', ')})`);
  const names = (entry.mappingUrls ?? []).map((u) => u.split('/').pop().replace(/\.yaml$/, ''));
  if (!names.includes(mappingName)) throw new Error(`${target} has no mapping ${mappingName} (has: ${names.join(', ') || 'none'})`);
  const mapping = await reader.yaml(mappingUrl(`${target}/${mappingName}`));
  // The mappings reached through via, each read once; the converter reports a cycle.
  const mappings = {};
  const pending = [mapping];
  while (pending.length) {
    for (const rule of Object.values(pending.pop().fields ?? {})) {
      if (!rule?.via || rule.via in mappings) continue;
      mappings[rule.via] = await reader.yaml(mappingUrl(rule.via));
      pending.push(mappings[rule.via]);
    }
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false, loadSchema: (uri) => reader.json(uri) });
  addFormats(ajv);
  const schema = await reader.json(entry.schemaUrl);
  const validate = await ajv.compileAsync(schema);
  return { entry, schema, mapping, mappings, validate, errorsText: (errors) => ajv.errorsText(errors) };
}
