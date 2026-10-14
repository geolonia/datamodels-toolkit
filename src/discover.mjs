// datamodels nodes and datamodels search (geolonia/datamodels#222): the nodes
// reachable from one index, and the models in them that match some words.
//
// A node's catalog.json lists the nodes it knows (`nodes`) and, for each model
// built on another node's model, the index it comes from (`extends`). Starting
// at one index (default datamodels.jp), these links are followed up to a depth.
// Each index is read once, so a cycle ends. Every read goes through the
// adapters' getter: https only, a public host name, checked again on every
// redirect and when connecting (src/adapters/net.mjs). A node that cannot be
// read is a note, never a failure, except the index the search starts at.
import { getter, normalUrl } from './adapters/index.mjs';

export const DEFAULT_INDEX = 'https://datamodels.jp/catalog.json';
// Limits, so a long chain of links or a large network cannot keep the command busy.
export const MAX_DEPTH = 5;
export const MAX_NODES = 50;

/**
 * The index URL for what is given: a catalog.json, or the address of a node
 * (its index is always at <address>/catalog.json, docs/node.md section 5).
 */
export function indexUrl(given) {
  let u;
  try { u = new URL(given); } catch { throw new Error(`${given}: not a URL`); }
  if (/\.json$/i.test(u.pathname)) return u.href;
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return new URL('catalog.json', u).href;
}

/**
 * An index as it is read: absolute, normalized, without a #fragment (a fragment
 * is not sent with a request, so catalog.json#a and catalog.json are one index).
 */
function indexKey(url, base) {
  const u = new URL(url, base);
  u.hash = '';
  return normalUrl(u.href);
}

/**
 * The indexes a catalog links to: its `nodes`, and the `extends` of its models,
 * as { index, url }. A listed node keeps the address it declares (`url`, which
 * may differ from where its index is, such as a CDN); for the others `url` is null.
 */
function linksOf(catalog, base) {
  const out = [];
  const add = (index, url = null) => {
    if (typeof index !== 'string') return;
    let key;
    try { key = indexKey(index, base); } catch { return; /* not a URL: nothing to follow */ }
    let address = null;
    try { const u = typeof url === 'string' ? new URL(url) : null; if (u?.protocol === 'https:') address = u.href; } catch { /* not a URL: derived from the index */ }
    out.push({ index: key, url: address });
  };
  for (const n of Array.isArray(catalog.nodes) ? catalog.nodes : []) add(n?.index, n?.url);
  for (const m of catalog.models) for (const e of Array.isArray(m?.extends) ? m.extends : []) add(e?.index);
  return out;
}

/** A text of a catalog in English or else its first language that has one, or null. */
function textOf(texts) {
  const text = texts && typeof texts === 'object' ? [texts.en, ...Object.values(texts)].find((v) => typeof v === 'string' && v.trim()) : null;
  return text ?? null;
}

/** A node's name: its publisher in English or its first language, else its host. */
function nameOf(catalog, url) {
  return textOf(catalog.publisher?.name) ?? new URL(url).host;
}

/**
 * The nodes reachable from `index` within `depth` links (0: the index alone).
 * Returns { nodes: [{ name, title, url, index, license, depth, linkedFrom, catalog }], notes }:
 * nodes in the order they were reached (`title`: the node's own title, null when
 * its catalog.json has none), notes for what could not be read or
 * was left out. Throws when `index` itself cannot be read.
 * Options: `fetch` (tests pass a stub), `timeout` per request in milliseconds.
 */
export async function discoverNodes(index = DEFAULT_INDEX, { depth = 1, fetch: fetchUrl = globalThis.fetch, timeout = 15000 } = {}) {
  const get = getter(fetchUrl, timeout);
  const start = indexKey(indexUrl(index));
  const seen = new Set([start]);
  const nodes = [], notes = [];
  let level = [{ index: start, url: null, linkedFrom: null }];
  for (let d = 0; level.length; d++) {
    const read = await Promise.all(level.map((n) => get(n.index).then((catalog) => ({ ...n, catalog }), (e) => ({ ...n, error: e.message }))));
    const next = [];
    for (const r of read) {
      const problem = r.error ?? (Array.isArray(r.catalog?.models) ? null : `${r.index}: not a catalog.json (no models list)`);
      if (problem && d === 0) throw new Error(problem);
      if (problem) { notes.push(`${problem}; linked from ${r.linkedFrom}, skipped`); continue; }
      const url = r.url ?? new URL('.', r.index).href;
      nodes.push({ name: nameOf(r.catalog, url), title: textOf(r.catalog.title), url, index: r.index, license: typeof r.catalog.license === 'string' ? r.catalog.license : null, depth: d, linkedFrom: r.linkedFrom, catalog: r.catalog });
      if (d >= depth) continue;
      for (const link of linksOf(r.catalog, r.index)) {
        if (seen.has(link.index)) continue;
        seen.add(link.index);
        if (seen.size > MAX_NODES) { notes.push(`${link.index}: not read, more than ${MAX_NODES} indexes`); continue; }
        next.push({ ...link, linkedFrom: r.index });
      }
    }
    level = next;
  }
  return { nodes, notes };
}

// The words of a text, and the score of a model for them: copied from
// geolonia/datamodels scripts/lib/similar.mjs (#224), which finds similar
// models for a model proposal. Keep the two the same until geolonia/datamodels#226
// leaves one copy, in this toolkit.

// Words too common to tell models apart.
const STOP = new Set(('the and for with from that this which one each are is was were has have had not but its into per any all can may when where what who how also other than then them they their there these those such only more most some same both own over under about after before between while within without data model models record records type types entity entities attribute attributes value values name names field fields list item items new use used using example examples based like etc via eg ie').split(' '));

/** The words of a text: Latin words (camelCase split, lower case, 3+ letters, no stop words) and, for Japanese, pairs of characters that contain a kanji or katakana. */
export function words(text) {
  const out = new Set();
  const s = String(text ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  // A plural is made singular: roads → road, facilities → facility; not status, process,
  // analysis, or words whose -ies is not a plural (series, species).
  for (const w of s.toLowerCase().match(/[a-z]{3,}/g) ?? []) if (!STOP.has(w)) out.add(singular(w));
  for (const run of s.match(/[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}ー]+/gu) ?? []) {
    const chars = [...run];
    for (let i = 0; i + 1 < chars.length; i++) {
      const pair = chars[i] + chars[i + 1];
      if (/[\p{Script=Han}\p{Script=Katakana}]/u.test(pair)) out.add(pair);
    }
  }
  return out;
}

const NOT_PLURAL_IES = new Set(['series', 'species', 'movies', 'cookies', 'pies', 'ties', 'lies']);
const singular = (w) => (NOT_PLURAL_IES.has(w) ? w
  : w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y`
  : w.length > 4 && /[^sui]s$/.test(w) ? w.slice(0, -1) : w);

const texts = (o) => (o && typeof o === 'object' ? Object.values(o).filter((v) => typeof v === 'string') : []);
const str = (v) => (typeof v === 'string' ? v : null);

/**
 * The models of the nodes, with the words each one has: a word counts most in
 * the type name, then the title, the attribute names, the descriptions (the
 * model's and its attributes'). Value types are included: an address or a
 * geometry is worth reusing too.
 */
function modelIndex(nodes) {
  const entries = [];
  for (const node of nodes) for (const m of node.catalog.models) {
    if (typeof m?.type !== 'string') continue;
    const terms = new Map();
    const put = (text, weight) => { for (const w of words(text)) terms.set(w, Math.max(terms.get(w) ?? 0, weight)); };
    put(m.type, 4);
    for (const t of texts(m.title)) put(t, 3);
    const attributes = Array.isArray(m.attributes) ? m.attributes : [];
    for (const a of attributes) put(a?.name, 2);
    for (const t of texts(m.description)) put(t, 1);
    for (const a of attributes) for (const t of texts(a?.description)) put(t, 1);
    entries.push({
      model: {
        type: m.type, subject: str(m.subject), kind: str(m.kind) ?? 'entity', title: m.title && typeof m.title === 'object' ? m.title : {},
        typeIri: str(m.typeIri), version: str(m.version), pageUrl: str(m.pageUrl), schemaUrl: str(m.schemaUrl), contextUrl: str(m.contextUrl),
        site: node.name, siteTitle: node.title ?? null, nodeUrl: node.url, index: node.index,
      },
      terms,
    });
  }
  return entries;
}

/**
 * The models of `nodes` (discoverNodes) that match the words of `query`, best
 * first: [{ ...model, score, matched }]. Each matched word scores its weight
 * in the model, times how rare it is across all the models.
 * Returns { results, total }: at most `limit` results, and how many matched.
 */
export function searchModels(query, nodes, { limit = 10 } = {}) {
  const asked = words(query);
  const index = modelIndex(nodes);
  const df = new Map();
  for (const e of index) for (const w of e.terms.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const n = index.length || 1;
  const all = index.map(({ model, terms }) => {
    let score = 0; const matched = [];
    for (const w of asked) {
      const weight = terms.get(w);
      if (!weight) continue;
      score += weight * (1 + Math.log(n / df.get(w)));
      matched.push(w);
    }
    return { ...model, score: Math.round(score * 100) / 100, matched };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.site.localeCompare(b.site));
  return { results: all.slice(0, limit), total: all.length };
}

/**
 * Text from another site, for a terminal: no control characters (an escape
 * sequence could rewrite the screen) or direction overrides, one line, not too long.
 */
export const plain = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
