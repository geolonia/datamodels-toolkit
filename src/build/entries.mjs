// The entries of catalog.json. Moved from geolonia/datamodels
// (scripts/lib/publish.mjs and extensions.mjs, #10).
import { attributesOf } from './urls.mjs';

/**
 * The attributes of a model as catalog.json lists them, so a tool can list a
 * model's attributes or match a CSV against several models without fetching
 * every schema. The schema stays the authority; this is a summary.
 */
export function attributeEntries(model, { urls, languages = ['ja', 'en'] }) {
  // A catalog value type, from the URL of the schema an attribute references:
  // .../schema/<subject>/<Type>/vX.Y.Z.json is the type .../ns/<subject>/<Type>.
  const valueModel = (ref) => {
    const m = typeof ref === 'string' && ref.startsWith(`${urls.baseUrl}/schema/`) && /\/schema\/([^/]+)\/([^/]+)\/v[^/]+\.json$/.exec(ref);
    return m ? `${urls.baseUrl}/ns/${m[1]}/${m[2]}` : undefined;
  };
  const required = new Set(model.schema.required ?? []);
  return attributesOf(model).map(([name, prop]) => {
    const ngsi = prop['x-ngsi'] ?? {};
    // A value type ($ref, e.g. JapaneseAddress or Geometry) is an object; its own schema is at valueModel's schema URL.
    const type = prop.$ref || prop.allOf ? 'object' : prop.type;
    const items = prop.items && { ...(prop.items.type ? { type: prop.items.type } : {}), ...(prop.items.format ? { format: prop.items.format } : {}), ...(prop.items.enum ? { enum: prop.items.enum } : {}) };
    // A value that may take one of several formats (date or date-time) lists them, as the schema's anyOf does.
    const formats = (prop.anyOf ?? []).map((a) => a?.format).filter(Boolean);
    const description = model.catalog?.attributes?.[name];
    if (!prop['x-iri']) throw new Error(`${model.type}.${name}: no x-iri, so catalog.json cannot list its IRI`);
    const missing = languages.filter((l) => !description?.[l]);
    if (missing.length) throw new Error(`${model.type}.${name}: catalog.yaml needs a ${missing.join(' and ')} description for catalog.json`);
    return {
      name,
      iri: prop['x-iri'],
      // Members of a value type are plain fields inside an attribute's value, not NGSI-LD attributes.
      ...(model.kind === 'value' ? {} : { ngsiType: ngsi.type ?? 'Property' }),
      ...(type ? { type } : {}),
      ...(prop.format ? { format: prop.format } : {}),
      ...(formats.length ? { formats } : {}),
      ...(prop.enum ? { enum: prop.enum } : {}),
      ...(items && Object.keys(items).length ? { items } : {}),
      // From the referenced catalog schema, not x-ngsi.model, which may name a narrower class (geojson Point).
      ...(valueModel(prop.$ref) ? { valueModel: valueModel(prop.$ref) } : {}),
      ...(ngsi.target ? { target: ngsi.target } : {}),
      ...(ngsi.multi ? { multi: true } : {}),
      required: required.has(name),
      description: Object.fromEntries(languages.map((l) => [l, description[l]])),
    };
  });
}

/** One known extension in catalog.json (models[].extensions), as its owner reported it. */
export function extensionEntry(ext) {
  return {
    id: ext.name,
    organization: { ja: ext.organization.ja, en: ext.organization.en },
    ...(ext.url ? { url: ext.url } : {}),
    version: ext.version,
    ...(typeof ext.context === 'string' ? { contextUrl: ext.context } : { context: ext.context }),
    terms: Object.entries(ext.terms).map(([name, t]) => ({ name, iri: t.iri, description: { ja: t.description.ja, en: t.description.en } })),
    ...(ext.data ? { dataUrl: ext.data } : {}),
    ...(ext.since !== undefined ? { since: String(ext.since) } : {}),
  };
}

/** One model in catalog.json. `adapterUrls`: adapter name to URL, for catalogs with adapters. */
export function catalogEntry(subject, model, { urls, languages = ['ja', 'en'], adapterUrls = {} }) {
  const u = urls.subjectUrls(subject); const mu = urls.modelUrls(subject, model);
  const pageEn = urls.pageEn(mu.page);
  return {
    type: model.type, kind: model.kind, typeIri: mu.typeIri, subject: subject.name, domain: subject.name, source: subject.source,
    contextUrl: u.contextExact, contextAliasUrl: u.contextAlias, schemaUrl: mu.schemaExact, vocabularyUrl: u.vocabExact, version: subject.version,
    status: model.catalog.status ?? 'draft', title: model.catalog.title, description: model.catalog.description,
    sampleProperties: attributesOf(model).map(([n]) => n), pageUrl: mu.page, ...(pageEn !== mu.page ? { pageUrlEn: pageEn } : {}),
    exampleUrls: Object.keys(model.examples).sort().map((f) => `${mu.examples}${f}`),
    ...(model.mappings?.length ? { mappingUrls: model.mappings.map((m) => `${mu.mapping}${m.name}.yaml`) } : {}),
    // The same files with the standard each one maps, so a tool need not fetch them to show it.
    ...(model.mappings?.length ? { mappings: model.mappings.map((m) => ({ url: `${mu.mapping}${m.name}.yaml`, standard: { ja: m.standard?.name?.ja ?? m.name, en: m.standard?.name?.en ?? m.name } })) } : {}),
    attributes: attributeEntries(model, { urls, languages }),
    // Attributes other organisations added under their own IRIs, as their owners reported them (not reviewed).
    ...(model.extensions?.length ? { extensions: model.extensions.map(extensionEntry) } : {}),
    ...(Object.keys(adapterUrls).length ? { adapters: adapterUrls } : {}),
    ...(model.schema['x-alias-of'] ? { aliasOf: model.schema['x-alias-of'] } : {}),
    ...(model.schema['x-subclass-of'] ? { subClassOf: model.schema['x-subclass-of'] } : {}),
    ...(model.catalog.supersededBy ? { supersededBy: model.catalog.supersededBy } : {}),
  };
}

/**
 * The redirects that make the IRIs of a subject resolve to documentation, as
 * [from, to] paths: the namespace to the subject page, each type to its page,
 * each attribute minted in the namespace to its heading on a model page (the
 * first model that has it).
 */
export function termRedirects(subject, { urls }) {
  const u = urls.subjectUrls(subject);
  const out = [[`/ns/${subject.name}/`, `/models/${subject.name}/`]];
  const done = new Set();
  for (const model of subject.models) {
    if (urls.modelUrls(subject, model).typeIri === `${u.namespace}${model.type}`) out.push([`/ns/${subject.name}/${model.type}`, `/models/${subject.name}/${model.type}/`]);
    for (const [name] of attributesOf(model)) {
      const iri = model.schema.properties[name]['x-iri'] ?? '';
      if (done.has(name) || !iri.startsWith(u.namespace)) continue;
      done.add(name);
      out.push([`/ns/${subject.name}/${name}`, `/models/${subject.name}/${model.type}/#${name}`]);
    }
  }
  return out;
}
