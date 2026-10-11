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
import { publicFetch } from './net.mjs';
import csv from './csv/index.mjs';
import tableSchema from './table-schema/index.mjs';
import ai from './ai/index.mjs';
import postgis from './postgis/index.mjs';

export const ADAPTERS = [csv, tableSchema, ai, postgis];

/** A URL as fetch requests it: dot segments (also %2e%2e) resolved, so a prefix check sees the real path. */
export const normalUrl = (url) => { try { return new URL(url).href; } catch { return null; } };

/**
 * Where a redirect may lead: an https URL on a host name, not an IP address,
 * localhost or a local-only name. A node's address may redirect (w3id.org to
 * GitHub Pages), but never into the network the build runs in.
 */
export function publicUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  // A trailing dot is DNS notation for the same name (localhost. is localhost).
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return false;
  return !/(^|\.)(localhost|local|internal|home\.arpa)$/.test(host) && host.includes('.');
}

const REDIRECTS = 5;

/**
 * A reader of JSON URLs that reads each once. The first URL and every redirect
 * must be a publicUrl(); with the global fetch (the default everywhere), it
 * reads through publicFetch, which also refuses a host that resolves to a
 * private address. Tests pass a fetch of their own.
 */
export const getter = (fetchUrl, timeout) => {
  const read = !fetchUrl || fetchUrl === globalThis.fetch ? publicFetch : fetchUrl;
  const cache = new Map();
  return (url) => {
    if (!cache.has(url)) {
      cache.set(url, (async () => {
        let res;
        let at = normalUrl(url);
        if (!publicUrl(at)) throw new Error(`${url} is not read: only https on a public host name`);
        for (let hop = 0; ; hop++) {
          try { res = await read(at, { signal: AbortSignal.timeout(timeout), redirect: 'manual' }); } catch (e) { throw new Error(`${url} could not be read (${e.cause?.code ?? e.message})`); }
          const location = res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
          if (!location) break;
          const next = normalUrl(new URL(location, at).href);
          if (hop >= REDIRECTS || !publicUrl(next)) throw new Error(`${url}: redirects to ${next ?? location}, not followed (only to https on a public host name, at most ${REDIRECTS} times)`);
          at = next;
        }
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
 * decides (build skips the models that need it). Only URLs under `trusted`
 * (the schema/ folders of known nodes) are read: a $ref is written in a
 * model, and the build runs with network access, so it must not reach any
 * other address.
 */
export async function readRefs(models, { local = new Map(), entries = [], fetch: fetchUrl = globalThis.fetch, timeout = 20000, offline = false, trusted = [] } = {}) {
  const get = getter(fetchUrl, timeout);
  const refs = {};
  const problems = [];
  const urls = [...new Set(models.flatMap(refsOf))];
  for (const url of urls) {
    if (local.has(url)) { refs[url] = local.get(url); continue; }
    const href = normalUrl(url);
    if (!href || !trusted.some((prefix) => href.startsWith(prefix))) { problems.push(`${url} is not read: only the schemas of the nodes in node.yaml are (${trusted.join(', ') || 'none listed'})`); continue; }
    if (offline) { problems.push(`${url} is on another site, not read offline`); continue; }
    try {
      const schema = await get(href);
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

/** The schema/ folder of each node: the URLs readRefs may read. */
export const schemaPrefixes = (nodes = []) => nodes.filter((n) => typeof n?.url === 'string').map((n) => `${n.url.replace(/\/+$/, '')}/schema/`);

/** Whether every schema a model refers to was read. */
export const refsRead = (model, refs) => refsOf(model).every((u) => refs[u]);
