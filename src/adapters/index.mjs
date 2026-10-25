// The adapters the toolkit has, and what they need to run: the schemas a model
// refers to, read here, so the adapters stay pure functions. build writes their
// files for every entity model (src/build/node.mjs); export writes them for one
// model (src/export.mjs).
//
// The interface is geolonia/datamodels' (adapters/README.md), with a third
// argument, `context` (src/adapters/model.mjs): an adapter only adds files, its
// output is rebuilt with the node and is not covered by the promise that
// published files never change, and model pages stay product-neutral (they
// link datamodels.jp's explanation of the files).
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
 * An error for a URL that is not read because of where it is. `refused` says why:
 * 'url' (the URL as given: not https, an IP address, localhost, a user name),
 * 'redirect' (it redirects to such a URL, or too often) or 'address' (its host
 * name resolves to a private address). A host that is down has no `refused`.
 */
const refusal = (message, refused, options) => Object.assign(new Error(message, options), { refused });

/**
 * The error for a read that failed (getter and bytesReader share it, so they
 * agree on what is refused and what is down): a timeout of the whole read; a
 * host that resolves to a private address (publicFetch's ENOTPUBLIC) is
 * refused, not down; otherwise "could not be read", with an error code
 * (ENOTFOUND) kept as the cause for callers that show only the code (check).
 */
function readError(url, e, signal, timeout) {
  if (signal.aborted) return new Error(`${url} could not be read (timed out after ${timeout / 1000} s)`);
  const code = [e?.cause?.code, e?.code].find((c) => typeof c === 'string');
  const options = code ? { cause: typeof e.cause?.code === 'string' ? e.cause : e } : undefined;
  if (code === 'ENOTPUBLIC') return refusal(`${url} is not read: ${e.message}`, 'address', options);
  return new Error(`${url} could not be read (${code ?? e.message})`, options);
}

/** The next URL of a redirect, or a refusal: only to a publicUrl(), at most REDIRECTS times. */
function redirectTarget(url, location, at, hop) {
  const next = normalUrl(new URL(location, at).href);
  if (hop >= REDIRECTS || !publicUrl(next)) throw refusal(`${url}: redirects to ${next ?? location}, not followed (only to https on a public host name, at most ${REDIRECTS} times)`, 'redirect');
  return next;
}

/**
 * A reader of a published file's bytes, for the comparisons of check and
 * release: { status, ok, body } (body a Buffer when ok). The same rules as
 * getter(): the URL and every redirect must be a publicUrl(), at most
 * REDIRECTS of them, and with the global fetch it reads through publicFetch,
 * so a node's baseUrl or a redirect cannot point the read at a private or
 * loopback address. `timeout` (ms) covers the whole read.
 */
export const bytesReader = (fetchUrl, timeout = 20000) => {
  const read = !fetchUrl || fetchUrl === globalThis.fetch ? publicFetch : fetchUrl;
  return async (url) => {
    let at = normalUrl(url);
    if (!publicUrl(at)) throw refusal(`${url} is not read: only https on a public host name`, 'url');
    const signal = AbortSignal.timeout(timeout);
    for (let hop = 0; ; hop++) {
      let res;
      try { res = await read(at, { signal, redirect: 'manual' }); } catch (e) { throw readError(url, e, signal, timeout); }
      const location = res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
      if (location) { at = redirectTarget(url, location, at, hop); continue; }
      // The body too: a server can send its headers and then stall or break off.
      let body = null;
      if (res.ok) {
        try { body = Buffer.from(await res.arrayBuffer()); } catch (e) { throw readError(url, e, signal, timeout); }
      }
      return { status: res.status, ok: res.ok, body };
    }
  };
};

/**
 * A reader of JSON URLs that reads each once. The first URL and every redirect
 * must be a publicUrl(); with the global fetch (the default everywhere), it
 * reads through publicFetch, which also refuses a host that resolves to a
 * private address. Tests pass a fetch of their own.
 * `timeout` (ms) is for the whole read of a URL, its redirects included.
 * `under` (a URL prefix, or a list of them): every redirect must stay under it,
 * so a read limited to a node's schema/ or examples/ cannot be taken elsewhere.
 * An error for a URL that is not read because of where it is has `refused` (see refusal()).
 */
export const getter = (fetchUrl, timeout = 20000) => {
  const read = !fetchUrl || fetchUrl === globalThis.fetch ? publicFetch : fetchUrl;
  const cache = new Map();
  return (url, { under } = {}) => {
    const prefixes = under === undefined ? null : [under].flat();
    const key = `${prefixes?.join(' ') ?? ''}\n${url}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        let res;
        let at = normalUrl(url);
        if (!publicUrl(at)) throw refusal(`${url} is not read: only https on a public host name`, 'url');
        // One deadline for the read, so a chain of redirects cannot make it longer.
        const signal = AbortSignal.timeout(timeout);
        for (let hop = 0; ; hop++) {
          try { res = await read(at, { signal, redirect: 'manual' }); } catch (e) { throw readError(url, e, signal, timeout); }
          const location = res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
          if (!location) break;
          const next = redirectTarget(url, location, at, hop);
          if (prefixes && !prefixes.some((p) => next.startsWith(p))) throw refusal(`${url}: redirects to ${next}, not followed (only under ${prefixes.join(', ')})`, 'redirect');
          at = next;
        }
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res.json().catch(() => { throw new Error(`${url}: not JSON`); });
      })());
    }
    return cache.get(key);
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
      const schema = await get(href, { under: trusted });
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
