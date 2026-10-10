// datamodels add (#13): a new model in a subject of a node, as a skeleton that
// builds and passes check right away: schema.json, catalog.yaml and an example,
// and the type in the subject's @context. The short form of geolonia/datamodels'
// scripts/new-model.mjs, in the node's languages and without the files only
// the shared catalog needs (notes, ADOPTERS).
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { readNode } from './build/node.mjs';
import { catalogUrls } from './build/urls.mjs';

const TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/;
const exists = (p) => stat(p).then(() => true, () => false);
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

/**
 * Add `<subject>/<Type>` to the node in `dir`; `kind` 'entity' (default) or
 * 'value'. Returns the paths written and changed, relative to the node.
 */
export async function addModel(dir, target, { kind = 'entity' } = {}) {
  const [subjectName, type, ...rest] = String(target).split('/');
  if (!subjectName || !type || rest.length) throw new Error(`the model is <subject>/<Type>, for example road/RoadPatrol; got ${JSON.stringify(target)}`);
  if (!TYPE_NAME.test(type)) throw new Error(`type name "${type}" must be UpperCamelCase ASCII (letters and digits), for example RoadPatrol`);
  if (!['entity', 'value'].includes(kind)) throw new Error(`kind must be entity or value, got ${JSON.stringify(kind)}`);
  const node = await readNode(dir);
  const subjectDir = join(dir, 'models', subjectName);
  if (!(await exists(join(subjectDir, 'subject.yaml')))) throw new Error(`no subject ${subjectName} in ${join(dir, 'models')} (datamodels init writes the first one)`);
  const subject = YAML.parse(await readFile(join(subjectDir, 'subject.yaml'), 'utf8'));
  const modelDir = join(subjectDir, type);
  if (await exists(modelDir)) throw new Error(`${modelDir} already exists`);

  const urls = catalogUrls(node.baseUrl, { iris: node.iris });
  const mu = urls.modelUrls({ name: subjectName, version: subject.version }, { type, schema: {} });
  const namespace = urls.subjectUrls({ name: subjectName, version: subject.version }).namespace;

  // The type goes into the subject's @context, with the prefix that names the namespace when there is one.
  const contextFile = join(subjectDir, 'context.jsonld');
  const context = JSON.parse(await readFile(contextFile, 'utf8'));
  const parts = Array.isArray(context['@context']) ? context['@context'] : [context['@context']];
  let terms = parts.findLast((p) => p && typeof p === 'object');
  if (!terms) { terms = {}; if (Array.isArray(context['@context'])) context['@context'].push(terms); else context['@context'] = terms; }
  if (type in terms) throw new Error(`${contextFile} already defines ${type}`);
  const prefix = Object.entries(terms).find(([, v]) => v === namespace)?.[0];
  terms[type] = prefix ? `${prefix}:${type}` : mu.typeIri;

  const perLanguage = (text) => Object.fromEntries(node.languages.map((l) => [l, text]));
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: mu.schemaExact,
    title: type,
    ...(kind === 'value' ? { 'x-kind': 'value' } : {}),
    type: 'object',
    properties: kind === 'value' ? {} : {
      id: { type: 'string', format: 'uri', description: 'Entity id (URN)' },
      type: { type: 'string', const: type, description: 'Entity type' },
    },
    required: kind === 'value' ? [] : ['id', 'type'],
  };
  const catalog = `# Write the title and description in each language. Every attribute in schema.json
# needs a description here, under attributes (name: { ${node.languages.map((l) => `${l}: …`).join(', ')} }).
${YAML.stringify({ title: perLanguage(type), description: perLanguage(`One ${type}.`), status: 'draft', attributes: {} }, { lineWidth: 0 })}`;
  const example = kind === 'value' ? {} : { id: `urn:ngsi-ld:${type}:example-1`, type };

  await mkdir(join(modelDir, 'examples'), { recursive: true });
  await writeFile(join(modelDir, 'schema.json'), json(schema), { flag: 'wx' });
  await writeFile(join(modelDir, 'catalog.yaml'), catalog, { flag: 'wx' });
  await writeFile(join(modelDir, 'examples', 'example.json'), json(example), { flag: 'wx' });
  await writeFile(contextFile, json(context));
  const at = `models/${subjectName}`;
  return { added: [`${at}/${type}/schema.json`, `${at}/${type}/catalog.yaml`, `${at}/${type}/examples/example.json`], changed: [`${at}/context.jsonld`], typeIri: mu.typeIri };
}
