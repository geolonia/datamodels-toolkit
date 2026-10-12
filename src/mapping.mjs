// Mappings for lists of your own: the rules of the CSV template (the csv
// adapter's columns, which convert without a mapping file), and a first
// mapping file for any other CSV, for a person or an AI agent to finish
// (datamodels mapping). The rows it writes are the same conversion rules the
// catalog's mapping files use (src/convert.mjs), plus field names with a dot
// (address.postalCode) for the fields of a value, as the CSV template names them.
import { SITE, mappingUrl } from './catalog.mjs';
import { remoteModel } from './export.mjs';
import { readRefs, schemaPrefixes } from './adapters/index.mjs';
import { columnsOf, crossRules, scalarOf, shortTitle, textIn } from './adapters/model.mjs';
import { mappedColumns, WEEKDAYS, YES_NO } from './convert.mjs';

/** The mapping name for a CSV whose header is the model's CSV template (datamodels export --to csv). */
export const TEMPLATE = 'csv-template';

/**
 * A catalog model as the adapters read it, from a site reader (src/catalog.mjs):
 * { entry, model, languages, columns } with columns from columnsOf().
 */
export async function siteModel(reader, target) {
  const r = await remoteModel(target, `${SITE}/catalog.json`, (url) => reader.json(url));
  const fetch = async (url) => { const text = await reader.text(url); return { ok: true, status: 200, json: async () => JSON.parse(text) }; };
  const { refs, problems } = await readRefs([r.model], { entries: r.entries, fetch, trusted: schemaPrefixes(r.nodes) });
  if (problems.length) throw new Error(problems.join('\n'));
  if (r.model.kind !== 'entity') throw new Error(`${target} is a value type; a list converts into an entity type`);
  const entry = r.entries.find((m) => m.typeIri === r.model.links.typeIri);
  return { entry, model: r.model, languages: r.languages, columns: columnsOf(r.model, { refs }) };
}

/**
 * The fields of a value whose fields are plain values or lists of them, such
 * as OpeningHours (dayOfWeek is a list): [{ name, required, texts, prop, value | item }],
 * or null for any other value.
 */
function listParts(c) {
  const props = Object.entries(c.schema?.type === 'object' ? c.schema.properties ?? {} : {});
  const required = new Set(c.schema?.required ?? []);
  const parts = props.map(([name, p]) => {
    const base = { name, required: required.has(name), texts: c.partTexts?.[name] ?? (p.description ? { en: p.description } : {}), prop: p };
    const value = scalarOf(p);
    if (value) return { ...base, kind: 'scalar', value };
    const item = p?.type === 'array' ? scalarOf(p.items) : null;
    return item ? { ...base, kind: 'list', item } : null;
  });
  return parts.length && parts.every(Boolean) ? parts : null;
}

/**
 * What a row of a mapping can fill: an attribute, or a field of a value made
 * of plain fields (address.postalCode), as the CSV template splits it. With
 * `lists`, also a field of a value with lists among its fields
 * (openingHoursSpecification.dayOfWeek), which the CSV template keeps as one
 * JSON column, for the mappings that datamodels mapping writes.
 */
export function targetsOf(columns, { lists = false } = {}) {
  return columns.flatMap((c) => {
    if (c.kind === 'parts') return c.parts.map((p) => ({ name: `${c.name}.${p.name}`, part: p.name, attribute: c.name, kind: 'scalar', value: p.value, required: c.required && p.required, texts: p.texts, prop: p.prop }));
    const parts = lists && c.kind === 'json' ? listParts(c) : null;
    if (parts) return parts.map((p) => ({ ...p, name: `${c.name}.${p.name}`, part: p.name, attribute: c.name, required: c.required && p.required }));
    return [c];
  });
}

const pointOnly = (t) => t.geometryTypes.length === 1 && t.geometryTypes[0] === 'Point';
const BOOLEAN_WORDS = ['true', 'True', 'TRUE', 'false', 'False', 'FALSE'];
// A list of days of the week (OpeningHours.dayOfWeek).
const dayList = (item) => Array.isArray(item?.enum) && item.enum.length > 0 && item.enum.every((v) => WEEKDAYS.includes(v));
// A text whose pattern takes 09:00 and 17:30 but not 9:00: a time such as OpeningHours.opens.
const timeText = (value) => {
  if (value?.type !== 'string' || typeof value.pattern !== 'string') return false;
  try { const re = new RegExp(value.pattern, 'u'); return re.test('09:00') && re.test('17:30') && !re.test('9:00') && !re.test('09'); } catch { return false; }
};

/**
 * The transform a value of this kind needs. In the CSV template a boolean is
 * true or false; in other lists usually 1 or empty (flag), unless the sample
 * values are true and false (boolean) or 有 and 無 (yesno). A local government
 * code gets code6, which also repairs a lost leading zero. Outside the CSV
 * template, a list of weekdays gets weekdays and a time (HH:MM) gets time.
 */
function transformFor(t, { template = false, samples = [] } = {}) {
  if (t.kind === 'list') return !template && dayList(t.item) ? 'weekdays' : 'split';
  if (t.kind === 'json') return 'json';
  if (t.kind === 'geometry') return 'geometry';
  const type = t.value?.type;
  if (type === 'integer') return 'integer';
  if (type === 'number') return 'number';
  if (type === 'boolean') {
    if (template || (samples.length && samples.every((v) => BOOLEAN_WORDS.includes(v)))) return 'boolean';
    return samples.length && samples.every((v) => Object.hasOwn(YES_NO, v)) ? 'yesno' : 'flag';
  }
  if (!template && /localGovernmentCode$/i.test(t.part ?? t.name)) return 'code6';
  if (!template && timeText(t.value)) return 'time';
  return undefined;
}

/**
 * The transform of a catalog rule that has values but no transform: the values
 * do the mapping, so none (a transform for the type, such as integer, takes no
 * values), or yesno for a boolean whose values are all true or false.
 */
const valuesTransform = (t, values) => (t.value?.type === 'boolean' && Object.values(values).every((v) => typeof v === 'boolean') ? 'yesno' : undefined);

/** The rule of a geometry in the CSV template: longitude and latitude, and a GeoJSON column for other shapes. */
const templateGeometry = (t) => {
  const prefix = t.name === 'location' ? '' : `${t.name}.`;
  return [`${prefix}longitude`, `${prefix}latitude`, ...(pointOnly(t) ? [] : [t.name])];
};

/**
 * The rules of the CSV template: each column converts into the attribute or
 * field of the same name, with the transform its type needs; `id` is the
 * entity id as it is. The same columns as fieldsOf() (src/adapters/table-schema/).
 */
export function templateMapping(columns) {
  const fields = { id: { column: 'id' } };
  for (const t of targetsOf(columns)) {
    const transform = transformFor(t, { template: true });
    fields[t.name] = { column: t.kind === 'geometry' ? templateGeometry(t) : t.name, ...(transform ? { transform } : {}) };
  }
  return { fields };
}

/** The catalog's mappings of a model, with the mappings they reach through via: [{ name, mapping, mappings }]. Unreadable ones are left out and noted. */
export async function catalogMappings(reader, entry) {
  const out = [], notes = [];
  for (const url of entry.mappingUrls ?? []) {
    const name = url.split('/').pop().replace(/\.yaml$/, '');
    try {
      const mapping = await reader.yaml(url);
      const mappings = {};
      for (const rule of Object.values(mapping?.fields ?? {})) if (typeof rule?.via === 'string' && !(rule.via in mappings)) mappings[rule.via] = await reader.yaml(mappingUrl(rule.via));
      out.push({ name, mapping, mappings });
    } catch (e) { notes.push(`the catalog's mapping ${name} was not read (${e.message}), so its column names are not used`); }
  }
  return { mappings: out, notes };
}

// Text compared loosely: full-width as half-width, no case, no spaces, _, -, . or ・.
const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[\s_\-.・]/g, '');
// Hiragana, katakana and kanji: a Japanese header.
const cjk = (s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s);
const LONGITUDE = ['longitude', 'lon', 'lng', 'long', '経度'];
const LATITUDE = ['latitude', 'lat', '緯度'];
const GEOJSON = ['geojson', 'geometry', 'geom', 'thegeom'];

/** Names in brackets in a description: the catalog writes the source's column there, as in "Name of the site (名称)". */
const bracketed = (text) => [...String(text ?? '').matchAll(/[（(]([^）)]{1,30})[）)]/g)].map((m) => m[1]);

/**
 * How well a column fits a target, and why: 6 the same name, 4 the same name
 * written otherwise (postal_code), 3 the field's own name, a title or a
 * column named in the description, 1 a column that only shares part of the
 * Japanese title (a guess to check). 0 for no fit.
 */
function fit(t, col) {
  if (col === t.name) return 6;
  const c = norm(col);
  if (c === norm(t.name)) return 4;
  if (t.part && c === norm(t.part)) return 3;
  const titles = [t.texts?.ja, t.texts?.en].map(shortTitle).filter(Boolean);
  const names = [...titles, ...bracketed(t.prop?.description), ...Object.values(t.texts ?? {}).flatMap(bracketed)];
  if (names.some((n) => norm(n) === c)) return 3;
  const ja = shortTitle(t.texts?.ja);
  if (cjk(col) && col.length >= 2 && ja.length >= 2 && (ja.includes(col) || col.includes(ja))) return 1;
  return 0;
}

/** The candidate columns of a geometry: longitude and latitude, and a GeoJSON column. */
function geometryCandidates(t, header) {
  const exact = templateGeometry(t);
  const find = (names, own) => header.filter((h) => h === own || (t.name === 'location' && names.includes(norm(h))));
  const [lon, lat] = [find(LONGITUDE, exact[0]), find(LATITUDE, exact[1])];
  const geo = header.filter((h) => (!pointOnly(t) && h === t.name) || (t.name === 'location' && GEOJSON.includes(norm(h))));
  const out = [];
  const exactly = (cols) => cols.every((c, i) => c === exact[i]);
  if (lon.length === 1 && lat.length === 1) {
    const cols = [lon[0], lat[0], ...(!pointOnly(t) && geo.length === 1 ? [geo[0]] : [])];
    out.push({ score: exactly(cols) ? 6 : 4, cols });
  } else if (geo.length === 1) out.push({ score: geo[0] === t.name ? 6 : 3, cols: [geo[0]] });
  return out;
}

// What a catalog rule gives a row besides its column: the transform, and the values list of one column.
const ruleOf = (r) => ({ ...(r?.transform ? { transform: r.transform } : {}), ...(r?.values && typeof r.values === 'object' && !Array.isArray(r.values) ? { values: r.values } : {}) });

/** Candidates from the catalog's mappings of the model: a column they read for the same attribute (score 5), with its transform and values. */
function catalogCandidates(catalog, targets, header) {
  const out = [];
  const has = (c) => header.includes(c);
  const byName = new Map(targets.map((t) => [t.name, t]));
  for (const { name, mapping, mappings } of catalog) {
    for (const [field, rule] of Object.entries(mapping?.fields ?? {})) {
      const t = byName.get(field);
      if (rule?.via && mappings[rule.via]) {
        const sub = mappings[rule.via].fields ?? {};
        if (byName.get(field)?.kind === 'geometry') {
          const xy = sub.coordinates?.column;
          if (Array.isArray(xy) && xy.length === 2 && sub.coordinates.transform === 'numbers' && xy.every(has)) out.push({ score: 5, target: field, cols: xy, rule: { transform: 'geometry' }, from: name });
          continue;
        }
        for (const [part, r] of Object.entries(sub)) {
          const cols = [].concat(r?.column ?? []);
          if (cols.length === 1 && has(cols[0]) && byName.has(`${field}.${part}`)) out.push({ score: 5, target: `${field}.${part}`, cols, rule: ruleOf(r), from: name });
        }
        continue;
      }
      if (!t) continue;
      if (rule?.transform === 'flags' && rule.values && typeof rule.values === 'object') {
        const values = Object.fromEntries(Object.entries(rule.values).filter(([c]) => has(c)));
        if (Object.keys(values).length) out.push({ score: 5, target: field, cols: Object.keys(values), rule: { transform: 'flags', values }, from: name });
        continue;
      }
      const cols = [].concat(rule?.column ?? []);
      if (cols.length && cols.every(has)) out.push({ score: 5, target: field, cols, rule: ruleOf(rule), from: name });
    }
  }
  return out;
}

/**
 * Which column fills which target. The best fits are taken first; a column
 * that fits two targets equally well, or a target that two columns fit
 * equally well, is left to the person (`maybe`), and so is anything of a
 * lower fit that involves them.
 * Returns { chosen: Map(target → { cols, rule?, score, from? }), maybe: Map(target → [column]) }.
 */
export function matchColumns(targets, header, catalog = []) {
  const pairs = [...catalogCandidates(catalog, targets, header)];
  for (const t of targets) {
    if (t.kind === 'geometry') { for (const g of geometryCandidates(t, header)) pairs.push({ ...g, target: t.name }); continue; }
    for (const col of header) { const score = fit(t, col); if (score) pairs.push({ score, target: t.name, cols: [col] }); }
  }
  const chosen = new Map(), maybe = new Map(), used = new Set(), contested = new Set();
  const key = (p) => p.cols.join('\u0000');
  for (const score of [...new Set(pairs.map((p) => p.score))].sort((a, b) => b - a)) {
    const open = pairs.filter((p) => p.score === score && !chosen.has(p.target) && !contested.has(p.target) && p.cols.every((c) => !used.has(c) && !contested.has(c)));
    // The same columns for the same target from two sources count once.
    const forTarget = new Map(), forColumn = new Map();
    for (const p of open) {
      forTarget.set(p.target, new Set([...(forTarget.get(p.target) ?? []), key(p)]));
      for (const c of p.cols) forColumn.set(c, new Set([...(forColumn.get(c) ?? []), p.target]));
    }
    const clear = (p) => forTarget.get(p.target).size === 1 && p.cols.every((c) => forColumn.get(c).size === 1);
    for (const p of open) {
      if (chosen.has(p.target)) continue;
      if (clear(p)) { chosen.set(p.target, p); p.cols.forEach((c) => used.add(c)); continue; }
      maybe.set(p.target, [...new Set([...(maybe.get(p.target) ?? []), ...p.cols])]);
    }
    for (const p of open) if (!clear(p)) { contested.add(p.target); p.cols.forEach((c) => contested.add(c)); }
  }
  for (const t of chosen.keys()) maybe.delete(t);
  return { chosen, maybe };
}

const q = (s) => JSON.stringify(s);
/** A rule in YAML's flow form, every column name quoted. */
export function flowRule(rule) {
  const parts = Object.entries(rule).map(([k, v]) => {
    if (k === 'column') return `column: ${Array.isArray(v) ? `[${v.map(q).join(', ')}]` : q(v)}`;
    if (k === 'values') return `values: { ${Object.entries(v).map(([c, x]) => `${q(c)}: ${q(x)}`).join(', ')} }`;
    return `${k}: ${typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(v) ? v : q(v)}`;
  });
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

/** A description on one line of a comment, at most 120 characters. */
function oneLine(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
}

const allowed = (t) => {
  const v = t.kind === 'list' ? t.item : t.value;
  const list = [...(v?.enum ?? []), ...(v?.const !== undefined ? [v.const] : [])];
  return list.length && list.length <= 12 ? list : [];
};

const TEXTS = {
  en: {
    head: (csv, target, title) => `Mapping from ${csv} to ${target}${title ? ` (${title})` : ''}, started by datamodels mapping.`,
    rows: 'Each row under fields: an attribute of the model (address.postalCode: a field of the address) and where it comes from.',
    column: '  column     the column of the CSV (a location: longitude and latitude, or a column with GeoJSON)',
    transform: '  transform  how the text becomes the value; without one it is taken as it is (the README lists them)',
    value: '  value      one fixed value for every row, only when it is true for every row',
    todo: 'A row that says TODO has no column yet: write the column, or delete the row when the list has nothing for it.',
    never: 'Never write a value that is not in the list. Check, fix and check again until every row is valid:',
    then: 'Then convert:',
    catalog: (n, all, name) => `Your header has ${n} of the ${all} columns that the catalog's mapping ${name} reads.`,
    catalogUse: 'If your list follows that standard, you may not need this file:',
    idTemplate: 'The entity id: each {attribute} is that attribute\'s value in the row. The ids must differ between rows.',
    idFrom: (name) => `From the catalog's mapping ${name}.`,
    idTodo: (ex) => `TODO: which attributes tell the rows apart? Put them in braces${ex ? `, for example "${ex}"` : ''}.`,
    idColumn: 'The entity id: the id column as it is (a URI such as urn:ngsi-ld:Type:001).',
    allDay: (names) => `TODO: does the list write 0:00–0:00 (${names.join(', ')})? Say what it means: allDay: open (open all day, written 00:00–23:59) or allDay: closed (closed all day, 00:00–00:00). Delete this line when it does not.`,
    required: 'Required: every entity needs these.',
    atLeastOne: (names) => `At least one of ${names.join(', ')} is required.`,
    optional: 'Optional.',
    which: 'TODO: which column?',
    whichGeometry: 'TODO: which columns? longitude and latitude, or one column with a GeoJSON geometry.',
    maybe: (cols) => `maybe ${cols.join(', ')}`,
    guess: 'check: a guess from part of the name',
    from: (name) => `as in ${name}`,
    values: (list) => `values: ${list.join(', ')}`,
    unused: 'Columns of the CSV that no row above reads (they stay out of the entities):',
  },
  ja: {
    head: (csv, target, title) => `${csv} から ${target}${title ? `（${title}）` : ''} への対応表。datamodels mapping が書いた下書きです。`,
    rows: 'fields の各行：モデルの属性（address.postalCode は住所の項目）と、その値を取る列。',
    column: '  column     CSV の列名（位置は経度と緯度の 2 列、または GeoJSON の列）',
    transform: '  transform  文字をどう値にするか。無ければそのまま（一覧は README）',
    value: '  value      すべての行で同じ値。すべての行に当てはまるときだけ',
    todo: '列が見つからなかった行には TODO とあります。列名を書くか、一覧に無い項目なら行ごと消します。',
    never: '一覧に無い値は書きません。検証し、直し、すべての行が有効になるまで繰り返します：',
    then: 'それから変換します：',
    catalog: (n, all, name) => `見出し行に、カタログの対応表 ${name} が読む ${all} 列のうち ${n} 列があります。`,
    catalogUse: '一覧がその標準に従っているなら、このファイルは要らないかもしれません：',
    idTemplate: 'エンティティの ID：{属性} はその行の属性の値になります。ID は行ごとに違う必要があります。',
    idFrom: (name) => `カタログの対応表 ${name} と同じです。`,
    idTodo: (ex) => `TODO：どの属性で行を見分けますか？ 波括弧で書きます${ex ? `（例 "${ex}"）` : ''}。`,
    idColumn: 'エンティティの ID：id の列をそのまま使います（urn:ngsi-ld:Type:001 のような URI）。',
    allDay: (names) => `TODO：一覧に 0:00～0:00 はありますか（${names.join('、')}）？ 意味を書きます：allDay: open（終日利用可。00:00–23:59 と書く）か allDay: closed（終日利用不可。00:00–00:00）。無ければこの行を消します。`,
    required: '必須：どのエンティティにも要ります。',
    atLeastOne: (names) => `${names.join('、')} のどれか 1 つは必須です。`,
    optional: '任意。',
    which: 'TODO：どの列？',
    whichGeometry: 'TODO：どの列？ 経度と緯度、または GeoJSON のジオメトリの列。',
    maybe: (cols) => `候補 ${cols.join('、')}`,
    guess: '要確認：名前の一部からの推測',
    from: (name) => `${name} と同じ`,
    values: (list) => `値：${list.join(', ')}`,
    unused: 'どの行も読まない CSV の列（エンティティには入りません）：',
  },
};

/**
 * A first mapping file for a list: YAML text with one row per target, the
 * columns that fit, suggested transforms and a one-line comment on each part.
 * `header` and `rows` are the parsed CSV (parseCsv); `catalog` the model's
 * catalog mappings (catalogMappings). `csv` and `out` are the paths the
 * comments name in the commands to run next.
 * Returns { text, targets, chosen, todos, unused, hints, idTodo, allDayTodo }.
 */
export function startMapping({ target, entry, model, languages, columns, header, rows = [], catalog = [], csv, out }) {
  const lang = header.some(cjk) && languages.includes('ja') ? 'ja' : 'en';
  const T = TEXTS[lang];
  const targets = targetsOf(columns, { lists: true });
  const { chosen, maybe } = matchColumns(targets, header, catalog);
  const samples = (col) => rows.slice(0, 50).map((r) => r[col]).filter((v) => v !== undefined && v !== '');
  const describe = (t) => textIn(t.texts, lang, languages);

  // The id: a column named id as the CSV template has it, else a catalog mapping's template whose values all have a column.
  const idColumn = header.includes('id') && !targets.some((t) => t.name === 'id');
  // Only a value that is mapped itself: {address} with only address.addressLocality mapped would be an object in the id.
  const fromCatalog = catalog.find((c) => typeof c.mapping?.convert?.id === 'string' && [...c.mapping.convert.id.matchAll(/\{([\w.]+)\}/g)].every((m) => chosen.has(m[1])));
  const idLike = [...chosen.keys()].find((k) => /(Id|ID)$/.test(k) && !k.includes('.'));
  // Values with an opening and a closing time, such as the opening hours: what 0:00–0:00 means is the list's to say (convert.allDay).
  const hours = [...new Set(targets.filter((t) => t.part === 'opens').map((t) => t.attribute))].filter((a) => targets.some((t) => t.attribute === a && t.part === 'closes'));

  const lines = [];
  const comment = (text) => lines.push(`# ${text}`);
  const mapping = out ?? 'mapping.yaml';
  const command = `datamodels convert ${target} ${mapping} ${csv}`;
  comment(T.head(csv, target, textIn(entry?.title, lang, languages)));
  comment(T.rows);
  comment(T.column);
  comment(T.transform);
  comment(T.value);
  comment(T.todo);
  comment(T.never);
  comment(`  ${command} --check`);
  comment(T.then);
  comment(`  ${command} --out entities.json`);

  // A catalog mapping whose columns are nearly all in the header: the list probably follows its standard.
  const hints = catalog.map((c) => {
    const cols = mappedColumns(c.mapping, c.mappings);
    return { name: c.name, n: cols.filter((x) => header.includes(x)).length, all: cols.length };
  }).filter((h) => h.all && h.n / h.all >= 0.8).sort((a, b) => b.n / b.all - a.n / a.all);
  if (hints[0]) {
    lines.push('');
    comment(T.catalog(hints[0].n, hints[0].all, hints[0].name));
    comment(T.catalogUse);
    comment(`  datamodels convert ${target} ${hints[0].name} ${csv} --check`);
  }

  lines.push('');
  if (idColumn) {
    comment(T.idColumn);
    if (hours.length) lines.push('convert:');
  } else {
    comment(T.idTemplate);
    lines.push('convert:');
    if (fromCatalog) {
      lines.push(`  # ${T.idFrom(fromCatalog.name)}`);
      lines.push(`  id: ${q(fromCatalog.mapping.convert.id)}`);
    } else {
      lines.push(`  # ${T.idTodo(idLike ? `urn:ngsi-ld:${model.type}:{${idLike}}` : '')}`);
      lines.push(`  id: ${q(`urn:ngsi-ld:${model.type}:{TODO}`)}`);
    }
  }
  if (hours.length) lines.push(`  # ${T.allDay(hours)}`);

  lines.push('', 'fields:');
  if (idColumn) lines.push(`  id: ${flowRule({ column: 'id' })}`);
  const rules = crossRules(model.schema);
  const grouped = new Set(rules.atLeastOne.flat());
  const required = targets.filter((t) => t.required);
  const groups = rules.atLeastOne.map((g) => targets.filter((t) => g.includes(t.name) && !t.required));
  const rest = targets.filter((t) => !t.required && !grouped.has(t.name));
  const todos = [];
  const row = (t) => {
    const c = chosen.get(t.name);
    const notes = [];
    let rule;
    if (c) {
      const transform = c.rule?.transform ?? (c.rule?.values ? valuesTransform(t, c.rule.values) : transformFor(t, { samples: samples(c.cols[0]) }));
      rule = { column: c.cols.length === 1 && t.kind !== 'geometry' ? c.cols[0] : c.cols, ...(transform ? { transform } : {}), ...(c.rule?.values ? { values: c.rule.values } : {}) };
      if (c.rule?.transform === 'flags') delete rule.column;
      if (c.from) notes.push(T.from(c.from));
      if (c.score === 1) notes.push(T.guess);
    } else {
      const transform = transformFor(t);
      rule = transform ? { transform } : {};
      notes.push(t.kind === 'geometry' ? T.whichGeometry : T.which);
      if (maybe.has(t.name)) notes.push(T.maybe(maybe.get(t.name)));
      todos.push(t.name);
    }
    const d = oneLine(describe(t));
    if (d) notes.push(d);
    if (allowed(t).length) notes.push(T.values(allowed(t)));
    lines.push(`  ${t.name}: ${flowRule(rule)}  # ${notes.join('; ')}`);
  };
  if (required.length) { lines.push(`  # ${T.required}`); required.forEach(row); }
  rules.atLeastOne.forEach((g, i) => { if (groups[i].length) { lines.push(`  # ${T.atLeastOne(g)}`); groups[i].forEach(row); } });
  if (rest.length) { lines.push(`  # ${T.optional}`); rest.forEach(row); }

  const read = new Set([...chosen.values()].flatMap((c) => c.cols));
  if (idColumn) read.add('id');
  const unused = header.filter((h) => !read.has(h));
  if (unused.length) {
    lines.push('');
    comment(T.unused);
    for (const h of unused) comment(`  ${h}`);
  }
  return { text: `${lines.join('\n')}\n`, targets, chosen, todos, unused, hints, idTodo: !idColumn && !fromCatalog, allDayTodo: hours.length > 0 };
}
