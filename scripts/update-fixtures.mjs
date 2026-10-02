// Refresh test/fixtures/site/ from https://datamodels.jp: catalog.json and every
// file that converting with the mappings below reads (schemas, mapping files).
// Run after the catalog changes a model or mapping the tests use.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { siteReader, loadTarget, SITE } from '../src/catalog.mjs';

export const TARGETS = [
  ['disaster/EvacuationSite', 'jichitai-opendata-site'],
  ['disaster/EvacuationSite', 'gsi-emergency-site'],
  ['disaster/DesignatedShelter', 'gsi-designated-shelter'],
];
const out = join(import.meta.dirname, '..', 'test', 'fixtures', 'site');
const live = siteReader(SITE);
const seen = new Map();
// Records every file read, as the site serves it.
const text = async (url) => { if (!seen.has(url)) seen.set(url, await live.text(url)); return seen.get(url); };
const recording = { text, json: async (u) => JSON.parse(await text(u)), yaml: async (u) => (await import('yaml')).default.parse(await text(u)) };
for (const [target, mapping] of TARGETS) await loadTarget(recording, target, mapping);
for (const [url, body] of seen) {
  const file = join(out, url.slice(SITE.length + 1));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
}
console.log(`wrote ${seen.size} file(s) to ${out}`);
