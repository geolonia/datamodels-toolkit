#!/usr/bin/env node
// datamodels: tools for the datamodels.jp catalog.
//
//   datamodels convert disaster/EvacuationSite jichitai-opendata-site 092011_evacuation_space.csv
//   datamodels convert disaster/EvacuationSite gsi-emergency-site 13101_2.csv --set localGovernmentCode=13101
//
// convert turns a published list (CSV) into entities of a catalog model, using
// the model's mapping file, and validates every entity against the model's
// schema. Options: --set attribute=value (for what the list does not carry,
// such as GSI's municipality from the file name), --normalized (NGSI-LD
// normalized form instead of key-values), --out file.json (default: standard
// output), --site URL or directory (default https://datamodels.jp). A summary
// (encoding, repairs, invalid rows) goes to standard error; the exit code is 1
// when a row is invalid or a file cannot be read, 2 for a usage error.
import { readFile, writeFile } from 'node:fs/promises';
import { decodeCsv, parseCsv, convertRows, LINE } from '../src/convert.mjs';
import { toNormalized } from '../src/ngsi.mjs';
import { siteReader, loadTarget, CORE_CONTEXT_URL, SITE } from '../src/catalog.mjs';

const USAGE = `usage: datamodels convert <subject>/<Type> <mapping> <file.csv> [--set attr=value]... [--normalized] [--out file.json] [--site URL|dir]`;
const args = process.argv.slice(2);
const usage = (msg) => { console.error(`${msg}\n${USAGE}`); process.exit(2); };
const command = args.shift();
if (command === '--help' || command === '-h' || command === 'help') { console.log(USAGE); process.exit(0); }
if (command !== 'convert') usage(command ? `unknown command ${command}` : 'missing command');

// An option's operand: present and not another option.
const operand = (name, i) => { const v = args[i + 1]; if (v === undefined || v.startsWith('-')) usage(`${name} needs a value`); args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : operand(name, i); };
const sets = []; for (let i = args.indexOf('--set'); i !== -1; i = args.indexOf('--set')) sets.push(operand('--set', i));
const out = flag('--out');
const site = flag('--site') ?? SITE;
const normalized = args.includes('--normalized') && args.splice(args.indexOf('--normalized'), 1);
const unknownOption = args.find((a) => a.startsWith('-'));
if (unknownOption) usage(`unknown option ${unknownOption}`);
const [target, mappingName, file, ...extra] = args;
if (sets.some((kv) => kv.indexOf('=') < 1)) usage('--set needs attribute=value');
if (!target || !mappingName || !file) usage('missing arguments');
if (extra.length) usage(`unexpected arguments: ${extra.join(' ')}`);

let loaded;
try { loaded = await loadTarget(siteReader(site), target, mappingName); } catch (e) { console.error(e.message); process.exit(1); }
const { entry, schema, mapping, mappings, validate, errorsText } = loaded;
const set = Object.fromEntries(sets.map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
// A name the mapping converts nothing into would be ignored without a word.
const settable = Object.keys(mapping.fields ?? {}).filter((k) => mapping.fields[k]?.via === undefined && mapping.fields[k]?.value === undefined && mapping.fields[k]?.transform !== 'flags');
const unknown = Object.keys(set).filter((k) => !settable.includes(k));
if (unknown.length) usage(`--set ${unknown.join(', ')}: not a field that ${mappingName} fills (${settable.join(', ')})`);

let text, encoding, rows;
try { ({ text, encoding } = decodeCsv(await readFile(file))); rows = parseCsv(text); } catch (e) { console.error(`${file}: ${e.message}`); process.exit(1); }
const results = convertRows(rows, mapping, { type: entry.type, mappings, set });

const invalid = [];
const invalidIndex = new Set();
const repairs = new Map();
for (const [i, r] of results.entries()) {
  for (const f of r.fixes) { const k = `${f.field}: ${f.repair}`; const e = repairs.get(k) ?? { n: 0, example: f.detail }; e.n++; repairs.set(k, e); }
  if (r.problems.length || !validate(r.entity)) { invalidIndex.add(i); invalid.push({ line: rows[i][LINE], problems: [...r.problems, ...(r.problems.length ? [] : [errorsText(validate.errors)])] }); }
}
const context = [entry.contextAliasUrl, CORE_CONTEXT_URL];
const entities = results.filter((_, i) => !invalidIndex.has(i)).map((r) => (normalized ? toNormalized(r.entity, schema, context) : r.entity));
const json = `${JSON.stringify(entities, null, 2)}\n`;
if (out) await writeFile(out, json); else process.stdout.write(json);

console.error(`${file}: ${encoding}, ${rows.length} row(s), ${entities.length} valid ${entry.type}, ${invalid.length} invalid`);
if (rows.skipped.length) console.error(`  skipped ${rows.skipped.length} record(s) with only empty fields: line ${rows.skipped.slice(0, 10).join(', ')}${rows.skipped.length > 10 ? ', …' : ''}`);
for (const [k, e] of repairs) console.error(`  repaired ${e.n}×: ${k} (e.g. ${e.example})`);
for (const x of invalid.slice(0, 20)) console.error(`  line ${x.line}: ${x.problems.join('; ')}`);
if (invalid.length > 20) console.error(`  … ${invalid.length - 20} more`);
// Not process.exit(): it can cut off output still being written to a pipe.
process.exitCode = invalid.length ? 1 : 0;
