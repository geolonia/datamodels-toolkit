// The pages of a node for people (#12): plain HTML, monospace, no JavaScript,
// readable with curl. One page per model with an anchor per attribute, one
// per subject with an anchor per term (with hash IRIs it is the namespace
// document, so every IRI opens on it), and an index. Every page links to
// catalog.json. Written with Eleventy from the templates in pages/.
//
// One set of pages per language of the node: the first language at the base
// URL (where the IRIs open), each other one under /<lang>/, with links between
// them. A text missing in a language falls back to the node's first language.
import Eleventy from '@11ty/eleventy';
import { join, relative } from 'node:path';
import { attributesOf } from './urls.mjs';
import { readFileSync } from 'node:fs';
import { pageTexts } from './page-texts.mjs';

// Named in each page's generator meta tag and footer.
const TOOLKIT = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const GENERATOR = { name: 'datamodels-toolkit', version: TOOLKIT.version, url: 'https://github.com/geolonia/datamodels-toolkit' };

const TEMPLATES = join(import.meta.dirname, 'pages');
// Our own (empty) configuration file: without it Eleventy loads eleventy.config.js from the current directory.
const CONFIG = join(import.meta.dirname, 'eleventy.config.mjs');

// A link only for an http(s) URL: these come from the sources and end up in href.
const httpOnly = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

const has = (o, l) => typeof o?.[l] === 'string' && o[l].trim();

/**
 * A text in the page's language, or else in the node's first language that
 * has it, or else in any: [{ lang, text }] with one item, or none.
 */
const pick = (o, lang, languages) => {
  const l = [lang, ...languages, ...Object.keys(o ?? {})].find((x) => has(o, x));
  return l ? [{ lang: l, text: o[l] }] : [];
};

/** What the templates show for the pages in `lang` (default: the node's first language), with every URL resolved. */
export function pageData(subjects, { urls, node, lang = node.languages[0] }) {
  const { languages } = node;
  const t = pageTexts(lang);
  const texts = (o) => pick(o, lang, languages);
  // A page in another language than the first is under /<lang>/.
  const prefixOf = (l) => (l === languages[0] ? `${urls.baseUrl}/` : `${urls.baseUrl}/${l}/`);
  const path = (url) => url.slice(urls.baseUrl.length).replace(/^\//, '');
  const at = (url) => `${prefixOf(lang)}${path(url)}`;
  // The file a page URL is served from: /x/ is x/index.html, /ns/road is ns/road.html.
  const file = (url) => { const rel = path(url); return rel === '' || rel.endsWith('/') ? `${rel}index.html` : `${rel}.html`; };
  const name = texts(node.publisher.name)[0]?.text ?? '';
  const site = {
    name, title: t.dataModelsBy(name), description: `${t.introBefore}catalog.json${t.introAfter}`, locale: t.locale,
    lang, baseUrl: urls.baseUrl, home: prefixOf(lang), catalog: `${urls.baseUrl}/catalog.json`, llms: `${urls.baseUrl}/llms.txt`,
    // The other languages' versions of each page: prefix + the page's path.
    langs: languages.length > 1 ? languages.map((l) => ({ lang: l, label: pageTexts(l).label, locale: pageTexts(l).locale, prefix: prefixOf(l) })) : [],
    first: prefixOf(languages[0]),
    publisher: { name, url: node.publisher.url },
    license: node.license, licenseUrl: node.licenseUrl ?? `https://spdx.org/licenses/${node.license}.html`,
    generator: GENERATOR,
  };
  const models = [];
  const out = subjects.map((subject) => {
    const su = urls.subjectUrls(subject);
    const terms = [];
    const minted = new Set();
    // The anchor of a term is the end of its IRI (after the namespace), which may differ from the attribute's name.
    const anchor = (iri, name) => (iri.startsWith(su.namespace) ? iri.slice(su.namespace.length) : name);
    const subjectModels = subject.models.map((model) => {
      const mu = urls.modelUrls(subject, model);
      if (!model.schema['x-alias-of']) terms.push({ name: model.type, anchor: anchor(mu.typeIri, model.type), what: t.type, iri: mu.typeIri, page: at(mu.page), texts: texts(model.catalog.title) });
      const required = new Set(model.schema.required ?? []);
      const attributes = attributesOf(model).map(([name, prop]) => {
        const iri = prop['x-iri'] ?? '';
        if (iri.startsWith(su.namespace) && !minted.has(iri)) {
          minted.add(iri);
          terms.push({ name, anchor: anchor(iri, name), what: t.attributeOf(model.type), iri, page: `${at(mu.page)}#${name}`, texts: texts(model.catalog.attributes?.[name]) });
        }
        const type = prop.$ref || prop.allOf ? 'object' : prop.type ?? (prop.anyOf ? prop.anyOf.map((a) => a.format ?? a.type).filter(Boolean).join(' or ') : '');
        return { name, iri, type: [type, prop.format].filter(Boolean).join(', '), required: required.has(name), texts: texts(model.catalog.attributes?.[name]) };
      });
      const m = {
        type: model.type, kind: t.kinds[model.kind] ?? model.kind, status: t.stages[model.catalog.status ?? 'draft'] ?? model.catalog.status,
        typeIri: mu.typeIri, page: at(mu.page), path: path(mu.page), file: file(mu.page),
        titles: texts(model.catalog.title), descriptions: texts(model.catalog.description),
        // One line for the description meta tag and link previews.
        summary: (texts(model.catalog.description)[0] ?? texts(model.catalog.title)[0])?.text ?? model.type,
        schema: mu.schemaExact, schemaAlias: mu.schemaAlias, context: su.contextAlias,
        examples: Object.keys(model.examples).sort().map((f) => `${mu.examples}${f}`),
        subClassOf: httpOnly(model.schema['x-subclass-of']), aliasOf: httpOnly(model.schema['x-alias-of']),
        extends: model.catalog.extends ?? [], attributes,
        subject: { name: subject.name, page: at(su.page) },
      };
      models.push(m);
      return m;
    });
    return {
      name: subject.name, version: subject.version, page: at(su.page), path: path(su.page), file: file(su.page),
      titles: texts(subject.title), descriptions: texts(subject.description),
      summary: (texts(subject.description)[0] ?? texts(subject.title)[0])?.text ?? subject.name,
      contextAlias: su.contextAlias, contextExact: su.contextExact, vocab: su.vocabExact, namespace: su.namespace,
      models: subjectModels, terms,
    };
  });
  return { site, t, subjects: out, models };
}

/** Write the pages into `out`, one set per language. Returns the paths written, relative to `out`. */
export async function writePages(subjects, { urls, node, out }) {
  const written = [];
  for (const lang of node.languages) {
    const data = pageData(subjects, { urls, node, lang });
    const dir = lang === node.languages[0] ? out : join(out, lang);
    const eleventy = new Eleventy(TEMPLATES, dir, {
      quietMode: true,
      configPath: CONFIG,
      config(config) {
        config.setNunjucksEnvironmentOptions({ autoescape: true, throwOnUndefined: true });
        for (const [k, v] of Object.entries(data)) config.addGlobalData(k, v);
      },
    });
    eleventy.disableLogger();
    const [, files] = await eleventy.write();
    written.push(...files.map((w) => relative(out, w.outputPath)));
  }
  return written.sort();
}
