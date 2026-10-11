// The fixed texts of a node's pages, per language. A language without its own
// texts gets the English ones; the node's own texts (titles, descriptions) are
// in its languages.
const en = {
  label: 'English', locale: 'en_US',
  dataModelsBy: (name) => `Data models by ${name}`,
  titleSep: ': ',
  introBefore: 'JSON Schemas, JSON-LD @contexts and RDFS vocabularies. Every model and its URLs are listed in ',
  introAfter: '.',
  version: 'Version', exactVersion: 'exact version: ', vocabulary: 'Vocabulary', namespace: 'Namespace',
  models: 'Models', terms: 'Terms', termsIntro: 'Every type and attribute this subject defines, under its IRI.',
  type: 'Type', attributeOf: (model) => `Attribute of ${model}`,
  stage: 'Stage', kind: 'Kind', typeIri: 'Type IRI', subclassOf: 'Subclass of', aliasOf: 'Another name for',
  standards: 'Standards referenced', mapping: 'mapping', notes: 'Notes',
  extendsLabel: 'Extends', index: 'index', example: 'Example', attributes: 'Attributes', required: 'required', any: 'any', noAttributes: 'None.',
  publishedBy: 'Published by ', machineReadable: 'Machine-readable files: ', licence: 'Licence: ',
  madeWith: 'Made with ', ownBefore: 'Publish your own data models: ', guide: 'the guide', guideUrl: 'https://datamodels.jp/en/guide/own-site',
  open: ' (', close: ')', comma: ', ', period: '.',
  kinds: { entity: 'entity', value: 'value type' },
  stages: { draft: 'draft', experimental: 'experimental', stable: 'stable', deprecated: 'deprecated' },
};

const ja = {
  label: '日本語', locale: 'ja_JP',
  dataModelsBy: (name) => `${name} のデータモデル`,
  titleSep: '：',
  introBefore: 'JSON Schema、JSON-LD の @context、RDFS の語彙です。すべてのモデルとその URL は ',
  introAfter: ' にあります。',
  version: 'バージョン', exactVersion: '正確なバージョン：', vocabulary: '語彙', namespace: '名前空間',
  models: 'モデル', terms: '用語', termsIntro: 'このサブジェクトが定める型と属性と、その IRI です。',
  type: '型', attributeOf: (model) => `${model} の属性`,
  stage: '段階', kind: '種類', typeIri: '型の IRI', subclassOf: '親クラス', aliasOf: '別名の元',
  standards: '参照している標準', mapping: '対応表', notes: '注記',
  extendsLabel: '拡張元', index: '索引', example: '例', attributes: '属性', required: '必須', any: '任意', noAttributes: 'ありません。',
  publishedBy: '公開：', machineReadable: '機械が読むファイル：', licence: 'ライセンス：',
  madeWith: '作成：', ownBefore: '自分のデータモデルを公開するには：', guide: 'ガイド', guideUrl: 'https://datamodels.jp/guide/own-site',
  open: '（', close: '）', comma: '、', period: '。',
  kinds: { entity: 'エンティティ', value: '値型' },
  stages: { draft: 'ドラフト', experimental: '試行', stable: '安定', deprecated: '非推奨' },
};

const TEXTS = { en, ja };

/** The fixed texts for `lang`, English where it has none of its own. */
// Open Graph locales need a territory (ja_JP); a language without one known here gets none.
export const pageTexts = (lang) => ({ ...en, ...(TEXTS[lang] ?? {}), label: TEXTS[lang]?.label ?? lang, locale: TEXTS[lang]?.locale ?? null });
