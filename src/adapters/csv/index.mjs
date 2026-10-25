// CSV adapter: the header row of a CSV file for an entity model, the columns of
// its Table Schema (the table-schema adapter) in the same order. Open it in a
// spreadsheet, add one row per entity, save it as CSV (UTF-8), and check it
// with the Table Schema.
import { adapterUrl } from '../model.mjs';
import { fieldsOf } from '../table-schema/index.mjs';

/**
 * One CSV field. The names come from a schema, maybe another catalog's
 * (datamodels export), so they are encoded rather than trusted: a field with a
 * comma, quote or line break is quoted (RFC 4180), and one a spreadsheet would
 * read as a formula (=, +, -, @, tab, CR or LF first) gets a leading ' (OWASP CSV
 * injection). An ordinary attribute name stays as it is.
 */
export function csvField(value) {
  let v = String(value);
  if (/^[=+\-@\t\r\n]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

/** The header row: the column names, each a CSV field, separated by commas. */
export function csvHeader(subject, model, context) {
  return fieldsOf(subject, model, context).map((f) => csvField(f.name)).join(',');
}

export default {
  name: 'csv',
  label: { ja: 'CSV テンプレート', en: 'CSV template' },
  note: {
    ja: '見出し行だけの CSV。表計算ソフトで 1 行に 1 件ずつ入力し、Table Schema で検証できます。経度と緯度は WGS 84、リストは ; 区切りです。',
    en: 'A CSV file with only the header row: fill in one row per entity in a spreadsheet and check it with the Table Schema. Longitude and latitude are WGS 84; list values are separated by ;.',
  },
  urlFor: adapterUrl('csv', 'csv'),
  content: (subject, model, context) => `${csvHeader(subject, model, context)}\n`,
};
