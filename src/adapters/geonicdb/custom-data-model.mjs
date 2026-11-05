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
// and JsonProperty included (#285). A GeonicDB that does not accept these two
// types in a model (v0.22.0 and older) answers 400 for a model that has them.
const VALUE_CHECKS = ['minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'enum'];

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

function valueTypeOf(prop) {
  const ngsi = ngsiTypeOf(prop);
  if (ngsi === 'Relationship') return 'uri';
  if (ngsi === 'GeoProperty') return 'geojson';
  if (mayBeDate(prop)) return 'date';
  if (prop.format === 'date-time') return 'datetime';
  if (prop.allOf || prop.$ref) return 'object'; // a value type referred to with $ref
  if (prop.format === 'uri') return 'uri';
  return prop.type; // string | number | integer | boolean | array | object
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
 *                    model cannot be redefined; a name clash throws. The
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
    for (const k of VALUE_CHECKS) if (prop[k] !== undefined) validation[k] = prop[k];
    if (ngsiType === 'VocabProperty') {
      validation = vocabValidation(validation, terms, `${model.type}.${name}`, `define its prefix or term in ${subject.name}/context.jsonld (or a context it imports), or write the full IRI${termsMissing}`, warn);
    }
    // A JsonProperty keeps its checks: GeonicDB applies them to the JSON itself.
    if (Object.keys(validation).length) d.validation = validation;
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
