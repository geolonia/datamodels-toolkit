// /llms.txt (https://llmstxt.org): a plain Markdown index of a catalog for AI
// tools and agents, made from the same subjects as the files, so it never
// lists a URL the build did not write. The short form of geolonia/datamodels'
// scripts/lib/llms.mjs, without that site's guides (#12).

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * The text of llms.txt. `name`: the catalog's name (the heading); `languages`:
 * the catalog's languages; English is used where a text has it, otherwise the
 * first language that does.
 */
export function llmsTxt(subjects, { urls, name, languages = ['en'] }) {
  const pick = (o) => o?.en ?? languages.map((l) => o?.[l]).find(Boolean) ?? '';
  let txt = `# ${name}\n\n`;
  txt += `> Data models: JSON Schemas (2020-12), JSON-LD @context files and RDFS vocabularies. Exact versions (v1.0.0) never change; major aliases (v1) follow the latest compatible version.\n\n`;
  txt += `Machine-readable list of every model with all its URLs: ${urls.baseUrl}/catalog.json.\n\n`;
  for (const subject of subjects) {
    const su = urls.subjectUrls(subject);
    txt += `## Subject: ${subject.name} (${oneLine(pick(subject.title))}), version ${subject.version}\n\n`;
    if (pick(subject.description)) txt += `${oneLine(pick(subject.description))}\n\n`;
    txt += `- [@context](${su.contextAlias}): use this alias in data; exact version ${su.contextExact}\n`;
    txt += `- [Vocabulary](${su.vocabExact}): RDFS classes and properties, with labels\n`;
    for (const model of subject.models) {
      const mu = urls.modelUrls(subject, model);
      const kind = model.kind === 'value' ? 'value type' : 'entity type';
      txt += `- [${model.type}](${mu.page}) (${kind}, ${model.catalog.status ?? 'draft'}): ${oneLine(pick(model.catalog.description))} JSON Schema: ${mu.schemaExact}\n`;
    }
    txt += `\n`;
  }
  txt += `## Optional\n\n`;
  txt += `- [catalog.json](${urls.baseUrl}/catalog.json): every model with its type IRI, context, schema, vocabulary, examples and page, its attributes, the publisher and the licence\n`;
  return txt;
}
