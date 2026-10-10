// A subject's vocabulary as an RDFS document: one class per type the subject
// owns (aliases own no IRI), rdfs:subClassOf for every x-subclass-of, and one
// property per attribute IRI minted in the subject's namespace, labelled in
// the catalog's languages. Moved from geolonia/datamodels (scripts/lib/vocab.mjs, #10).
import { attributesOf } from './urls.mjs';

const CONTEXT = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  label: { '@id': 'rdfs:label', '@container': '@language' },
  comment: { '@id': 'rdfs:comment', '@container': '@language' },
  subClassOf: { '@id': 'rdfs:subClassOf', '@type': '@id' },
  isDefinedBy: { '@id': 'rdfs:isDefinedBy', '@type': '@id' },
  seeAlso: { '@id': 'rdfs:seeAlso', '@type': '@id' },
  versionInfo: 'owl:versionInfo',
};

/** The vocabulary of one subject; `urls` from catalogUrls(), `languages` in the order they are written. */
export function buildVocabulary(subject, { urls, languages = ['ja', 'en'] }) {
  const lang = (o) => Object.fromEntries(languages.filter((l) => o?.[l]).map((l) => [l, o[l]]));
  const u = urls.subjectUrls(subject);
  const graph = [{
    '@id': u.namespace, '@type': 'owl:Ontology', label: lang(subject.title), comment: lang(subject.description),
    versionInfo: subject.version, seeAlso: u.contextExact,
  }];
  const props = new Map();
  for (const model of subject.models) {
    const mu = urls.modelUrls(subject, model);
    if (!model.schema['x-alias-of']) {
      graph.push({
        '@id': mu.typeIri, '@type': 'rdfs:Class', label: lang(model.catalog.title), comment: lang(model.catalog.description),
        ...(model.schema['x-subclass-of'] ? { subClassOf: model.schema['x-subclass-of'] } : {}),
        isDefinedBy: u.namespace, seeAlso: mu.page,
      });
    }
    for (const [name, prop] of attributesOf(model)) {
      const iri = prop['x-iri'];
      if (!iri?.startsWith(u.namespace) || props.has(iri)) continue;
      props.set(iri, { '@id': iri, '@type': 'rdf:Property', label: { en: name }, comment: lang(model.catalog.attributes?.[name]), isDefinedBy: u.namespace, seeAlso: `${mu.page}#${name}` });
    }
  }
  graph.push(...[...props.values()].sort((a, b) => a['@id'].localeCompare(b['@id'])));
  return { '@context': CONTEXT, '@graph': graph };
}
