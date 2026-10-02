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
 * only (",,,", as spreadsheets write empty rows) is left out and its line listed
 * in the result's `skipped`, so it does not vanish unseen. The header names are
 * in the result's `columns`.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false, line = 1, start = 1;
  const end = () => { row.push(field); rows.push({ fields: row, line: start }); row = []; field = ''; closed = false; };
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
    else if (c === '"' && field === '') quoted = true;
    else if (c === '"') throw new Error(`line ${line}: a quote inside an unquoted field`);
    else field += c;
  }
  if (quoted) throw new Error(`line ${start}: a quoted field is not closed`);
  if (field !== '' || row.length) end();
  const blank = (r) => r.fields.every((v) => v.trim() === '');
  const skipped = rows.filter((r) => blank(r) && r.fields.length > 1).map((r) => r.line);
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

export const TRANSFORMS = ['text', 'code6', 'number', 'integer', 'numbers', 'flag', 'flags', 'split', 'municipality', 'machiazaId', 'nationalShelterType'];

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
  for (const [name, map] of reachable(mapping, mappings)) {
    for (const [field, rule] of Object.entries(map.fields ?? {})) {
      const where = name ? `${name}: ${field}` : field;
      if (rule?.transform !== undefined && !TRANSFORMS.includes(rule.transform)) out.push(`${where}: unknown transform "${rule.transform}" (known: ${TRANSFORMS.join(', ')})`);
      if (rule?.via && !mappings[rule.via]) out.push(`${where}: no mapping ${rule.via}`);
    }
  }
  return out;
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

// One attribute from one row. Returns { value } (undefined means leave it out), and optionally fix or problem.
function apply(rule, row, set) {
  const cols = rule.column === undefined ? [] : [].concat(rule.column);
  const raw = cols.map((c) => row[c] ?? '');
  const one = raw[0] ?? '';
  switch (rule.transform ?? 'text') {
    case 'text': return { value: one || undefined };
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
    case 'split': { const vs = one.split(/[;；]/).map((x) => x.trim()).filter(Boolean); return { value: vs.length ? vs : undefined }; }
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

/**
 * Entities from rows. `mapping` is the model's mapping file with `column`
 * rules; `mappings` resolves `via` names (subject/Type/mapping) to other
 * mapping files; `set` fills attributes the list does not carry (GSI's
 * municipality code from the file name) and goes through the same transform.
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
    return out;
  };
  return rows.map((row) => {
    const fixes = [], problems = [];
    const attrs = build(mapping, row, fixes, problems, true);
    const tpl = mapping.convert?.id;
    let id;
    if (tpl) {
      const missing = [];
      id = tpl.replace(/\{(\w+)\}/g, (_, k) => { if (attrs[k] === undefined) missing.push(k); return encodeURIComponent(String(attrs[k] ?? '')); });
      if (missing.length) { problems.push(`id: no ${missing.join(', ')} for ${tpl}`); id = undefined; }
    } else problems.push('the mapping has no convert.id template');
    return { entity: { ...(id ? { id } : {}), type, ...attrs }, fixes, problems };
  });
}
