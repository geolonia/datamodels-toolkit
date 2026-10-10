// The pages of a node for people (#12): plain HTML, monospace, no JavaScript,
// readable with curl. One page per model with an anchor per attribute, one
// per subject with an anchor per term (with hash IRIs it is the namespace
// document, so every IRI opens on it), and an index. Every page links to
// catalog.json. Written with Eleventy from the templates in pages/.
import Eleventy from '@11ty/eleventy';
import { join, relative } from 'node:path';
import { attributesOf } from './urls.mjs';

const TEMPLATES = join(import.meta.dirname, 'pages');

/** A text in every language it has, in the node's order: [{ lang, text }]. */
const texts = (o, languages) => languages.filter((l) => typeof o?.[l] === 'string' && o[l].trim()).map((lang) => ({ lang, text: o[lang] }));

/** What the templates show, with every URL resolved. */
export function pageData(subjects, { urls, node }) {
  const { languages } = node;
  // The file a page URL is served from: /x/ is x/index.html, /ns/road is ns/road.html.
  const file = (url) => { const rel = url.slice(urls.baseUrl.length).replace(/^\//, ''); return rel === '' || rel.endsWith('/') ? `${rel}index.html` : `${rel}.html`; };
  const site = {
    name: node.publisher.name.en ?? languages.map((l) => node.publisher.name[l]).find(Boolean) ?? Object.values(node.publisher.name)[0],
    lang: languages[0], baseUrl: urls.baseUrl, home: `${urls.baseUrl}/`, catalog: `${urls.baseUrl}/catalog.json`, llms: `${urls.baseUrl}/llms.txt`,
    publisher: { names: texts(node.publisher.name, Object.keys(node.publisher.name)), url: node.publisher.url },
    license: node.license, licenseUrl: node.licenseUrl ?? `https://spdx.org/licenses/${node.license}.html`,
  };
  const models = [];
  const out = subjects.map((subject) => {
    const su = urls.subjectUrls(subject);
    const terms = [];
    const minted = new Set();
    const subjectModels = subject.models.map((model) => {
      const mu = urls.modelUrls(subject, model);
      if (!model.schema['x-alias-of']) terms.push({ name: model.type, kind: 'type', iri: mu.typeIri, page: mu.page, model: model.type, texts: texts(model.catalog.title, languages) });
      const required = new Set(model.schema.required ?? []);
      const attributes = attributesOf(model).map(([name, prop]) => {
        const iri = prop['x-iri'] ?? '';
        if (iri.startsWith(su.namespace) && !minted.has(name)) {
          minted.add(name);
          terms.push({ name, kind: 'attribute', iri, page: `${mu.page}#${name}`, model: model.type, texts: texts(model.catalog.attributes?.[name], languages) });
        }
        const type = prop.$ref || prop.allOf ? 'object' : prop.type ?? (prop.anyOf ? prop.anyOf.map((a) => a.format ?? a.type).filter(Boolean).join(' or ') : '');
        return { name, iri, type: [type, prop.format].filter(Boolean).join(', '), required: required.has(name), texts: texts(model.catalog.attributes?.[name], languages) };
      });
      const m = {
        type: model.type, kind: model.kind, status: model.catalog.status ?? 'draft', typeIri: mu.typeIri, page: mu.page, file: file(mu.page),
        titles: texts(model.catalog.title, languages), descriptions: texts(model.catalog.description, languages),
        schema: mu.schemaExact, schemaAlias: mu.schemaAlias, context: su.contextAlias,
        examples: Object.keys(model.examples).sort().map((f) => `${mu.examples}${f}`),
        subClassOf: model.schema['x-subclass-of'] ?? null, aliasOf: model.schema['x-alias-of'] ?? null,
        extends: model.catalog.extends ?? [], attributes,
        subject: { name: subject.name, page: su.page },
      };
      models.push(m);
      return m;
    });
    return {
      name: subject.name, version: subject.version, page: su.page, file: file(su.page),
      titles: texts(subject.title, languages), descriptions: texts(subject.description, languages),
      contextAlias: su.contextAlias, contextExact: su.contextExact, vocab: su.vocabExact, namespace: su.namespace,
      models: subjectModels, terms,
    };
  });
  return { site, subjects: out, models };
}

/** Write the pages into `out`. Returns the paths written, relative to `out`. */
export async function writePages(subjects, { urls, node, out }) {
  const data = pageData(subjects, { urls, node });
  const eleventy = new Eleventy(TEMPLATES, out, {
    quietMode: true,
    config(config) {
      config.setNunjucksEnvironmentOptions({ autoescape: true, throwOnUndefined: true });
      for (const [k, v] of Object.entries(data)) config.addGlobalData(k, v);
    },
  });
  eleventy.disableLogger();
  const [, written] = await eleventy.write();
  return written.map((w) => relative(out, w.outputPath)).sort();
}
