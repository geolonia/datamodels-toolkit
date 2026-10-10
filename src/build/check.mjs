// The checks a node runs in CI before it publishes (#12): its schemas and
// examples are valid, every type and attribute is a term of its @context with
// the same IRI (#26), its release snapshots match the sources, an exact
// version already online did not change, and no model redefines a term of a
// model it extends. Other nodes that cannot be reached are noted and skipped:
// a node that is down never fails someone else's build (docs/node.md, section 5).
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildNode } from './node.mjs';
import { catalogUrls, attributesOf } from './urls.mjs';

// A schema on another site that could not be read: noted and skipped, never a problem of this node.
class Unavailable extends Error {}

// The NGSI-LD core context (v1.8): every broker knows its terms (location,
// observedAt, …) without a node defining them, and they cannot be redefined.
const CORE_CONTEXT = JSON.parse(readFileSync(new URL('./ngsi-ld-core-context-v1.8.jsonld', import.meta.url), 'utf8'))['@context'];

/** The term definitions of an @context (object or array; imported URLs are not followed). */
export function contextDefs(context) {
  return Object.assign({}, ...(Array.isArray(context) ? context : [context]).filter((p) => p && typeof p === 'object'));
}

/**
 * The terms of an @context with their full IRIs. `inherited`: definitions of
 * a context it imports, for prefixes it uses but does not define itself.
 */
export function contextTerms(context, inherited = {}) {
  const own = contextDefs(context);
  const defs = { ...inherited, ...own };
  const raw = (v) => (typeof v === 'string' ? v : v?.['@id']);
  const expand = (iri) => {
    if (typeof iri !== 'string') return undefined;
    const i = iri.indexOf(':');
    const prefix = i > 0 ? raw(defs[iri.slice(0, i)]) : undefined;
    return prefix && !iri.slice(i + 1).startsWith('//') ? prefix + iri.slice(i + 1) : iri;
  };
  return new Map(Object.keys(own).filter((k) => !k.startsWith('@')).map((k) => [k, expand(raw(defs[k]))]).filter(([, v]) => v));
}

const FULL_IRI = /^(https?|urn):/;

/**
 * Resolve an @context as a JSON-LD processor does: its parts in order, each
 * against the definitions so far. An inline object adds or replaces terms
 * (a term mapped to null is removed), null clears everything before it, and
 * a context imported by URL is processed the same way in place, with its own
 * imports (datamodels.jp's subject contexts import its common one). A URL may
 * come again later and applies again; only an import of itself is refused.
 *
 * An import that cannot be read (or is not read: `offline`) leaves the
 * outcome open: what came before may be overridden, and any term may come
 * from it. Returns { defs, uncertain, open, notes }: the definitions, the
 * terms whose final mapping is unknown, whether an unread import may define
 * terms not seen, and what could not be read.
 */
export async function resolveContext(context, getJson, { offline = false } = {}) {
  const state = { defs: {}, uncertain: new Set(), open: false, notes: [] };
  const docs = new Map();
  const walk = async (ctx, stack) => {
    for (const part of [ctx].flat()) {
      if (part === null) { state.defs = {}; state.uncertain.clear(); state.open = false; continue; }
      if (typeof part === 'object') {
        for (const [k, v] of Object.entries(part)) { state.defs[k] = v; state.uncertain.delete(k); }
        continue;
      }
      if (typeof part !== 'string') continue;
      if (stack.includes(part)) throw new Error(`${part} imports itself (${[...stack, part].join(' → ')})`);
      let theirs;
      if (!offline) {
        try {
          if (!docs.has(part)) docs.set(part, getJson(part));
          theirs = (await docs.get(part))?.['@context'];
          if (theirs === undefined) throw new Error('no @context');
        } catch (e) { state.notes.push(`${part} could not be read (${e.cause?.code ?? e.message})`); theirs = undefined; }
      }
      if (theirs === undefined) {
        // Anything before may be overridden, and any term may come from it.
        for (const k of Object.keys(state.defs)) state.uncertain.add(k);
        state.open = true;
        continue;
      }
      await walk(theirs, [...stack, part]);
    }
  };
  await walk(context, []);
  return state;
}

/** The IRI a resolved context gives a term: { iri } (null when it removes the term), or undefined when it does not define it. */
function lookup(defs, term) {
  if (!Object.hasOwn(defs, term)) return undefined;
  if (defs[term] === null || defs[term]?.['@id'] === null) return { iri: null };
  return { iri: contextTerms(defs).get(term) ?? null };
}

/**
 * Every type and attribute of a subject's models is a term of its @context and
 * expands to the model's IRI for it: otherwise JSON-LD drops the attribute, or
 * gives it another meaning than the schema and the pages say. `resolved`: the
 * subject's @context from resolveContext. A finding that an unread import
 * could change is only noted. Returns { problems, notes }.
 */
export function termProblems(subject, urls, resolved) {
  const problems = [];
  const notes = [];
  const { defs, uncertain, open } = resolved;
  const core = contextTerms(CORE_CONTEXT);
  const ctx = `${subject.name}/context.jsonld`;
  const unsure = ', or a context it imports that could not be read may change that';
  const report = (term, text) => (uncertain.has(term) ? notes.push(`${text}${unsure}`) : problems.push(text));
  // The core terms keep their IRIs, whoever redefines them.
  for (const [term, iri] of core) {
    const found = lookup(defs, term);
    if (found && found.iri !== iri) report(term, `${ctx}: ${found.iri === null ? 'removes' : 'redefines'} the NGSI-LD core term ${term} (${iri})`);
  }
  const check = (where, name, what, expected) => {
    const found = lookup(defs, name) ?? (core.has(name) ? { iri: core.get(name) } : undefined);
    if (!found || found.iri === null) {
      if (open && !found) notes.push(`${where}: ${what} is not in the @context${unsure}`);
      else report(name, `${where}: ${what} is not in the @context`);
    } else if (!FULL_IRI.test(found.iri)) {
      if (open || uncertain.has(name)) notes.push(`${where}: the @context maps ${name} to ${found.iri}, which is not a full IRI (is its prefix defined?)${unsure}`);
      else problems.push(`${where}: the @context maps ${name} to ${found.iri}, which is not a full IRI (is its prefix defined?)`);
    } else if (found.iri !== expected) report(name, `${where}: ${name} is ${expected ?? '(no x-iri)'} in the schema, but the @context expands it to ${found.iri}`);
  };
  for (const m of subject.models) {
    const where = `${subject.name}/${m.type}`;
    if (m.kind === 'entity') check(where, m.type, `the type ${m.type}`, urls.modelUrls(subject, m).typeIri);
    for (const [name, prop] of attributesOf(m)) check(where, name, `the attribute ${name}`, prop?.['x-iri']);
  }
  return { problems, notes };
}

/**
 * Check the node in `dir`. Options: `offline` skips what needs the network
 * (the published files, the models it extends, schemas on other sites);
 * `fetch` for tests; `timeout` per request in ms. Returns { problems, notes }: any problem fails the check.
 */
export async function checkNode(dir, { offline = false, fetch: fetchUrl = globalThis.fetch, timeout = 20000 } = {}) {
  // A node that hangs is treated like one that is down: noted, not waited for.
  const fetch = (url) => fetchUrl(url, { signal: AbortSignal.timeout(timeout) });
  const problems = [];
  const notes = [];
  const out = await mkdtemp(join(tmpdir(), 'datamodels-check-'));
  try {
    // The build also stops on a release snapshot (models/<subject>/releases/vX.Y.Z/) that differs from the sources.
    let built;
    try { built = await buildNode(dir, { out, pages: false }); } catch (e) { return { problems: [e.message], notes }; }
    const { node, subjects, exactPaths } = built;
    const urls = catalogUrls(node.baseUrl, { iris: node.iris });
    const getJson = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.json();
    };

    // Schemas and examples. A schema of this node is read from the build; one on another site only online.
    const ajv = new Ajv2020({ allErrors: true, strict: false, loadSchema: async (uri) => {
      if (uri.startsWith(`${urls.baseUrl}/`)) return JSON.parse(await readFile(join(out, uri.slice(urls.baseUrl.length + 1)), 'utf8'));
      if (offline) throw new Unavailable(`${uri} is on another site, not read with --offline`);
      try { return await getJson(uri); } catch (e) { throw new Unavailable(`${uri} could not be read (${e.cause?.code ?? e.message})`); }
    } });
    addFormats(ajv);
    for (const s of subjects) for (const m of s.models) {
      const where = `${s.name}/${m.type}`;
      let validate;
      // A schema another one referenced is already loaded (from the build, the same bytes): use it.
      try { validate = (m.schema.$id && ajv.getSchema(m.schema.$id)) || await ajv.compileAsync(m.schema); } catch (e) {
        if (e instanceof Unavailable) notes.push(`${where}/schema.json: not validated, ${e.message}`); else problems.push(`${where}/schema.json: ${e.message}`);
        continue;
      }
      if (m.examples['example.json'] && !validate(m.examples['example.json'])) problems.push(`${where}/examples/example.json: ${ajv.errorsText(validate.errors)}`);
    }

    // Types and attributes against the @context; contexts it imports by URL are read online only.
    const resolvedBySubject = new Map();
    for (const s of subjects) {
      let resolved;
      try { resolved = await resolveContext(s.context['@context'], getJson, { offline }); } catch (e) { problems.push(`${s.name}/context.jsonld: ${e.message}`); continue; }
      resolvedBySubject.set(s.name, resolved);
      notes.push(...resolved.notes.map((n) => `${s.name}/context.jsonld: ${n}`));
      const found = termProblems(s, urls, resolved);
      problems.push(...found.problems);
      notes.push(...found.notes);
    }

    if (offline) { notes.push('offline: the published files and the models this node extends were not checked'); return { problems, notes }; }

    // An exact version that is already online must be served unchanged; one that is not online yet is new.
    for (const path of exactPaths) {
      const url = `${urls.baseUrl}${path}`;
      let online;
      try {
        const res = await fetch(url);
        if (res.status === 404) continue;
        if (!res.ok) { notes.push(`${url}: HTTP ${res.status}, not compared`); continue; }
        // The body too: a server can send its headers and then stall or break off.
        online = Buffer.from(await res.arrayBuffer());
      } catch (e) { notes.push(`${url}: not reachable (${e.cause?.code ?? e.message}), not compared`); continue; }
      if (!online.equals(await readFile(join(out, path.slice(1))))) problems.push(`${url}: a published version changed. A published file never changes; give the subject a new version instead.`);
    }

    // Terms of an extended model keep their IRIs here.
    const indexes = new Map();
    for (const s of subjects) {
      for (const m of s.models) for (const ext of m.catalog?.extends ?? []) {
        const where = `${s.name}/${m.type}: extends ${ext.typeIri} v${ext.version}`;
        try {
          if (!indexes.has(ext.index)) indexes.set(ext.index, getJson(ext.index));
          const index = await indexes.get(ext.index);
          const entry = (index.models ?? []).find((e) => e.typeIri === ext.typeIri);
          if (!entry) { problems.push(`${where}: not listed in ${ext.index}`); continue; }
          // An index lists the current version; an older one is at the same path with its own version (docs/node.md, section 1).
          const contextUrl = entry.version === ext.version ? entry.contextUrl : entry.contextUrl.replace(`/v${entry.version}.jsonld`, `/v${ext.version}.jsonld`);
          if (contextUrl === entry.contextUrl && entry.version !== ext.version) { notes.push(`${where}: not checked, ${ext.index} lists v${entry.version} and the @context of v${ext.version} could not be found`); continue; }
          const theirContext = (await getJson(contextUrl))?.['@context'];
          // A context file without @context would make every term look new, so nothing could be compared.
          if (theirContext == null) { problems.push(`${where}: ${contextUrl} has no @context`); continue; }
          if (typeof theirContext !== 'object') { notes.push(`${where}: not checked, the @context of ${contextUrl} only imports another one`); continue; }
          // Its terms, with those of the contexts it imports (datamodels.jp's common one, say).
          const their = await resolveContext(theirContext, getJson);
          if (their.notes.length) { notes.push(`${where}: not checked, ${their.notes.join('; ')}`); continue; }
          const theirs = contextTerms(their.defs);
          // This subject's terms as they end up, its own imports included. A term the term
          // check already reports (not a full IRI) or that an unread import may change is left out.
          const mine = resolvedBySubject.get(s.name);
          if (!mine) continue;
          for (const [term, iri] of contextTerms(mine.defs)) {
            if (!FULL_IRI.test(iri) || mine.uncertain.has(term)) continue;
            if (theirs.has(term) && theirs.get(term) !== iri) problems.push(`${where}: redefines ${term} (${theirs.get(term)} there, ${iri} here)`);
          }
        } catch (e) {
          notes.push(`${where}: not checked, ${e.cause?.code ?? e.message}`);
        }
      }
    }
    return { problems, notes };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
