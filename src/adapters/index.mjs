// The adapters the toolkit has, and what they need to run: the schemas a model
// refers to, read here, so the adapters stay pure functions. build writes their
// files for every entity model (src/build/node.mjs); export writes them for one
// model (src/export.mjs).
//
// The interface is geolonia/datamodels' (adapters/README.md), with a third
// argument, `context` (src/adapters/model.mjs): an adapter only adds files, its
// output is rebuilt with the node and is not covered by the promise that
// published files never change, and model pages stay product-neutral (they
// link the node's /adapters/ page).
import { refsOf } from './model.mjs';
import csv from './csv/index.mjs';
import tableSchema from './table-schema/index.mjs';
import ai from './ai/index.mjs';
import postgis from './postgis/index.mjs';

export const ADAPTERS = [csv, tableSchema, ai, postgis];

/** A reader of JSON URLs that reads each once. */
export const getter = (fetchUrl, timeout) => {
  const cache = new Map();
  return (url) => {
    if (!cache.has(url)) {
      cache.set(url, (async () => {
        let res;
        try { res = await fetchUrl(url, { signal: AbortSignal.timeout(timeout) }); } catch (e) { throw new Error(`${url} could not be read (${e.cause?.code ?? e.message})`); }
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res.json().catch(() => { throw new Error(`${url}: not JSON`); });
      })());
    }
    return cache.get(url);
  };
};

/** Attribute texts from a catalog.json entry: { name: { lang: text } }. */
export const textsOfEntry = (entry) => Object.fromEntries((entry?.attributes ?? []).filter((a) => a?.name && a.description).map((a) => [a.name, a.description]));

/**
 * The schemas the models refer to, for context.refs: a value type of this node
 * from its sources, any other from its URL (with the texts of `entries`, the
 * models of a catalog.json, when one lists it). Returns { refs, problems }:
 * a schema that cannot be read is a problem, not an error, so the caller
 * decides (build skips the models that need it).
 */
export async function readRefs(models, { local = new Map(), entries = [], fetch: fetchUrl = globalThis.fetch, timeout = 20000 } = {}) {
  const get = getter(fetchUrl, timeout);
  const refs = {};
  const problems = [];
  const urls = [...new Set(models.flatMap(refsOf))];
  for (const url of urls) {
    if (local.has(url)) { refs[url] = local.get(url); continue; }
    try {
      const schema = await get(url);
      refs[url] = { schema, texts: textsOfEntry(entries.find((e) => e.schemaUrl === url)) };
    } catch (e) { problems.push(e.message); }
  }
  return { refs, problems };
}

/** The value types of a node's subjects by schema URL (exact and alias), for readRefs. */
export function localRefs(subjects, urls) {
  const local = new Map();
  for (const s of subjects) for (const m of s.models) {
    const mu = urls.modelUrls(s, m);
    const ref = { schema: m.schema, texts: m.catalog?.attributes ?? {} };
    local.set(mu.schemaExact, ref);
    local.set(mu.schemaAlias, ref);
  }
  return local;
}

/** Whether every schema a model refers to was read. */
export const refsRead = (model, refs) => refsOf(model).every((u) => refs[u]);
