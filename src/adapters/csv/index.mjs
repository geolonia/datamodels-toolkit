// CSV adapter: the header row of a CSV file for an entity model, the columns of
// its Table Schema (the table-schema adapter) in the same order. Open it in a
// spreadsheet, add one row per entity, save it as CSV (UTF-8), and check it
// with the Table Schema.
import { adapterUrl } from '../model.mjs';
import { fieldsOf } from '../table-schema/index.mjs';

/** The header row: column names separated by commas (no name needs quotes: they are attribute names). */
export function csvHeader(subject, model, context) {
  return fieldsOf(subject, model, context).map((f) => f.name).join(',');
}

export default {
  name: 'csv',
  label: { ja: 'CSV テンプレート', en: 'CSV template' },
  note: {
    ja: '見出し行だけの CSV。表計算ソフトで 1 行に 1 件ずつ入力し、Table Schema で検査できます。経度と緯度は WGS 84、リストは ; 区切りです。',
    en: 'A CSV file with only the header row: fill in one row per entity in a spreadsheet and check it with the Table Schema. Longitude and latitude are WGS 84; list values are separated by ;.',
  },
  // How to use the file, for the node's /adapters/ page.
  use: {
    ja: '表計算ソフトで開き、1 行に 1 件ずつ入力して、CSV（UTF-8）で保存します。そのあと Table Schema で検査し、datamodels convert でモデルのエンティティに変換します。',
    en: 'Open it in a spreadsheet, add one row per entity and save it as CSV (UTF-8). Then check it with the Table Schema and turn it into entities of the model with datamodels convert.',
  },
  urlFor: adapterUrl('csv', 'csv'),
  content: (subject, model, context) => `${csvHeader(subject, model, context)}\n`,
};
