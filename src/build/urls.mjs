// Where a catalog publishes each file, for a base URL. Moved from
// geolonia/datamodels (scripts/lib/models.mjs), where the base URL was the
// constant https://datamodels.jp (geolonia/datamodels-toolkit#10).

/**
 * The URL builders for one catalog (a node, or datamodels.jp).
 * `baseUrl` without a trailing slash, for example https://models.geolonia.com.
 * `pageEn`: the English page URL of a page, when the catalog has one (datamodels.jp puts it under /en).
 * `iris`: 'slash' (`/ns/<subject>/<Term>`, datamodels.jp) or 'hash' (`/ns/<subject>#<Term>`,
 * the default for nodes on static hosts: the namespace is one page with an anchor per term).
 */
export function catalogUrls(baseUrl, { pageEn = null, iris = 'slash' } = {}) {
  if (!['slash', 'hash'].includes(iris)) throw new Error(`iris must be slash or hash, got ${JSON.stringify(iris)}`);
  const base = baseUrl.replace(/\/+$/, '');
  /** The IRI a catalog mints for a term (type or attribute) of a subject. */
  const term = (subjectName, name) => (iris === 'hash' ? `${base}/ns/${subjectName}#${name}` : `${base}/ns/${subjectName}/${name}`);
  const subjectUrls = (subject) => {
    const major = subject.version.split('.')[0];
    return {
      contextExact: `${base}/context/${subject.name}/v${subject.version}.jsonld`,
      contextAlias: `${base}/context/${subject.name}/v${major}.jsonld`,
      vocabExact: `${base}/vocab/${subject.name}/v${subject.version}.jsonld`,
      vocabAlias: `${base}/vocab/${subject.name}/v${major}.jsonld`,
      namespace: term(subject.name, ''),
      // With hash IRIs the namespace document is the subject's page, so every term IRI opens on it.
      page: iris === 'hash' ? `${base}/ns/${subject.name}` : `${base}/models/${subject.name}/`,
    };
  };
  const modelUrls = (subject, model) => {
    const major = subject.version.split('.')[0];
    return {
      schemaExact: `${base}/schema/${subject.name}/${model.type}/v${subject.version}.json`,
      schemaAlias: `${base}/schema/${subject.name}/${model.type}/v${major}.json`,
      // An alias model (x-alias-of) is another name for a type defined elsewhere: same IRI.
      typeIri: model.schema?.['x-alias-of'] ?? term(subject.name, model.type),
      page: `${base}/models/${subject.name}/${model.type}/`,
      examples: `${base}/examples/${subject.name}/${model.type}/`,
      // Correspondence tables with their conversion rules (mapping/<name>.yaml). Not versioned: they follow the current model.
      mapping: `${base}/mapping/${subject.name}/${model.type}/`,
    };
  };
  /** The files of an exact version of a subject, as release snapshots hold them. */
  const versionUrls = (subjectName, version) => ({
    context: `${base}/context/${subjectName}/v${version}.jsonld`,
    vocab: `${base}/vocab/${subjectName}/v${version}.jsonld`,
    schema: (type) => `${base}/schema/${subjectName}/${type}/v${version}.json`,
  });
  return { baseUrl: base, iris, term, subjectUrls, modelUrls, versionUrls, pageEn: pageEn ?? ((url) => url) };
}

/** Attributes of a model: every schema property except id, type and @context. */
export function attributesOf(model) {
  return Object.entries(model.schema.properties ?? {}).filter(([k]) => k !== 'id' && k !== 'type' && k !== '@context');
}
