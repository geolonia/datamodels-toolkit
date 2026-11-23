// A GeonicDB Custom Data Model request body from a model: what
// POST /custom-data-models accepts. contextUrl points at the subject's context,
// so the broker uses the node's vocabulary.
//
// Moved from geolonia/datamodels (adapters/geonicdb/) so that every node can
// offer it (geolonia/datamodels-toolkit#134). The rules follow GeonicDB's
// model checks; the issue numbers below are geolonia/datamodels'.
import { attributesOf } from '../../build/urls.mjs';
import { dateFormats } from '../../ngsi.mjs';
import { textIn } from '../model.mjs';

// A value that may be a plain date (YYYY-MM-DD) is GeonicDB's date value type,
// which from GeonicDB v0.24.0 accepts a date, a date-time and the typed
// {"@type": "Date" | "DateTime", ...} values of the normalized examples (#185).
// On v0.23.x and older, date is an alias of datetime: the model registers, but
// a plain date is refused (400). datetime accepts typed date-times from v0.22.0.
// An attribute that is only a date (no date-time) gets date too, which also
// accepts a date-time.

// Every attribute is sent with its own NGSI-LD type as ngsiType, VocabProperty
// and JsonProperty included (#285). A LanguageProperty is sent with the value
// type of its schema: object for the language map (array when multi-valued); the
// checks of the strings inside the map are not sent. A GeonicDB that does not accept these two
// types in a model (v0.22.0 and older) answers 400 for a model that has them.
const VALUE_CHECKS = ['minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'enum'];

// A list (valueType array) gets the rules of its items and its length instead, in
// GeonicDB's form `validation: { items: {...}, minItems, maxItems, uniqueItems }`
// (GeonicDB v0.25.0 and later; geolonia/datamodels#300). GeonicDB refuses the
// scalar rules at the top level of a list, and list rules anywhere else. Items
// that are objects or value types ($ref) get no item rules, since GeonicDB does
// not check inside a value; their length rules are still sent.
const LIST_CHECKS = ['minItems', 'maxItems', 'uniqueItems'];

// Patterns GeonicDB's ReDoS check refuses although they are linear, so a body
// with one could not be registered at all (400): the ISO 8601 duration of
// Task.estimatedDuration and the fieldservice durations, refused since GeonicDB
// v0.25.0 (geolonia/geonicdb#4180). They are not sent, and `warn` says so: the
// broker then does not check the format of that value. Remove an entry once the
// GeonicDB that refuses it is gone.
const GEONICDB_REFUSED_PATTERNS = [/^\^P\(\?!\$\)/];
const refusedPattern = (pattern) => typeof pattern === 'string' && GEONICDB_REFUSED_PATTERNS.some((re) => re.test(pattern));

/**
 * The full IRI of a VocabProperty term, or undefined, expanded with `terms` (the
 * context's terms, imports included: { term: IRI or definition }) as JSON-LD
 * expands a `vocab` value: a term the context defines, a compact IRI whose
 * prefix it defines, or an absolute IRI. GeonicDB stores and checks the
 * expanded IRI (#280, #285).
 */
export function expandVocabTerm(terms, term, depth = 0) {
  if (typeof term !== 'string' || depth >= 10) return undefined;
  const idOf = (def) => (typeof def === 'string' ? def : def?.['@id']);
  const defined = Object.hasOwn(terms, term) ? idOf(terms[term]) : undefined;
  if (typeof defined === 'string' && defined !== term) return expandVocabTerm(terms, defined, depth + 1);
  const i = term.indexOf(':');
  if (i <= 0) return undefined;
  const rest = term.slice(i + 1);
  const prefix = term.slice(0, i);
  // https://example.org/x is an absolute IRI, not the prefix "https".
  const base = rest.startsWith('//') || !Object.hasOwn(terms, prefix) ? undefined : idOf(terms[prefix]);
  if (typeof base === 'string' && /^https?:\/\//.test(base)) return base + rest;
  if (/^(https?:\/\/|urn:)/.test(term)) return term;
  return undefined;
}

/**
 * A VocabProperty's checks as GeonicDB applies them: it checks the term after
 * expanding it to its full IRI, and GeonicDB's rule is that the enum of a
 * VocabProperty lists full IRIs only (#285), so the allowed terms are sent
 * as full IRIs. A term that cannot be expanded would end up in the NGSI-LD
 * default context, which means nothing, so it is an error (`fix` says what to
 * do). A pattern or a length is written for the term as data writes it, but
 * GeonicDB applies it to the full IRI: not sent, and `warn` says so.
 */
function vocabValidation(validation, terms, where, fix, warn) {
  const v = { ...validation };
  const dropped = ['pattern', 'minLength', 'maxLength'].filter((k) => v[k] !== undefined);
  for (const k of dropped) delete v[k];
  if (dropped.length) warn(`${where}: GeonicDB adapter: ${dropped.join(', ')} of a VocabProperty not sent (GeonicDB checks the term as a full IRI)`);
  if (v.enum !== undefined) {
    if (!Array.isArray(v.enum)) throw new Error(`${where}: the enum of a VocabProperty must be a list of terms, not ${JSON.stringify(v.enum)}`);
    v.enum = v.enum.map((t) => {
      const iri = terms ? expandVocabTerm(terms, t) : undefined;
      if (iri === undefined) throw new Error(`${where}: the VocabProperty term ${JSON.stringify(t)} cannot be expanded to a full IRI; ${fix}`);
      return iri;
    });
  }
  return v;
}

/** An attribute's NGSI-LD type: Property when the schema does not say (as the toolkit reads data, src/ngsi.mjs). */
const ngsiTypeOf = (prop) => prop['x-ngsi']?.type ?? 'Property';

/** True for a string Property that may be a plain date. */
function mayBeDate(prop) {
  return ngsiTypeOf(prop) === 'Property' && prop.type === 'string' && dateFormats(prop).includes('date');
}

/** The schema's type without 'null': ['array', 'null'] is a list that may be left out. */
function typeOf(prop) {
  if (!Array.isArray(prop.type)) return prop.type;
  const types = prop.type.filter((t) => t !== 'null');
  return types.length === 1 ? types[0] : prop.type;
}

function valueTypeOf(prop) {
  const ngsi = ngsiTypeOf(prop);
  if (ngsi === 'Relationship') return 'uri';
  if (ngsi === 'GeoProperty') return 'geojson';
  if (mayBeDate(prop)) return 'date';
  if (prop.format === 'date-time') return 'datetime';
  if (prop.allOf || prop.$ref) return 'object'; // a value type referred to with $ref
  if (prop.format === 'uri') return 'uri';
  return typeOf(prop); // string | number | integer | boolean | array | object
}

/**
 * The rules of a list (valueType array) in GeonicDB's form: the scalar rules of
 * its items under `items`, and its length rules. A VocabProperty's or a
 * LanguageProperty's list gets no item rules: GeonicDB would compare a term
 * before expanding it, and a language map is not a scalar. `warn` says what
 * was left out.
 */
function listValidation(prop, where, warn) {
  const v = {};
  const ngsiType = ngsiTypeOf(prop);
  const items = prop.items && typeof prop.items === 'object' && !Array.isArray(prop.items) ? prop.items : {};
  const scalar = ['string', 'number', 'integer', 'boolean'].includes(items.type) && !items.$ref && !items.allOf;
  const itemRules = {};
  if (scalar && ngsiType !== 'VocabProperty' && ngsiType !== 'LanguageProperty') {
    for (const k of VALUE_CHECKS) if (items[k] !== undefined) itemRules[k] = items[k];
    if (refusedPattern(itemRules.pattern)) {
      delete itemRules.pattern;
      warn(`${where}: GeonicDB adapter: pattern of the items not sent, GeonicDB refuses it (geolonia/geonicdb#4180)`);
    }
  } else if (VALUE_CHECKS.some((k) => items[k] !== undefined)) {
    warn(`${where}: GeonicDB adapter: rules of the items not sent (GeonicDB checks only scalar items of a Property list)`);
  }
  if (Object.keys(itemRules).length) v.items = itemRules;
  for (const k of LIST_CHECKS) if (prop[k] !== undefined) v[k] = prop[k];
  const top = VALUE_CHECKS.filter((k) => prop[k] !== undefined);
  if (top.length) warn(`${where}: GeonicDB adapter: ${top.join(', ')} at the top level of a list not sent (GeonicDB takes them only under items)`);
  return v;
}

/**
 * The target type of a Relationship for GeonicDB's `objectType` (v0.25.0 and
 * later; geolonia/datamodels#300): the full type IRI of `x-ngsi.target`, or a
 * list of them without duplicates. None for `any` or `agent` (no single type)
 * or a short name, and none for a renamed type of a tenant variant: a target
 * of the subject with typePrefix, the model's own type with typeName, since
 * data naming the renamed type would not match. Detecting them needs the
 * subject's context terms (`terms`); without them a variant sends no objectType.
 * GeonicDB compares only an `objectType` the data states; data without one is
 * accepted, and the target entity is never loaded.
 */
function objectTypeOf(prop, subject, model, terms, { typePrefix, typeName }, where, warn) {
  if (ngsiTypeOf(prop) !== 'Relationship') return undefined;
  const target = prop['x-ngsi']?.target;
  const given = Array.isArray(target) ? target : [target];
  // Full IRIs only: a short name would depend on the context, and any or agent name no single type.
  const iri = (t) => typeof t === 'string' && /^(https?:\/\/|urn:)\S+$/.test(t);
  if (!given.length || !given.every(iri)) return undefined;
  const list = [...new Set(given)];
  if (list.length > 50) {
    warn(`${where}: GeonicDB adapter: objectType not sent (more than 50 target types; GeonicDB takes at most 50)`);
    return undefined;
  }
  if (typePrefix || typeName) {
    if (!terms) {
      warn(`${where}: GeonicDB adapter: objectType not sent (the types are renamed and the ${subject.name} context terms could not be read)`);
      return undefined;
    }
    const iriOf = (type) => (Object.hasOwn(terms, type) ? (typeof terms[type] === 'string' ? terms[type] : terms[type]?.['@id']) : undefined);
    // typePrefix renames every type of the subject (export does the whole subject); typeName only this model's.
    const renamed = new Set((typePrefix ? (subject.models ?? []).map((m) => m.type) : [model.type]).map(iriOf).filter(Boolean));
    if (list.some((t) => renamed.has(t))) return undefined;
  }
  return list.length === 1 ? list[0] : list;
}

/** True when a model has a VocabProperty with allowed terms: its body needs the context's terms. */
export const needsTerms = (model) => attributesOf(model).some(([, p]) => ngsiTypeOf(p) === 'VocabProperty' && p.enum !== undefined);

/**
 * The body for `model` of `subject`. `context` is the adapters' (src/adapters/model.mjs):
 * its URL builders give the contextUrl, its languages the descriptions (Japanese
 * first, as GeonicDB's console is Japanese, then the node's languages), and
 * `terms[subject.name]` the terms of the subject's context for VocabProperty terms.
 *
 * Options, for a tenant's own variant:
 *   typePrefix       prefix for the type name (tenant-specific naming)
 *   contextUrl       context to declare instead of the subject's alias (vN.jsonld)
 *   allowAdditional  additionalProperties: true, so attributes the model does
 *                    not know are accepted (unvalidated)
 *   extend           { contextUrl?, description?, propertyDetails? }: a tenant's
 *                    own attributes merged into the body. An attribute of the
 *                    model cannot be redefined; a name clash throws. They are
 *                    in GeonicDB's form already and pass through as written
 *                    (objectType, validation.items and the list rules included);
 *                    only a VocabProperty's allowed terms are expanded. The
 *                    extension's contextUrl should import the subject's context
 *                    and define only the added terms.
 *   typeName         full replacement of the type name (alias; same IRI)
 *   rename           { name: alias }: attribute aliases. The body keeps each
 *                    property's IRI in `@context`, so the caller's contextUrl
 *                    must map the alias to that IRI.
 *   contextTerms     the subject's context terms, instead of context.terms
 *   warn             where notes go (default context.warn, else console.warn)
 *
 * An attribute may be named like a member of Object.prototype (constructor):
 * every lookup by attribute name is of an own property.
 */
export function toCustomDataModel(subject, model, context, { typePrefix = '', typeName, contextUrl, allowAdditional = false, extend, rename = {}, contextTerms, warn = context.warn ?? console.warn } = {}) {
  const { urls, languages = [] } = context;
  const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
  const terms = contextTerms ?? own(context.terms, subject.name);
  const why = own(context.termsProblems, subject.name);
  const termsMissing = terms ? '' : ` (the terms of the ${subject.name} context could not be read${why ? `: ${why}` : ''})`;
  const text = (texts) => textIn(texts, 'ja', languages);
  const names = new Set(attributesOf(model).map(([n]) => n));
  for (const [from, to] of Object.entries(rename)) {
    if (!names.has(from)) throw new Error(`rename: "${from}" is not an attribute of ${model.type}`);
    if (!/^[A-Za-z0-9_]+$/.test(to)) throw new Error(`rename: alias "${to}" must match [A-Za-z0-9_]+ (GeonicDB attribute name rule)`);
    if (names.has(to) && own(rename, to) === undefined) throw new Error(`rename: alias "${to}" collides with attribute "${to}" of ${model.type}`);
  }
  const aliasTargets = Object.values(rename);
  if (new Set(aliasTargets).size !== aliasTargets.length) throw new Error('rename: two attributes mapped to the same alias');
  const example = model.examples?.['example.json'] ?? {};
  // Keys are attribute names, so no inherited setter (__proto__) may take one.
  const propertyDetails = Object.create(null);
  const put = (key, value) => Object.defineProperty(propertyDetails, key, { value, enumerable: true, writable: true, configurable: true });
  for (const [name, prop] of attributesOf(model)) {
    const ngsiType = ngsiTypeOf(prop);
    const d = {
      // valueType stays the schema's: GeonicDB checks the stored value, which is
      // the expanded term (a string) for a VocabProperty and the JSON itself for
      // a JsonProperty, as the schema describes them.
      ngsiType,
      valueType: valueTypeOf(prop),
      // GeonicDB requires the key on every property; null when the example has no value.
      example: own(example, name) ?? null,
      required: (model.schema.required ?? []).includes(name),
      description: text(own(model.catalog?.attributes, name)) || prop.description || '',
    };
    // GeonicDB reads a property-level `@context` as the term IRI when it
    // generates a context itself. With contextUrl set it is not needed, but
    // carrying the IRI keeps the body self-describing if contextUrl is ever
    // dropped. Core terms (location, description) carry theirs too: a
    // generated context would otherwise give them tenant IRIs.
    const iri = prop['x-iri'];
    if (typeof iri === 'string' && /^https?:\/\//.test(iri)) d['@context'] = iri;
    let validation = {};
    const where = `${model.type}.${name}`;
    if (d.valueType === 'array') {
      validation = listValidation(prop, where, warn);
    } else {
      for (const k of VALUE_CHECKS) if (prop[k] !== undefined) validation[k] = prop[k];
      if (refusedPattern(validation.pattern)) {
        delete validation.pattern;
        warn(`${where}: GeonicDB adapter: pattern not sent, GeonicDB refuses it (geolonia/geonicdb#4180)`);
      }
    }
    if (ngsiType === 'VocabProperty' && d.valueType !== 'array') {
      validation = vocabValidation(validation, terms, where, `define its prefix or term in ${subject.name}/context.jsonld (or a context it imports), or write the full IRI${termsMissing}`, warn);
    }
    // A JsonProperty keeps its checks: GeonicDB applies them to the JSON itself
    // (a JsonProperty list gets the list rules above).
    if (Object.keys(validation).length) d.validation = validation;
    const objectType = objectTypeOf(prop, subject, model, terms, { typePrefix, typeName }, where, warn);
    if (objectType !== undefined) d.objectType = objectType;
    put(own(rename, name) ?? name, d);
  }
  if (extend?.propertyDetails) {
    for (const [name, detail] of Object.entries(extend.propertyDetails)) {
      if (Object.hasOwn(propertyDetails, name)) throw new Error(`extension redefines attribute "${name}" of ${model.type}; add a new attribute instead`);
      if (!detail || typeof detail !== 'object' || !detail.ngsiType || !detail.valueType) throw new Error(`extension attribute "${name}" needs ngsiType and valueType`);
      // The same GeonicDB rules as the model's attributes. The extension's own
      // context is not read here: its allowed terms expand with the subject's.
      const ext = { ...detail, example: detail.example ?? null };
      if (detail.ngsiType === 'VocabProperty' && detail.validation) {
        ext.validation = vocabValidation(detail.validation, terms, `extension attribute "${name}"`, `write it as a full IRI, or as a term or prefix of the ${subject.name} context${termsMissing}`, warn);
        if (!Object.keys(ext.validation).length) delete ext.validation;
      }
      put(name, ext);
    }
  }
  return {
    type: typeName ?? `${typePrefix}${model.type}`,
    domain: subject.name,
    description: extend?.description ?? (text(model.catalog?.description) || model.schema.description),
    contextUrl: extend?.contextUrl ?? contextUrl ?? model.links?.contextUrl ?? urls.subjectUrls(subject).contextAlias,
    propertyDetails,
    additionalProperties: allowAdditional ? true : (model.schema.additionalProperties === false ? false : true),
  };
}
