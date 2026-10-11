// Tabular data (CSV) to entities, driven by a model's mapping file. The mapping
// rows that carry `column` (and optionally `transform`, `value`, `via`) say how
// to fill each attribute; the rest of the mapping stays documentation. Pure
// functions without Node imports; bin/datamodels.mjs is the command line.
// Moved from geolonia/datamodels (scripts/lib/convert.mjs, #91).
//
// Real published lists come in Shift_JIS as well as UTF-8, lose leading zeros
// in Excel (92011 for 092011) and put a whole address into one column (#85).
// The converter repairs what it can prove and reports every repair.

/**
 * Text of a CSV file: UTF-8 (with or without BOM), else Shift_JIS. A byte that
 * is invalid in the detected encoding throws instead of becoming U+FFFD.
 */
export function decodeCsv(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(3)), encoding: 'utf-8 (BOM)' }; } catch { throw new Error('the file starts with a UTF-8 BOM but is not valid UTF-8'); }
  }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' }; } catch { /* not UTF-8 */ }
  try { return { text: new TextDecoder('shift_jis', { fatal: true }).decode(b), encoding: 'shift_jis' }; } catch { throw new Error('neither valid UTF-8 nor valid Shift_JIS'); }
}

/** The source line a parsed row starts on (a key that is not a column). */
export const LINE = Symbol('line');

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside
 * quotes. Throws on what would otherwise shift or merge values silently: an
 * unclosed quote (a truncated file), text after a closing quote or a quote
 * inside an unquoted field, a missing or repeated header name, and a record
 * whose field count differs from the header's; surplus empty fields at the
 * end of a record, as spreadsheets write them, are allowed. Each row carries
 * its source line under LINE. A blank line is ignored; a record of empty fields
 * only (",,," as spreadsheets write empty rows, or "" in a one-column file) is
 * left out and its line listed in the result's `skipped`, so it does not
 * vanish unseen. The header names are in the result's `columns`.
 */
export function parseCsv(text) {
  const rows = [];
  // written: the record has a quote, so it is not a blank line even with one empty field ("" in a one-column file).
  let row = [], field = '', quoted = false, closed = false, written = false, line = 1, start = 1;
  const end = () => { row.push(field); rows.push({ fields: row, line: start, written }); row = []; field = ''; closed = false; written = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',') { row.push(field); field = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') { i++; line++; }
      end(); start = line;
    } else if (closed) throw new Error(`line ${line}: text after a closing quote`);
    else if (c === '"' && field === '') { quoted = true; written = true; }
    else if (c === '"') throw new Error(`line ${line}: a quote inside an unquoted field`);
    else field += c;
  }
  if (quoted) throw new Error(`line ${start}: a quoted field is not closed`);
  if (field !== '' || row.length || written) end();
  const blank = (r) => r.fields.every((v) => v.trim() === '');
  // A blank line is no record; a record of empty fields (",," or "") is one, left out and listed.
  const empty = (r) => blank(r) && (r.fields.length > 1 || r.written);
  const skipped = rows.filter(empty).map((r) => r.line);
  const [head, ...body] = rows.filter((r) => !blank(r));
  if (!head) throw new Error('no header row');
  const names = head.fields.map((h) => h.trim());
  const repeated = names.filter((h, i) => names.indexOf(h) !== i);
  if (names.some((h) => !h) || repeated.length) throw new Error(`line ${head.line}: header names must be present and distinct${repeated.length ? ` (repeated: ${[...new Set(repeated)].join(', ')})` : ''}`);
  const n = names.length;
  const bad = body.filter((r) => r.fields.length < n || r.fields.slice(n).some((v) => v.trim() !== ''));
  if (bad.length) throw new Error(`${bad.slice(0, 5).map((r) => `line ${r.line}: ${r.fields.length} fields`).join(', ')}${bad.length > 5 ? ` and ${bad.length - 5} more` : ''} (the header has ${n})`);
  const out = body.map((r) => Object.defineProperty(Object.fromEntries(names.map((h, i) => [h, r.fields[i].trim()])), LINE, { value: r.line }));
  return Object.defineProperties(out, { skipped: { value: skipped.filter((l) => l > head.line) }, columns: { value: names } });
}

// 全国地方公共団体コード: the 5-digit JIS X 0402 code plus a check digit (MIC,
// 全国地方公共団体コード仕様): weights 6..2, remainder mod 11, (11 - r) mod 10.
const checkDigit = (d5) => (11 - ([...d5].reduce((s, c, i) => s + Number(c) * (6 - i), 0) % 11)) % 10;
const prefectureOk = (code) => { const p = Number(code.slice(0, 2)); return p >= 1 && p <= 47; };
const valid6 = (c) => /^\d{6}$/.test(c) && prefectureOk(c) && checkDigit(c.slice(0, 5)) === Number(c[5]);

/**
 * A 6-digit local government code from what a list holds: 6 digits as they
 * are; 5 digits either a 6-digit code that lost its leading zero (92011 →
 * 092011) or a JIS code without its check digit (13101 → 131016), decided by
 * the check digit; 4 digits a JIS code that lost its leading zero (1100 → 011002).
 */
export function code6(v) {
  const s = String(v ?? '').trim();
  if (/^\d{6}$/.test(s)) return valid6(s) ? { value: s } : { problem: `${s}: check digit does not match` };
  if (/^\d{5}$/.test(s)) {
    const zero = `0${s}`, withDigit = `${s}${checkDigit(s)}`;
    const a = valid6(zero), b = prefectureOk(s);
    if (a && b) return { problem: `${s}: ambiguous (${zero} or ${withDigit})` };
    if (a) return { value: zero, fix: { repair: 'restored the leading zero', detail: `${s} → ${zero}` } };
    if (b) return { value: withDigit, fix: { repair: 'added the check digit', detail: `${s} → ${withDigit}` } };
  }
  if (/^\d{4}$/.test(s) && prefectureOk(`0${s}`)) { const c = `0${s}${checkDigit(`0${s}`)}`; return { value: c, fix: { repair: 'restored the leading zero and added the check digit', detail: `${s} → ${c}` } }; }
  return { problem: `${s}: not a local government code` };
}

export const TRANSFORMS = ['text', 'code6', 'number', 'integer', 'numbers', 'flag', 'flags', 'boolean', 'yesno', 'split', 'weekdays', 'time', 'geometry', 'json', 'municipality', 'machiazaId', 'nationalShelterType'];

// The transforms that take `values`, a list of the texts in a column and what each one becomes
// (flags takes values too, but as column: value).
const WITH_VALUES = ['text', 'split', 'yesno'];

/** Yes and no as Japanese lists write them: what transform yesno reads without `values`. */
export const YES_NO = Object.freeze({
  有: true, 有り: true, あり: true, アリ: true, はい: true, '○': true, '〇': true, '◯': true,
  無: false, 無し: false, なし: false, ナシ: false, いいえ: false, '×': false, '✕': false,
});

/** The days of the week as OpeningHours.dayOfWeek names them (schema.org DayOfWeek), Monday first, then public holidays. */
export const WEEKDAYS = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'PublicHolidays']);
const DAY_CHARS = '月火水木金土日';
// Words for more than one day, longest first so that 祝日 is not read as 祝 and 日 (Sunday).
const DAY_WORDS = [['祝祭日', [7]], ['祝日', [7]], ['祭日', [7]], ['祝', [7]], ['平日', [0, 1, 2, 3, 4]], ['毎日', [0, 1, 2, 3, 4, 5, 6]]];

/**
 * The days of a weekday text: 月～金, 月-金, 月火水木金, 月・水・金, 土日祝, 平日, 毎日,
 * 12345 as GIF writes them (1 is Monday, 7 Sunday), 月曜日～金曜日. A range wraps
 * (金～月 is Friday to Monday). 平日 is Monday to Friday and 毎日 the seven days;
 * public holidays (祝, 祝日) only when the text names them. Returns the day
 * names in WEEKDAYS order, or null for anything else (第2土曜, 月～金（祝日を除く）).
 */
export function weekdays(text) {
  const s = String(text ?? '').normalize('NFKC').replace(/曜日?/g, '').replace(/\s+/g, '');
  const tokens = [];
  for (let i = 0; i < s.length;) {
    const word = DAY_WORDS.find(([w]) => s.startsWith(w, i));
    if (word) { tokens.push({ days: word[1] }); i += word[0].length; continue; }
    const c = s[i++];
    if (DAY_CHARS.includes(c)) tokens.push({ day: DAY_CHARS.indexOf(c) });
    else if (/[1-7]/.test(c)) tokens.push({ day: Number(c) - 1 });
    else if (/[~〜\-ー−–]/.test(c)) tokens.push({ range: true });
    else if (/[・、,/]/.test(c)) tokens.push({ sep: true });
    else return null;
  }
  const out = new Set();
  for (let j = 0; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.sep) { if (!tokens[j - 1] || tokens[j - 1].sep || tokens[j - 1].range || !tokens[j + 1]) return null; continue; }
    if (t.range) {
      const [from, to] = [tokens[j - 1], tokens[j + 1]];
      // One day at each end, not the end of another range (月～水～金), and two different days.
      if (from?.day === undefined || to?.day === undefined || tokens[j - 2]?.range || from.day === to.day) return null;
      for (let d = from.day; d !== to.day; d = (d + 1) % 7) out.add(d);
      out.add(to.day);
      j++;
      continue;
    }
    for (const d of t.days ?? [t.day]) out.add(d);
  }
  return out.size ? [...out].sort((a, b) => a - b).map((d) => WEEKDAYS[d]) : null;
}

/**
 * A time as HH:MM (HH:MM:SS when the text has seconds): 9:00 → 09:00, 9時 → 09:00,
 * 9時30分 → 09:30, full-width digits and colon as half-width. 0:00 is 00:00, the
 * start of the day; 24:00 is the end of the day, which OpeningHours allows only as
 * a closing time (its schema rejects it as an opening time). Null for anything else.
 */
export function time(text) {
  const s = String(text ?? '').normalize('NFKC').trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s) ?? /^(\d{1,2})時(?:(\d{1,2})分)?$/.exec(s);
  if (!m) return null;
  const [h, min, sec] = [Number(m[1]), Number(m[2] ?? 0), m[3] === undefined ? undefined : Number(m[3])];
  if (min > 59 || sec > 59 || h > 24 || (h === 24 && (min || sec))) return null;
  return [h, min, ...(sec === undefined ? [] : [sec])].map((n) => String(n).padStart(2, '0')).join(':');
}

// How many columns a transform reads: [fewest, most]. Any other transform, and a rule without
// one, reads exactly one column; flags reads the columns of its values instead.
const COLUMNS = { numbers: [2, Infinity], geometry: [1, 3] };
const columnsRead = (transform) => COLUMNS[transform ?? 'text'] ?? (transform === 'flags' ? [] : [1, 1]);

/** A number a spreadsheet wrote in exponent form (1.31E+11): its digits are lost, so it cannot be an id. */
export const exponentForm = (v) => /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(String(v ?? '').trim());

// Every mapping a conversion uses: the mapping itself and those it reaches through via.
function reachable(mapping, mappings) {
  const out = [['', mapping]];
  const seen = new Set();
  for (let i = 0; i < out.length; i++) {
    for (const rule of Object.values(out[i][1].fields ?? {})) {
      if (!rule?.via || seen.has(rule.via) || !mappings[rule.via]) continue;
      seen.add(rule.via); out.push([rule.via, mappings[rule.via]]);
    }
  }
  return out;
}

/**
 * What is wrong with the conversion rules before any row is read: a transform
 * this converter does not know, or a via mapping that is missing. The catalog
 * checks only the structure of the rules (geolonia/datamodels#91); the names
 * of the transforms are checked here.
 */
export function mappingProblems(mapping, mappings = {}) {
  const out = [];
  const id = mapping?.convert?.id;
  if (id !== undefined && (typeof id !== 'string' || !/\{[\w.]+\}/.test(id))) out.push('convert.id must be a template such as "urn:ngsi-ld:Type:{attribute}"');
  for (const [name, map] of reachable(mapping, mappings)) {
    if (map?.fields !== undefined && (!map.fields || typeof map.fields !== 'object' || Array.isArray(map.fields))) { out.push(`${name ? `${name}: ` : ''}fields must map each attribute to a rule, such as name: { column: 名称 }`); continue; }
    for (const [field, rule] of Object.entries(map?.fields ?? {})) {
      const where = name ? `${name}: ${field}` : field;
      // An empty row (name: or name: {}) converts nothing, like a row with only to.
      if (rule === null) continue;
      if (typeof rule !== 'object' || Array.isArray(rule)) { out.push(`${where}: a rule must be a mapping, such as { column: 名称 }`); continue; }
      const cols = rule.column === undefined ? [] : [].concat(rule.column);
      if (rule.column !== undefined && (!cols.length || cols.some((c) => typeof c !== 'string' || !c.trim()))) out.push(`${where}: column must be a column name or a list of them`);
      if (rule.transform !== undefined && !TRANSFORMS.includes(rule.transform)) out.push(`${where}: unknown transform "${rule.transform}" (known: ${TRANSFORMS.join(', ')})`);
      const [min, max] = TRANSFORMS.includes(rule.transform ?? 'text') ? columnsRead(rule.transform) : [];
      const span = max === Infinity ? `at least ${min} columns` : min === max ? `exactly ${min} column` : `${min} to ${max} columns`;
      if (min && rule.column !== undefined && (cols.length < min || cols.length > max)) out.push(`${where}: ${rule.transform ? `transform ${rule.transform}` : 'a rule without a transform'} reads ${span}, got ${cols.length}`);
      if (rule.transform === 'flags' && (!rule.values || typeof rule.values !== 'object' || Array.isArray(rule.values))) out.push(`${where}: transform flags needs values, as column: value`);
      if (rule.values !== undefined && rule.transform !== 'flags') {
        if (!isObject(rule.values) || !Object.keys(rule.values).length) out.push(`${where}: values must give each text of the column its value, such as { 病院: hospital }`);
        else if (TRANSFORMS.includes(rule.transform ?? 'text') && !WITH_VALUES.includes(rule.transform ?? 'text')) out.push(`${where}: transform ${rule.transform} takes no values (values work without a transform, with split and with yesno)`);
        else if (rule.transform === 'yesno' && Object.values(rule.values).some((v) => typeof v !== 'boolean')) out.push(`${where}: the values of transform yesno must be true or false`);
      }
      if (rule.via && !mappings[rule.via]) out.push(`${where}: no mapping ${rule.via}`);
    }
  }
  return out;
}

/**
 * Field names of a mapping that are not attributes of the model: a typo would
 * otherwise be dropped by the schema without saying which row of the mapping
 * caused it. `address.postalCode` names a field of the address; its own fields
 * are checked by the schema. `id` is the entity id itself.
 */
export function unknownFields(mapping, schema) {
  const props = schema?.properties ?? {};
  return Object.keys(mapping?.fields ?? {}).filter((f) => f === 'type' || f === '@context' || !Object.hasOwn(props, f.split('.')[0])).map((f) => `${f}: not an attribute of ${schema?.title ?? 'the model'}`);
}

/** The columns a conversion reads, through via too: `column` names and the columns of `flags` values. */
export function mappedColumns(mapping, mappings = {}) {
  const cols = new Set();
  for (const [, map] of reachable(mapping, mappings)) {
    for (const rule of Object.values(map.fields ?? {})) {
      for (const c of [].concat(rule?.column ?? [])) cols.add(c);
      if (rule?.transform === 'flags') for (const c of Object.keys(rule.values ?? {})) cols.add(c);
    }
  }
  return [...cols];
}

const parseJson = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

// The texts a values list knows, for a problem: at most eight, the empty one left out.
const known = (values) => { const ks = Object.keys(values).filter(Boolean); return ks.length > 8 ? `${ks.slice(0, 8).join(', ')}, …` : ks.join(', '); };

/**
 * The value of a text in a values list ({ 病院: hospital }). An empty cell is no value,
 * unless the list gives the empty text one ("": false) and the file has the column.
 * A text the list does not have is a problem; it is never taken as it is.
 */
function listed(values, col, text, present, what) {
  if (text === '') return { value: present && Object.hasOwn(values, '') ? values[''] : undefined };
  return Object.hasOwn(values, text) ? { value: values[text] } : { problem: `${col}: ${text} ${what ?? `is not in values (${known(values)})`}` };
}

// One attribute from one row. Returns { value } (undefined means leave it out), and optionally fix or problem.
function apply(rule, row, set) {
  const cols = rule.column === undefined ? [] : [].concat(rule.column);
  const raw = cols.map((c) => row[c] ?? '');
  const one = raw[0] ?? '';
  const values = rule.transform !== 'flags' && isObject(rule.values) ? rule.values : undefined;
  switch (rule.transform ?? 'text') {
    case 'text': return values ? listed(values, cols[0], one, cols[0] in row) : { value: one || undefined };
    case 'code6': { if (!one) return { value: undefined }; const r = code6(one); return r.problem ? { problem: r.problem } : { value: r.value, fix: r.fix }; }
    case 'number': { if (!one) return { value: undefined }; const n = Number(one); return Number.isFinite(n) ? { value: n } : { problem: `${cols[0]}: ${one} is not a number` }; }
    case 'integer': { if (!one) return { value: undefined }; const n = Number(one.replace(/[,，人]/g, '')); return Number.isInteger(n) ? { value: n } : { problem: `${cols[0]}: ${one} is not a whole number` }; }
    case 'numbers': {
      if (raw.every((x) => !x)) return { value: undefined };
      const ns = raw.map(Number);
      return ns.every(Number.isFinite) && raw.every((x) => x) ? { value: ns } : { problem: `${cols.join(', ')}: not all numbers (${raw.join(', ')})` };
    }
    // Lists mark a flag with 1 and leave it empty (or 0) otherwise; anything else is reported, not read as false.
    // A column the file does not have says nothing: no value, not false (mappedColumns reports it).
    case 'flag': if (!(cols[0] in row)) return { value: undefined }; return one === '1' ? { value: true } : one === '' || one === '0' ? { value: false } : { problem: `${cols[0]}: ${one} is not 1, 0 or empty` };
    case 'flags': {
      const present = Object.keys(rule.values ?? {}).filter((c) => c in row);
      if (!present.length) return { value: undefined };
      const marks = present.filter((c) => !['1', '0', ''].includes(row[c]));
      if (marks.length) return { problem: marks.map((c) => `${c}: ${row[c]} is not 1, 0 or empty`).join('; ') };
      const vs = Object.entries(rule.values ?? {}).filter(([c]) => row[c] === '1').map(([, v]) => v);
      return { value: vs.length ? vs : undefined };
    }
    // true or false as a spreadsheet or Table Schema writes them; empty is no value (flag reads empty as false).
    case 'boolean': {
      if (!one) return { value: undefined };
      if (['true', 'True', 'TRUE', '1'].includes(one)) return { value: true };
      if (['false', 'False', 'FALSE', '0'].includes(one)) return { value: false };
      return { problem: `${cols[0]}: ${one} is not true or false` };
    }
    // 有 and 無, あり and なし, ○ and ×: a text that is neither is reported, never read as false; empty is no value.
    case 'yesno': return values ? listed(values, cols[0], one, cols[0] in row) : listed(YES_NO, cols[0], one, false, 'is not yes or no (有/無, 有り/無し, あり/なし, ○/×)');
    case 'weekdays': { if (!one) return { value: undefined }; const days = weekdays(one); return days ? { value: days } : { problem: `${cols[0]}: ${one} is not a list of weekdays (such as 月～金, 月火水木金, 土日祝)` }; }
    case 'time': {
      if (!one) return { value: undefined };
      const t = time(one);
      if (!t) return { problem: `${cols[0]}: ${one} is not a time (such as 9:00, 09:00 or 9時)` };
      return { value: t, fix: t !== one ? { repair: 'wrote the time as HH:MM', detail: `${one} → ${t}` } : undefined };
    }
    // Two columns, longitude and latitude, make a Point; one column holds a GeoJSON geometry; with three,
    // the third is the GeoJSON for rows without longitude and latitude (the CSV template's columns).
    case 'geometry': {
      const [lon = '', lat = '', geo = ''] = cols.length === 1 ? ['', '', one] : raw;
      if (lon || lat) {
        const xy = [Number(lon), Number(lat)];
        if (!lon || !lat || !xy.every(Number.isFinite)) return { problem: `${cols.slice(0, 2).join(', ')}: ${lon || '(empty)'}, ${lat || '(empty)'} is not a longitude and a latitude` };
        return { value: { type: 'Point', coordinates: xy } };
      }
      if (!geo) return { value: undefined };
      const g = parseJson(geo);
      return g && typeof g === 'object' && typeof g.type === 'string' && (Array.isArray(g.coordinates) || Array.isArray(g.geometries)) ? { value: g } : { problem: `${cols.at(-1)}: not a GeoJSON geometry` };
    }
    case 'json': { if (!one) return { value: undefined }; const v = parseJson(one); return v === undefined ? { problem: `${cols[0]}: not JSON` } : { value: v }; }
    case 'split': {
      const vs = one.split(/[;；]/).map((x) => x.trim()).filter(Boolean);
      if (!values || !vs.length) return { value: vs.length ? vs : undefined };
      const unknown = vs.filter((v) => !Object.hasOwn(values, v));
      return unknown.length ? { problem: `${cols[0]}: ${unknown.join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not in values (${known(values)})` } : { value: [...new Set(vs.map((v) => values[v]))] };
    }
    // A municipality name ends in 市, 区, 町 or 村; a value that goes on (宇都宮市中央本町1-29) is the rest of the address.
    case 'municipality': return !one ? { value: undefined } : /[市区町村]$/.test(one) ? { value: one } : { value: undefined, fix: { repair: `left out ${cols[0]}: not a municipality name`, detail: one } };
    // The Address Base Registry town id is 7 digits; lists write it as 0008-001.
    case 'machiazaId': { if (!one) return { value: undefined }; const d = one.replace(/-/g, ''); return /^\d{7}$/.test(d) ? { value: d, fix: d !== one ? { repair: 'removed the hyphen from the town id', detail: `${one} → ${d}` } : undefined } : { problem: `${cols[0]}: ${one} is not a 7-digit town id` }; }
    // 全国共通避難所・避難場所ID: E, 5-digit municipality, 5-digit facility, type code, sequence. Type 11 is a
    // general designated shelter, 12 a welfare one (Cabinet Office, 2024-11-07); anything else is no shelter ID.
    case 'nationalShelterType': { if (!one) return { value: undefined }; const m = /^E\d{10}1([12])[1-9A-Za-z]$/.exec(one); return m ? { value: m[1] === '1' ? 'general' : 'welfare' } : { problem: `${cols[0]}: ${one} is not the ID of a designated shelter (type code 11 or 12)` }; }
    default: return { problem: `unknown transform ${rule.transform}` };
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Two objects for the same value, merged; copies, as an object may be a value: of the mapping, the same for every row.
const merged = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObject(out[k]) && isObject(v) ? merged(out[k], v) : v;
  return out;
};

// A field name with a dot (address.postalCode) is a field of a value: the values are nested. The
// order of the fields does not matter: the shorter names go first, so a value: for a whole object
// and the fields named with a dot merge, and a field named with a dot, the more specific, wins.
function nest(flat, problems) {
  const out = {};
  const depth = (k) => k.split('.').length;
  for (const [key, value] of Object.entries(flat).sort(([a], [b]) => depth(a) - depth(b))) {
    const path = key.split('.');
    let at = out;
    for (const p of path.slice(0, -1)) {
      at[p] ??= {};
      if (!isObject(at[p])) { problems.push(`${key}: ${p} already has a value of its own`); at = null; break; }
      at[p] = { ...at[p] };
      at = at[p];
    }
    if (!at) continue;
    const last = path.at(-1);
    at[last] = isObject(at[last]) && isObject(value) ? merged(at[last], value) : isObject(value) ? { ...value } : value;
  }
  // The attributes in the order of the mapping, as before the sort.
  const order = [...new Set(Object.keys(flat).map((k) => k.split('.')[0]))];
  return Object.fromEntries(order.filter((k) => k in out).map((k) => [k, out[k]]));
}

const valueAt = (obj, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), obj);

/**
 * Entities from rows. `mapping` is the model's mapping file with `column`
 * rules; `mappings` resolves `via` names (subject/Type/mapping) to other
 * mapping files; `set` fills attributes the list does not carry (GSI's
 * municipality code from the file name) and goes through the same transform.
 * A field `id` gives the entity id as it is; otherwise the convert.id
 * template makes it. Ids in exponent form (1.31E+11) and ids that more than
 * one row gets are problems of those rows.
 * Returns one { entity, fixes, problems } per row; a fix is { field, repair, detail }.
 */
export function convertRows(rows, mapping, { type, mappings = {}, set = {} } = {}) {
  // chain: the via names being built, so a cycle is reported instead of recursing forever.
  const build = (map, row, fixes, problems, top, chain = []) => {
    const out = {};
    for (const [field, rule] of Object.entries(map.fields ?? {})) {
      if (rule?.value !== undefined) { out[field] = rule.value; continue; }
      if (rule?.via) {
        const sub = mappings[rule.via];
        if (!sub) { problems.push(`${field}: no mapping ${rule.via}`); continue; }
        if (chain.includes(rule.via)) { problems.push(`${field}: via cycle ${[...chain, rule.via].join(' → ')}`); continue; }
        const v = build(sub, row, fixes, problems, false, [...chain, rule.via]);
        const meaningful = Object.entries(v).some(([k]) => sub.fields[k]?.value === undefined);
        if (meaningful) out[field] = v;
        continue;
      }
      // --set fills what the list does not carry; a value the row has wins.
      const fromRow = rule?.column !== undefined || rule?.transform === 'flags' ? apply(rule, row) : { value: undefined };
      // flags come from several columns; --set has no form for them (the command line refuses it).
      const given = top && set[field] !== undefined && rule?.transform !== 'flags' && fromRow.value === undefined && !fromRow.problem;
      if (rule?.column === undefined && rule?.transform !== 'flags' && !given) continue;
      const r = given ? apply({ ...rule, column: '__set' }, { __set: String(set[field]) }) : fromRow;
      if (top && set[field] !== undefined && fromRow.value !== undefined) fixes.push({ field, repair: 'kept the value in the list over --set', detail: `${fromRow.value} (not ${set[field]})` });
      if (r.problem) problems.push(`${field}: ${r.problem}`);
      if (r.fix) fixes.push({ field, ...r.fix });
      if (r.value !== undefined) out[field] = r.value;
    }
    return nest(out, problems);
  };
  // The columns a value of the id comes from, followed through via and dotted field names, to see
  // the value as the list wrote it: a transform such as integer turns 1.31E+11 into 131000000000.
  const sourceColumns = (path) => {
    const parts = path.split('.');
    let map = mapping;
    // Each step takes at least one part of the path, so a via cycle cannot loop here.
    for (let i = 0; i < parts.length && map;) {
      // The longest dotted field name that matches (address.code before address).
      let j = parts.length;
      while (j > i && !Object.hasOwn(map.fields ?? {}, parts.slice(i, j).join('.'))) j--;
      if (j === i) return [];
      const rule = map.fields[parts.slice(i, j).join('.')];
      if (j === parts.length) return rule?.via ? [] : [].concat(rule?.column ?? []);
      if (!rule?.via) return [];
      map = mappings[rule.via];
      i = j;
    }
    return [];
  };
  const rawOf = (row, k) => sourceColumns(k).map((c) => row[c]);
  const results = rows.map((row) => {
    const fixes = [], problems = [];
    const { id: own, ...attrs } = build(mapping, row, fixes, problems, true);
    const all = { id: own, ...attrs };
    const tpl = mapping.convert?.id;
    let id;
    const rounded = (k) => [valueAt(all, k), ...rawOf(row, k)].find(exponentForm);
    if (tpl) {
      const missing = [], lost = [];
      // A template that is only one value takes it as it is (a whole id); inside a longer id a value is encoded.
      const whole = /^\{[\w.]+\}$/.test(tpl);
      id = tpl.replace(/\{([\w.]+)\}/g, (_, k) => {
        const v = valueAt(all, k);
        if (v === undefined) missing.push(k);
        if (rounded(k) !== undefined) lost.push(`${k} is ${rounded(k)}`);
        return whole ? String(v ?? '') : encodeURIComponent(String(v ?? ''));
      });
      if (missing.length) problems.push(`id: no ${missing.join(', ')} for ${tpl}`);
      if (lost.length) problems.push(`id: ${lost.join(', ')}, a number in exponent form: a spreadsheet rounded it and its digits are lost`);
      if (missing.length || lost.length) id = undefined;
    } else if (own !== undefined) {
      if (rounded('id') !== undefined) problems.push(`id: ${rounded('id')} is a number in exponent form: a spreadsheet rounded it and its digits are lost`);
      else id = String(own);
    } else problems.push('the mapping has no convert.id template');
    return { entity: { ...(id ? { id } : {}), type, ...attrs }, fixes, problems };
  });
  // The same id on several rows: a broker would keep only one of them, so every one of those rows is a problem.
  const where = (i) => (rows[i][LINE] ? `line ${rows[i][LINE]}` : `row ${i + 1}`);
  const byId = new Map();
  results.forEach((r, i) => {
    if (!r.entity.id) return;
    if (!byId.has(r.entity.id)) byId.set(r.entity.id, []);
    byId.get(r.entity.id).push(i);
  });
  for (const [id, at] of byId) {
    if (at.length < 2) continue;
    // A whole list can share one id: name at most five other rows, from the first six.
    for (const i of at) {
      const peers = at.slice(0, 6).filter((j) => j !== i).slice(0, 5);
      results[i].problems.push(`id: ${id} is not unique (also ${peers.map(where).join(', ')}${at.length > 6 ? `, and ${at.length - 6} more` : ''})`);
    }
  }
  return results;
}
