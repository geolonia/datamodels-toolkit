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
import { Command, InvalidArgumentError } from 'commander';
import { decodeCsv, parseCsv, convertRows, mappingProblems, mappedColumns, LINE } from '../src/convert.mjs';
import { toNormalized } from '../src/ngsi.mjs';
import { siteReader, loadTarget, CORE_CONTEXT_URL, SITE } from '../src/catalog.mjs';

const USAGE = `usage: datamodels convert <subject>/<Type> <mapping> <file.csv> [--set attr=value]... [--normalized] [--out file.json] [--site URL|dir]`;
// An error the command reports in one line and exits with. Nothing calls
// process.exit(): it can cut off output still being written to a pipe.
class Exit extends Error { constructor(code, message) { super(message); this.code = code; } }
const usage = (msg) => { throw new Exit(2, `${msg}\n${USAGE}`); };
const fail = (msg) => { throw new Exit(1, msg); };

// The command line, with commander (#9). Its own messages are replaced by the
// one-line errors above, so scripts see the same text and exit codes as before.
function program(onConvert) {
  // An option's value: present, not empty (--out=) and not another option.
  const value = (name) => (v) => { if (v === '' || v.startsWith('-')) throw new InvalidArgumentError(`${name} needs a value`); return v; };
  const cli = new Command('datamodels')
    .exitOverride()
    .configureOutput({ outputError: () => {} })
    .configureHelp({ styleTitle: (title) => title.toLowerCase() });
  cli.command('convert')
    .description('turn a published list (CSV) into entities of a catalog model, validated against its JSON Schema')
    .usage(USAGE.replace('usage: datamodels convert ', ''))
    .argument('<subject/Type>', 'the model, as on its page, for example disaster/EvacuationSite')
    .argument('<mapping>', "one of the model's mapping files")
    .argument('<file.csv>', 'the list, UTF-8 or Shift_JIS')
    // In the words of the README; the README has the details and examples.
    .option('--set <attribute=value>', "a value the list does not carry, such as GSI's municipality code", (v, all = []) => [...all, value('--set')(v)])
    .option('--normalized', 'NGSI-LD normalized form instead of key-values')
    .option('--out <file.json>', 'write to a file (default: standard output)', value('--out'))
    .option('--site <URL|dir>', 'where to read the catalog, or a directory laid out like the site', value('--site'), SITE)
    .addHelpText('after', '\nMore on each option, with examples: https://github.com/geolonia/datamodels-toolkit#readme')
    // exitOverride, the output and the help style are inherited from cli.
    .action(onConvert);
  return cli;
}

// commander's errors as this command's one-line errors (exit code 2).
function usageError(e, cli) {
  const convert = cli.commands.find((c) => c.name() === 'convert');
  switch (e.code) {
    case 'commander.unknownCommand': return usage(`unknown command ${/'([^']+)'/.exec(e.message)?.[1] ?? ''}`);
    case 'commander.unknownOption': return usage(`unknown option ${/'([^']+)'/.exec(e.message)?.[1] ?? ''}`);
    case 'commander.missingArgument': return usage('missing arguments');
    case 'commander.excessArguments': return usage(`unexpected arguments: ${convert.args.slice(3).join(' ')}`);
    case 'commander.optionMissingArgument': return usage(`${/'(--[a-z]+)/.exec(e.message)?.[1] ?? 'an option'} needs a value`);
    // Our own message, after commander's "option '…' argument '…' is invalid.".
    case 'commander.invalidArgument': return usage(e.message.split('is invalid. ').pop());
    default: return usage(e.message.replace(/^error: /, ''));
  }
}

async function main(args) {
  let code = 0;
  const cli = program(async (target, mappingName, file, options) => { code = await convert(target, mappingName, file, options); });
  // One command so far: datamodels --help shows its help.
  if (['--help', '-h', 'help'].includes(args[0])) { cli.commands.find((c) => c.name() === 'convert').outputHelp(); return 0; }
  if (!args.length) usage('missing command');
  try {
    await cli.parseAsync(args, { from: 'user' });
  } catch (e) {
    if (e instanceof Exit) throw e;
    if (e.code === 'commander.helpDisplayed' || e.code === 'commander.help') return 0;
    if (typeof e.code === 'string' && e.code.startsWith('commander.')) usageError(e, cli);
    throw e;
  }
  return code;
}

async function convert(target, mappingName, file, { set: sets = [], normalized, out, site }) {
  if (sets.some((kv) => kv.indexOf('=') < 1)) usage('--set needs attribute=value');

  let loaded;
  try { loaded = await loadTarget(siteReader(site), target, mappingName); } catch (e) { fail(e.message); }
  const { entry, schema, mapping, mappings, validate, errorsText } = loaded;
  // Rules this converter cannot apply stop the run before any row is read.
  const ruleProblems = mappingProblems(mapping, mappings);
  if (ruleProblems.length) fail(`${target} ${mappingName}: the mapping cannot be applied:\n${ruleProblems.map((p) => `  ${p}`).join('\n')}`);
  const set = Object.fromEntries(sets.map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
  // A name the mapping converts nothing into would be ignored without a word.
  const settable = Object.keys(mapping.fields ?? {}).filter((k) => mapping.fields[k]?.via === undefined && mapping.fields[k]?.value === undefined && mapping.fields[k]?.transform !== 'flags');
  const unknown = Object.keys(set).filter((k) => !settable.includes(k));
  if (unknown.length) usage(`--set ${unknown.join(', ')}: not a field that ${mappingName} fills (${settable.join(', ')})`);

  let text, encoding, rows;
  try { ({ text, encoding } = decodeCsv(await readFile(file))); rows = parseCsv(text); } catch (e) { fail(`${file}: ${e.message}`); }
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
  if (out) {
    try { await writeFile(out, json); } catch (e) { fail(`${out}: ${e.code ?? e.message}`); }
  } else process.stdout.write(json);

  console.error(`${file}: ${encoding}, ${rows.length} row(s), ${entities.length} valid ${entry.type}, ${invalid.length} invalid`);
  // Columns the mapping reads that the file does not have: their attributes stay empty, unless --set fills them.
  const filled = new Set(Object.keys(set).flatMap((k) => [].concat(mapping.fields[k]?.column ?? [])));
  const absent = mappedColumns(mapping, mappings).filter((c) => !rows.columns.includes(c) && !filled.has(c));
  if (absent.length) console.error(`  not in the file, so left empty: ${absent.join(', ')}`);
  if (rows.skipped.length) console.error(`  skipped ${rows.skipped.length} record(s) with only empty fields: line ${rows.skipped.slice(0, 10).join(', ')}${rows.skipped.length > 10 ? ', …' : ''}`);
  for (const [k, e] of repairs) console.error(`  repaired ${e.n}×: ${k} (e.g. ${e.example})`);
  for (const x of invalid.slice(0, 20)) console.error(`  line ${x.line}: ${x.problems.join('; ')}`);
  if (invalid.length > 20) console.error(`  … ${invalid.length - 20} more`);
  return invalid.length ? 1 : 0;
}

try { process.exitCode = await main(process.argv.slice(2)); } catch (e) {
  if (!(e instanceof Exit)) throw e;
  console.error(e.message);
  process.exitCode = e.code;
}
