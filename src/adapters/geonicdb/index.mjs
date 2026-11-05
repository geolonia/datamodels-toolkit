// GeonicDB adapter: a ready-made Custom Data Model request body per entity
// model, at /adapters/geonicdb/<subject>/<Type>.json. POST it to GeonicDB's
// /custom-data-models, or give its URL as `sourceUrl`.
//
// A product adapter: off unless the node turns it on (node.yaml:
// `adapters: [geonicdb]`), and, like the other adapters, never on model pages
// (they stay product-neutral). `context.terms` (nodeAdapters, exportModel)
// has the terms of each subject's context, for VocabProperty terms.
import { adapterUrl } from '../model.mjs';
import { toCustomDataModel } from './custom-data-model.mjs';

export default {
  name: 'geonicdb',
  product: true,
  label: { ja: 'GeonicDB', en: 'GeonicDB' },
  note: {
    ja: 'GeonicDB（Geolonia の NGSI-LD ブローカー）に登録する Custom Data Model の request body。`contextUrl` を含みます。',
    en: 'Custom Data Model request bodies for GeonicDB, Geolonia\'s NGSI-LD broker, with `contextUrl` included.',
  },
  urlFor: adapterUrl('geonicdb', 'json'),
  content(subject, model, context) {
    return JSON.stringify(toCustomDataModel(subject, model, context), null, 2) + '\n';
  },
};
