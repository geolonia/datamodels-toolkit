// What released versions of a subject had and the current one no longer has:
// models (a renamed or removed model) and minted terms. Their addresses keep a
// page, so a link or an IRI from published data still leads somewhere: the
// model's old page says where it went, and the namespace page keeps an anchor
// for every former term (hash IRIs).
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { listReleases } from './releases.mjs';
import { buildVocabulary } from './vocab.mjs';

/**
 * { models: [{ type, versions, typeIri, schema, context }], terms: [{ iri, anchor, versions, vocab }] }
 * for one subject, from its release snapshots. versions: the released versions
 * that had it, oldest first; schema, context and vocab: the files of the last one.
 */
export async function formerOf(subject, { urls, languages }) {
  const releases = await listReleases(subject, { urls });
  const current = new Set(subject.models.map((m) => m.type));
  const ns = urls.subjectUrls(subject).namespace;
  const currentTerms = new Set(buildVocabulary(subject, { urls, languages })['@graph'].map((n) => n['@id']));
  const models = new Map();
  const terms = new Map();
  for (const r of releases) {
    const v = urls.versionUrls(subject.name, r.version);
    for (const f of r.files) {
      if (f.url === v.vocab) {
        const vocab = JSON.parse(await readFile(f.path, 'utf8'));
        for (const n of vocab['@graph'] ?? []) {
          const iri = n['@id'];
          if (typeof iri !== 'string' || iri === ns || !iri.startsWith(ns) || currentTerms.has(iri)) continue;
          const t = terms.get(iri) ?? { iri, anchor: iri.slice(ns.length), versions: [] };
          t.versions.push(r.version); t.vocab = v.vocab;
          terms.set(iri, t);
        }
      } else if (f.url !== v.context) {
        const type = basename(f.path).replace(/\.json$/, '');
        if (current.has(type)) continue;
        const schema = JSON.parse(await readFile(f.path, 'utf8'));
        const m = models.get(type) ?? { type, versions: [] };
        m.versions.push(r.version);
        Object.assign(m, { typeIri: schema['x-alias-of'] ?? urls.term(subject.name, type), schema: f.url, context: v.context });
        models.set(type, m);
      }
    }
  }
  return { models: [...models.values()], terms: [...terms.values()] };
}
