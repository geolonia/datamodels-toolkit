// Rules for the models of a node that their files cannot state on their own:
// aliases and subclasses against the models they name, one model per type IRI,
// complete texts in catalog.yaml, the status, and the shape of notes.yaml.
// Moved from datamodels.jp's validate-models (geolonia/datamodels#226); the
// catalog's own process rules (ADOPTERS.yaml, TODO markers, known namespaces,
// an explicit x-ngsi.type where a node may leave Property out) stay there.
import { attributesOf } from './urls.mjs';
// textsProblem: a text in every language of the node, and nothing but language tags (node.yaml uses it too).
import { textsProblem } from './node.mjs';
import { toKeyValues } from '../ngsi.mjs';

const STATUSES = ['draft', 'experimental', 'stable', 'deprecated'];

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// JSON values compared by content, whatever the order of their keys.
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
// anyOf is unordered, and so is each alternative's required list: both are sorted before they are compared.
const anyOfKey = (v) => (Array.isArray(v)
  ? v.map((a) => (isObject(a) && Array.isArray(a.required) ? { ...a, required: [...new Set(a.required)].sort() } : a)).map((a) => JSON.stringify(canonical(a))).sort()
  : v ?? null);
const sameAnyOf = (a, b) => same(anyOfKey(a), anyOfKey(b));
// A list of names compared as a set; anything else (a malformed schema) by content.
const sameSet = (a, b) => (Array.isArray(a ?? []) && Array.isArray(b ?? []) ? same([...new Set(a ?? [])].sort(), [...new Set(b ?? [])].sort()) : same(a, b));

// An attribute of an entity without x-ngsi.type is a Property, everywhere in the toolkit.
const ngsiType = (prop) => prop?.['x-ngsi']?.type ?? 'Property';
/** An attribute as the toolkit reads it: of an entity model, with its NGSI-LD type filled in. */
const asRead = (prop, kind) => (kind === 'entity' && isObject(prop) ? { ...prop, 'x-ngsi': { ...prop['x-ngsi'], type: ngsiType(prop) } } : prop);

/** An absolute http(s) IRI with a host, written as a URL parser writes it. */
function httpIri(iri) {
  try {
    const u = new URL(iri);
    // No user name or password: the IRI goes into catalog.json and the pages.
    return ['http:', 'https:'].includes(u.protocol) && u.hostname !== '' && !u.username && !u.password && u.href === iri;
  } catch { return false; }
}

/** The local name of a class IRI: its fragment, or the last segment of its path. */
function classNameOf(iri) {
  const u = new URL(iri);
  return u.hash ? u.hash.slice(1) : u.pathname.split('/').pop() ?? '';
}

/** An http(s) URL with a host. */
function httpUrl(url) {
  try {
    const u = new URL(url);
    return typeof url === 'string' && ['http:', 'https:'].includes(u.protocol) && u.hostname !== '' && !u.username && !u.password;
  } catch { return false; }
}

/**
 * The problems of the models in `subjects` (from loadSubjects), as
 * "<subject>/<Type>/<file>: <problem>" lines. `urls` from catalogUrls(),
 * `languages` the node's languages.
 */
export function modelRuleProblems(subjects, { urls, languages }) {
  const out = [];
  // Where the node mints its type IRIs: a target there must be one of its models.
  const ownNamespace = `${urls.baseUrl}/ns/`;
  const all = subjects.flatMap((s) => s.models.map((m) => ({ s, m, where: `${s.name}/${m.type}`, iri: urls.modelUrls(s, m).typeIri })));
  // The models that own their type IRI: an alias has the IRI of the type it names.
  const owners = new Map();
  for (const x of all) {
    if (x.m.schema['x-alias-of'] !== undefined) continue;
    const prev = owners.get(x.iri);
    if (prev) out.push(`${x.where}/schema.json: the type IRI ${x.iri} is also the type of ${prev.where}`);
    else owners.set(x.iri, x);
  }

  for (const { s, m, where } of all) {
    const { schema, catalog } = m;
    const at = `${where}/schema.json`;
    const aliasOf = schema['x-alias-of'];
    const subclassOf = schema['x-subclass-of'];

    // An alias is the same type under another name: the same attributes and the same requirements.
    if (aliasOf !== undefined) {
      if (subclassOf !== undefined) out.push(`${at}: x-alias-of and x-subclass-of cannot both be set; an alias is the same type, a subclass a narrower one`);
      const target = owners.get(aliasOf);
      if (target) {
        const t = target.m.schema;
        const names = [...new Set([...attributesOf(m), ...attributesOf(target.m)].map(([k]) => k))];
        const differing = names.filter((k) => !same(asRead(schema.properties?.[k], m.kind), asRead(t.properties?.[k], target.m.kind)));
        if (differing.length) out.push(`${at}: an alias of ${target.where} has the same attributes, these differ: ${differing.join(', ')} (a narrower type sets x-subclass-of)`);
        if (!sameSet(schema.required, t.required)) out.push(`${at}: an alias of ${target.where} has the same required attributes`);
        if (!sameAnyOf(schema.anyOf, t.anyOf)) out.push(`${at}: an alias of ${target.where} has the same anyOf`);
        if (m.kind !== target.m.kind) out.push(`${at}: an alias of ${target.where} is of the same kind (${target.m.kind}, not ${m.kind})`);
        if (!same(schema.additionalProperties ?? true, t.additionalProperties ?? true)) out.push(`${at}: an alias of ${target.where} has the same additionalProperties`);
      } else if (typeof aliasOf === 'string' && aliasOf.startsWith(ownNamespace)) out.push(`${at}: x-alias-of ${aliasOf} is not a type of this node`);
      else if (!httpIri(aliasOf)) out.push(`${at}: x-alias-of must be the full http(s) IRI of a type, got ${JSON.stringify(aliasOf)}`);
    }

    // A subclass keeps its own type IRI, uses its parent's attribute IRIs and NGSI-LD types, and stays as strict.
    if (subclassOf !== undefined) {
      const target = owners.get(subclassOf);
      if (target?.m === m) out.push(`${at}: x-subclass-of names the model's own type; a class is not its own parent`);
      else if (target) {
        const t = target.m.schema;
        for (const [name, prop] of attributesOf(m)) {
          const pp = t.properties?.[name];
          if (!isObject(pp)) continue;
          if (pp['x-iri'] !== prop?.['x-iri']) out.push(`${at}: ${name}: a subclass of ${target.where} uses its IRI ${pp['x-iri']}, not ${prop?.['x-iri'] ?? '(no x-iri)'}`);
          if (ngsiType(pp) !== ngsiType(prop)) out.push(`${at}: ${name}: a subclass of ${target.where} keeps its NGSI-LD type ${ngsiType(pp)}`);
        }
        const own = Array.isArray(schema.required) ? schema.required : [];
        for (const r of Array.isArray(t.required) ? t.required : []) if (!own.includes(r)) out.push(`${at}: a subclass of ${target.where} keeps "${r}" required`);
        // An either/or requirement stays too: the same anyOf, or stricter by requiring one alternative outright.
        // Only an alternative that is nothing but a required list can be met that way.
        const alts = t.anyOf;
        const onlyRequired = (a) => isObject(a) && Object.keys(a).length === 1 && Array.isArray(a.required) && a.required.length > 0;
        if (Array.isArray(alts) && !sameAnyOf(schema.anyOf, alts) && !alts.some((a) => onlyRequired(a) && a.required.every((r) => own.includes(r)))) {
          out.push(`${at}: a subclass of ${target.where} keeps its anyOf (${alts.map((a) => (Array.isArray(a?.required) ? a.required.join('+') : '') || 'other rules').join(' or ')}) or requires one of them`);
        }
      } else if (typeof subclassOf === 'string' && subclassOf.startsWith(ownNamespace)) out.push(`${at}: x-subclass-of ${subclassOf} is not a type of this node`);
      else if (!httpIri(subclassOf)) out.push(`${at}: x-subclass-of must be the full http(s) IRI of a class, got ${JSON.stringify(subclassOf)}`);
      // Only the form: a misspelled class name passes, so open the IRI before using it.
      // The class name is after the # when there is one (a hash vocabulary), else the last path segment.
      else if (!/^[A-Z]/.test(classNameOf(subclassOf))) out.push(`${at}: x-subclass-of ${subclassOf} does not name a class (a class name starts with a capital letter)`);
    }

    for (const [name, prop] of attributesOf(m)) {
      if (isObject(prop) && Object.hasOwn(prop, 'x-personal-data') && prop['x-personal-data'] !== true) out.push(`${at}: ${name}: x-personal-data is true or left out`);
    }

    // catalog.yaml: the texts of every page and of catalog.json, in every language of the node.
    const cat = `${where}/catalog.yaml`;
    if (!isObject(catalog)) { out.push(`${cat}: must be a mapping with title, description and attributes`); continue; }
    for (const field of ['title', 'description']) {
      const p = textsProblem(catalog[field], languages);
      if (p) out.push(`${cat}: ${field} ${p}`);
    }
    const described = isObject(catalog.attributes) ? catalog.attributes : {};
    if (catalog.attributes !== undefined && !isObject(catalog.attributes)) out.push(`${cat}: attributes must be a mapping of attribute names to texts`);
    for (const [name] of attributesOf(m)) {
      const p = textsProblem(described[name], languages);
      if (p) out.push(`${cat}: attributes.${name} ${described[name] === undefined ? 'is missing' : p}`);
    }
    // id, type and @context are not attributes, so they have no text here either.
    const attributeNames = new Set(attributesOf(m).map(([k]) => k));
    for (const name of Object.keys(described)) if (!attributeNames.has(name)) out.push(`${cat}: attributes.${name}: not an attribute in schema.json`);

    // Only a missing status means draft; null or another word is a mistake.
    const status = catalog.status === undefined ? 'draft' : catalog.status;
    if (!STATUSES.includes(status)) out.push(`${cat}: status must be ${STATUSES.slice(0, -1).join(', ')} or ${STATUSES.at(-1)}, got ${JSON.stringify(status)}`);
    if (catalog.supersededBy !== undefined) {
      if (status !== 'deprecated') out.push(`${cat}: supersededBy is only for status deprecated, the status is ${status}`);
      if (!httpUrl(catalog.supersededBy)) out.push(`${cat}: supersededBy must be an http(s) URL (the replacement's type IRI or page), got ${JSON.stringify(catalog.supersededBy)}`);
    }

    // notes.yaml: the design notes and the dated changes, each a text in every language.
    // The loader gives {} for a missing file, so null is an empty one: a mistake like any other non-mapping.
    if (m.notes === undefined) continue;
    const nf = `${where}/notes.yaml`;
    if (!isObject(m.notes)) { out.push(`${nf}: must be a mapping with notes, history and license`); continue; }
    for (const key of ['notes', 'history']) {
      const list = m.notes[key];
      if (list === undefined) continue;
      if (!Array.isArray(list)) { out.push(`${nf}: ${key} must be a list`); continue; }
      list.forEach((n, i) => { const p = textsProblem(n, languages); if (p) out.push(`${nf}: ${key}[${i}] ${p} (quote a text that contains ": " or a comma)`); });
    }
    if (m.notes.license !== undefined && typeof m.notes.license !== 'string') out.push(`${nf}: license must be a string`);
  }
  return out;
}

// The id of an example entity: urn:ngsi-ld:<Type>:<local id>, the form the
// catalog's examples and `datamodels add` use, so a reference shows its type.
const EXAMPLE_ID = /^urn:ngsi-ld:([A-Za-z_][A-Za-z0-9_-]*):[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * The examples of the entity models: the id names the model's type, and a
 * Relationship references an entity of the type its schema declares
 * (x-ngsi.target), the example of that type when the node has one.
 */
export function exampleRefProblems(subjects, { urls }) {
  const out = [];
  const exampleIdOf = new Map();
  // Type names per type IRI: an alias shares the IRI of its type.
  const typeNamesOfIri = new Map();
  for (const s of subjects) for (const m of s.models) {
    if (m.kind !== 'entity') continue;
    // Two subjects with a model of the same name: a reference to that name names neither example.
    const id = m.examples?.['example.json']?.id;
    exampleIdOf.set(m.type, exampleIdOf.has(m.type) ? null : typeof id === 'string' ? id : null);
    const iri = urls.modelUrls(s, m).typeIri;
    typeNamesOfIri.set(iri, [...(typeNamesOfIri.get(iri) ?? []), m.type]);
  }
  for (const s of subjects) for (const m of s.models) {
    if (m.kind !== 'entity') continue;
    const dir = `${s.name}/${m.type}/examples`;
    const attrs = attributesOf(m);
    // The targets of each Relationship of an entity in key-values form.
    const refsOf = (entity) => Object.fromEntries(attrs.filter(([name, prop]) => prop?.['x-ngsi']?.type === 'Relationship' && entity[name] !== undefined).map(([name]) => [name, [entity[name]].flat()]));
    const checkRefs = (refs, file) => {
      for (const [name, targets] of Object.entries(refs)) {
        // A target of another site, or none ("any"), fixes no type here.
        const declared = typeNamesOfIri.get(m.schema.properties[name]['x-ngsi'].target);
        for (const target of targets) {
          const targetType = EXAMPLE_ID.exec(typeof target === 'string' ? target : '')?.[1];
          if (!targetType) { out.push(`${dir}/${file}: ${name}: ${JSON.stringify(target)} is not urn:ngsi-ld:<Type>:<local id>`); continue; }
          if (declared && !declared.includes(targetType)) { out.push(`${dir}/${file}: ${name}: ${target} is a ${targetType}, but schema.json declares a ${declared.join(' or ')} target`); continue; }
          const expected = targetType !== m.type ? exampleIdOf.get(targetType) : undefined;
          if (expected && target !== expected) out.push(`${dir}/${file}: ${name}: ${target} should reference the ${targetType} example, ${expected}`);
        }
      }
    };
    const kv = m.examples?.['example.json'];
    let kvRefs;
    if (isObject(kv)) {
      if (EXAMPLE_ID.exec(typeof kv.id === 'string' ? kv.id : '')?.[1] !== m.type) out.push(`${dir}/example.json: id must be urn:ngsi-ld:${m.type}:<local id>, got ${JSON.stringify(kv.id)}`);
      kvRefs = refsOf(kv);
      checkRefs(kvRefs, 'example.json');
    }
    // The normalized example, through its key-values projection; one that cannot be projected is reported by the example check.
    const norm = m.examples?.['example-normalized.jsonld'];
    if (!isObject(norm)) continue;
    let projected;
    try { projected = toKeyValues(norm, { multi: new Set(attrs.filter(([, p]) => p?.['x-ngsi']?.multi).map(([n]) => n)) }); } catch { continue; }
    const normRefs = refsOf(projected);
    if (!kvRefs) { checkRefs(normRefs, 'example-normalized.jsonld'); continue; }
    // Both examples describe the same entity, so they reference the same targets (example.json is checked above).
    for (const name of new Set([...Object.keys(kvRefs), ...Object.keys(normRefs)])) {
      const a = kvRefs[name] ?? [];
      const b = normRefs[name] ?? [];
      if (!sameSet(a.map(String), b.map(String))) out.push(`${dir}/example-normalized.jsonld: ${name}: references ${b.join(', ') || 'nothing'}, but example.json references ${a.join(', ') || 'nothing'}`);
    }
  }
  return out;
}
