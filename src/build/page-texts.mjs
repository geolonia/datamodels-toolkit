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
  models: 'Models', terms: 'Terms', termsIntro: 'Every type and attribute this subject defines. A term\'s IRI begins with the namespace, for example ',
  type: 'Type', attributeOf: (model) => `Attribute of ${model}`,
  stage: 'Stage', kind: 'Kind', typeIri: 'Type IRI', subclassOf: 'Subclass of', aliasOf: 'Another name for',
  standards: 'Standards referenced', mapping: 'mapping', notes: 'Notes',
  extendsLabel: 'Extends', index: 'index', example: 'Example', attributes: 'Attributes', required: 'required', any: 'any', noAttributes: 'None.',
  publishedBy: 'Published by ',
  madeWith: 'Made with ', ownBefore: 'Publish your own data models: ', guide: 'the guide', guideUrl: 'https://datamodels.jp/en/toolkit/',
  // What the files of the Download row are: explained once, on datamodels.jp, not on every node.
  aboutFilesUrl: 'https://datamodels.jp/en/adapters/#downloads',
  // Every version listed, not a range: a model can leave and come back.
  formerModel: (type, subject, versions) => `${type} was a model of ${subject} in ${versions.length > 1 ? `versions ${versions.slice(0, -1).join(', ')} and ${versions.at(-1)}` : `version ${versions[0]}`}. The current version no longer has it; its files stay online.`,
  renamedBefore: 'The same type is now named ', renamedAfter: '.', currentModels: 'The current models of this subject: ',
  formerTerms: 'Terms of earlier versions', formerTermsIntro: 'Terms that earlier versions of this subject defined and the current one does not. Their IRIs stay valid; the vocabulary of the version describes them.',
  downloads: 'Download', aboutFiles: 'About these files',
  notFound: 'Not found',
  notFoundText: 'There is no page at this address. Pages can move, for example when a new version of a subject renames a model. The models of this site are listed below and in catalog.json.',
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
  models: 'モデル', terms: '用語', termsIntro: 'この分野が定める型と属性です。用語の IRI は、名前空間で始まります。例：',
  type: '型', attributeOf: (model) => `${model} の属性`,
  stage: '段階', kind: '種類', typeIri: '型の IRI', subclassOf: '親クラス', aliasOf: '別名の元',
  standards: '参照している標準', mapping: '対応表', notes: '注記',
  extendsLabel: '拡張元', index: '索引', example: '例', attributes: '属性', required: '必須', any: '任意', noAttributes: 'ありません。',
  publishedBy: '公開：',
  madeWith: '作成：', ownBefore: '自分のデータモデルを公開するには：', guide: 'ガイド', guideUrl: 'https://datamodels.jp/toolkit/',
  aboutFilesUrl: 'https://datamodels.jp/adapters/#downloads',
  formerModel: (type, subject, versions) => `${type} は、${subject} のバージョン ${versions.join('、')} のモデルでした。現在の版にはありません。ファイルは公開したままです。`,
  renamedBefore: '同じ型は、現在 ', renamedAfter: ' という名前です。', currentModels: 'この分野の現在のモデル：',
  formerTerms: '以前の版の用語', formerTermsIntro: 'この分野の以前の版が定めていて、現在の版には無い用語です。IRI はそのまま有効で、その版の語彙に説明があります。',
  downloads: 'ダウンロード', aboutFiles: 'これらのファイルについて',
  notFound: 'ページが見つかりません',
  notFoundText: 'このアドレスにページはありません。分野の新しい版でモデルの名前が変わったときなどに、ページが移ることがあります。このサイトのモデルは、下と catalog.json にあります。',
  open: '（', close: '）', comma: '、', period: '。',
  kinds: { entity: 'エンティティ', value: '値型' },
  stages: { draft: 'ドラフト', experimental: '試行', stable: '安定', deprecated: '非推奨' },
};

const TEXTS = { en, ja };

/** The fixed texts for `lang`, English where it has none of its own. */
// Open Graph locales need a territory (ja_JP); a language without one known here gets none.
// textLang: the language the fixed texts are actually in (English for a language without its own).
export const pageTexts = (lang) => ({ ...en, ...(TEXTS[lang] ?? {}), label: TEXTS[lang]?.label ?? lang, locale: TEXTS[lang]?.locale ?? null, textLang: TEXTS[lang] ? lang : 'en' });
