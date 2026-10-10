#!/usr/bin/env node
// datamodels: tools for the datamodels.jp catalog and the nodes of the web of data models.
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
//
//   datamodels build [dir] [--out dir]
//
// build writes the files a node publishes (node.yaml and models/ in dir,
// default the current directory) into --out (default dir/_site). The exit
// code is 1 when the node is invalid, 2 for a usage error.
//
//   datamodels check [dir] [--offline]
//
// check runs the checks a node needs in CI: valid schemas and examples,
// release snapshots, published versions unchanged online, no term of an
// extended model redefined. Exit code 1 on a problem; unreachable nodes are
// only noted.
//
//   datamodels init [dir] [--base-url URL] [--publisher name] [--publisher-url URL] [--subject name] ...
//
// init writes the files of a new node into dir (default the current
// directory), never over an existing file. In a terminal it asks for what the
// options do not give; elsewhere a missing answer is a usage error. With
// --github owner/name it also creates the repository and turns on Pages.
//
//   datamodels add <subject>/<Type> [dir] [--value]
//
// add writes a new model into a subject of the node in dir: schema.json,
// catalog.yaml, an example, and the type in the subject's @context.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { decodeCsv, parseCsv, convertRows, mappingProblems, mappedColumns, LINE } from '../src/convert.mjs';
import { toNormalized } from '../src/ngsi.mjs';
import { siteReader, loadTarget, CORE_CONTEXT_URL, SITE } from '../src/catalog.mjs';
import { buildNode } from '../src/build/node.mjs';
import { checkNode } from '../src/build/check.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initSettings, writeNode, publishToGitHub } from '../src/init.mjs';
import { addModel } from '../src/add.mjs';

const USAGES = {
  convert: `usage: datamodels convert <subject>/<Type> <mapping> <file.csv> [--set attr=value]... [--normalized] [--out file.json] [--site URL|dir]`,
  build: `usage: datamodels build [dir] [--out dir]`,
  check: `usage: datamodels check [dir] [--offline]`,
  add: `usage: datamodels add <subject>/<Type> [dir] [--value]`,
  init: `usage: datamodels init [dir] [--base-url URL] [--iris hash|slash] [--languages en,ja] [--publisher name] [--publisher-url URL] [--license id] [--subject name] [--github owner/name] [--yes]`,
};
const USAGE = Object.values(USAGES).join('\n');
// An error the command reports in one line and exits with. Nothing calls
// process.exit(): it can cut off output still being written to a pipe.
class Exit extends Error { constructor(code, message) { super(message); this.code = code; } }
const usage = (msg, text = USAGE) => { throw new Exit(2, `${msg}\n${text}`); };
const fail = (msg) => { throw new Exit(1, msg); };

// The command line, with commander (#9). Its own messages are replaced by the
// one-line errors above, so scripts see the same text and exit codes as before.
function program({ onConvert, onBuild, onCheck, onInit, onAdd }) {
  // An option's value: present, not empty (--out=) and not another option.
  const value = (name) => (v) => { if (v === '' || v.startsWith('-')) throw new InvalidArgumentError(`${name} needs a value`); return v; };
  const cli = new Command('datamodels')
    .exitOverride()
    .configureOutput({ outputError: () => {} })
    .configureHelp({ styleTitle: (title) => title.toLowerCase() })
    .addHelpText('after', '\nMore on each command, with examples: https://github.com/geolonia/datamodels-toolkit#readme');
  cli.command('convert')
    .description('turn a published list (CSV) into entities of a catalog model, validated against its JSON Schema')
    .usage(USAGES.convert.replace('usage: datamodels convert ', ''))
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
  cli.command('build')
    .description("write the files a data model node publishes: catalog.json, @contexts, JSON Schemas, vocabularies, examples and llms.txt")
    .usage(USAGES.build.replace('usage: datamodels build ', ''))
    .argument('[dir]', 'the node: node.yaml and models/', '.')
    .option('--out <dir>', 'where to write the files (default: <dir>/_site)', value('--out'))
    .action(onBuild);
  cli.command('check')
    .description('check a data model node before it publishes: schemas, examples, published versions, extended terms')
    .usage(USAGES.check.replace('usage: datamodels check ', ''))
    .argument('[dir]', 'the node: node.yaml and models/', '.')
    .option('--offline', 'skip what needs the network: published files, extended models, schemas on other sites')
    .action(onCheck);
  cli.command('init')
    .description('start a data model node: node.yaml, the first subject, a README and the GitHub Pages workflow')
    .usage(USAGES.init.replace('usage: datamodels init ', ''))
    .argument('[dir]', 'where to write the files; files that exist are kept', '.')
    .option('--base-url <URL>', 'the base URL of every IRI, for example https://models.example.org', value('--base-url'))
    .option('--iris <form>', 'hash (/ns/<subject>#<Term>, default) or slash', value('--iris'))
    .option('--languages <list>', 'the languages of titles and descriptions, comma-separated (default en)', value('--languages'))
    .option('--publisher <name>', 'who publishes the node', value('--publisher'))
    .option('--publisher-url <URL>', "the publisher's web site", value('--publisher-url'))
    .option('--license <id>', 'the licence of the models, an SPDX identifier (default CC0-1.0)', value('--license'))
    .option('--subject <name>', 'the first subject, for example road', value('--subject'))
    .option('--github <owner/name>', 'create the public repository with gh, or use the existing remote, and turn on GitHub Pages', value('--github'))
    .option('--yes', 'never ask: use the options and the defaults')
    .action(onInit);
  cli.command('add')
    .description("add a model to a subject of the node: schema.json, catalog.yaml, an example and the type in the subject's @context")
    .usage(USAGES.add.replace('usage: datamodels add ', ''))
    .argument('<subject/Type>', 'the new model, for example road/RoadPatrol')
    .argument('[dir]', 'the node: node.yaml and models/', '.')
    .option('--value', 'a value type (a structure used inside attributes, like an address) instead of an entity type')
    .action(onAdd);
  return cli;
}

// commander's errors as one-line errors with the usage of the command concerned (exit code 2).
function usageError(e, cli, name) {
  const command = cli.commands.find((c) => c.name() === name);
  const text = USAGES[name] ?? USAGE;
  switch (e.code) {
    case 'commander.unknownCommand': return usage(`unknown command ${/'([^']+)'/.exec(e.message)?.[1] ?? ''}`);
    case 'commander.unknownOption': return usage(`unknown option ${/'([^']+)'/.exec(e.message)?.[1] ?? ''}`, text);
    case 'commander.missingArgument': return usage('missing arguments', text);
    case 'commander.excessArguments': return usage(`unexpected arguments: ${command.args.slice(command.registeredArguments.length).join(' ')}`, text);
    case 'commander.optionMissingArgument': return usage(`${/'(--[a-z]+)/.exec(e.message)?.[1] ?? 'an option'} needs a value`, text);
    // Our own message, after commander's "option '…' argument '…' is invalid.".
    case 'commander.invalidArgument': return usage(e.message.split('is invalid. ').pop(), text);
    default: return usage(e.message.replace(/^error: /, ''), text);
  }
}

async function main(args) {
  let code = 0;
  const cli = program({
    onConvert: async (target, mappingName, file, options) => { code = await convert(target, mappingName, file, options); },
    onBuild: async (dir, options) => { code = await build(dir, options); },
    onCheck: async (dir, options) => { code = await check(dir, options); },
    onInit: async (dir, options) => { code = await init(dir, options); },
    onAdd: async (target, dir, options) => { code = await add(target, dir, options); },
  });
  // datamodels --help lists the commands; datamodels help build is commander's.
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { cli.outputHelp(); return 0; }
  if (!args.length) usage('missing command');
  try {
    await cli.parseAsync(args, { from: 'user' });
  } catch (e) {
    if (e instanceof Exit) throw e;
    if (e.code === 'commander.helpDisplayed' || e.code === 'commander.help') return 0;
    if (typeof e.code === 'string' && e.code.startsWith('commander.')) usageError(e, cli, args[0]);
    throw e;
  }
  return code;
}

async function convert(target, mappingName, file, { set: sets = [], normalized, out, site }) {
  if (sets.some((kv) => kv.indexOf('=') < 1)) usage('--set needs attribute=value', USAGES.convert);

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
  if (unknown.length) usage(`--set ${unknown.join(', ')}: not a field that ${mappingName} fills (${settable.join(', ')})`, USAGES.convert);

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

async function build(dir, { out }) {
  let r;
  try { r = await buildNode(dir, out ? { out } : {}); } catch (e) { fail(e.message); }
  console.error(`${dir}: ${r.subjects.length} subject(s), ${r.catalog.models.length} model(s), written to ${out ?? join(dir, '_site')}`);
  return 0;
}

async function check(dir, { offline }) {
  const { problems, notes } = await checkNode(dir, { offline });
  for (const n of notes) console.error(`  note: ${n}`);
  for (const p of problems) console.error(p);
  console.error(`${dir}: ${problems.length ? `${problems.length} problem(s)` : 'ok'}`);
  return problems.length ? 1 : 0;
}

async function add(target, dir, { value }) {
  let r;
  try { r = await addModel(dir, target, { kind: value ? 'value' : 'entity' }); } catch (e) { fail(e.message); }
  for (const f of r.added) console.error(`  added ${f}`);
  for (const f of r.changed) console.error(`  changed ${f}`);
  console.error(`${target}: ${r.typeIri}. Next: its attributes in schema.json (each with x-iri) and catalog.yaml, then datamodels check.`);
  return 0;
}

async function init(dir, options) {
  let answers = {
    baseUrl: options.baseUrl, iris: options.iris, publisherName: options.publisher, publisherUrl: options.publisherUrl,
    license: options.license, subject: options.subject, github: options.github,
    languages: options.languages?.split(',').map((l) => l.trim()).filter(Boolean),
  };
  // Questions only in a terminal: CI and scripts never wait for an answer.
  const interactive = !options.yes && process.stdin.isTTY && process.stdout.isTTY;
  if (interactive) answers = await ask(answers);
  const missing = [['baseUrl', '--base-url'], ['publisherName', '--publisher'], ['publisherUrl', '--publisher-url'], ['subject', '--subject']].filter(([k]) => !answers[k]).map(([, o]) => o);
  if (missing.length) usage(`missing ${missing.join(', ')}`, USAGES.init);
  const settings = initSettings(Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)));
  if (settings.problems.length) fail(`init: nothing written:\n${settings.problems.map((p) => `  ${p}`).join('\n')}`);
  const { added, kept, appended } = await writeNode(dir, settings);
  for (const f of added) console.error(`  added ${f}`);
  for (const f of appended) console.error(`  added lines to ${f}`);
  for (const f of kept) console.error(`  kept ${f} (it exists)`);
  if (answers.github) {
    const run = async (cmd, args, opts = {}) => (await promisify(execFile)(cmd, args, opts)).stdout;
    let steps;
    try { steps = await publishToGitHub(dir, answers.github, { run }); } catch (e) { fail(`--github: ${e.stderr?.trim() || e.message}`); }
    for (const s of steps) console.error(`  ${s}`);
  }
  console.error(`${dir}: a data model node. Next: add a model under models/${settings.subject}/, then datamodels check and datamodels build.`);
  return 0;
}

// The questions of init, with @clack/prompts; an answer given as an option is not asked again.
async function ask(given) {
  const p = await import('@clack/prompts');
  const answer = async (value, question) => {
    if (value !== undefined) return value;
    const v = await question();
    if (p.isCancel(v)) { p.cancel('Nothing written.'); throw new Exit(1, 'init cancelled'); }
    return v;
  };
  const url = (v) => (/^https?:\/\/[^/\s]+/.test(v ?? '') ? undefined : 'An http(s) URL');
  p.intro('datamodels init: a data model node');
  const a = { ...given };
  a.baseUrl = await answer(a.baseUrl, () => p.text({ message: 'Base URL of the node (part of every IRI; keep it once published)', placeholder: 'https://models.example.org', validate: url }));
  a.iris = await answer(a.iris, () => p.select({ message: 'IRI form', options: [{ value: 'hash', label: 'hash: /ns/<subject>#<Term>', hint: 'any static host, GitHub Pages' }, { value: 'slash', label: 'slash: /ns/<subject>/<Term>', hint: 'needs w3id.org or a server that redirects' }] }));
  a.languages = await answer(a.languages, async () => String(await p.text({ message: 'Languages, comma-separated', initialValue: 'en' })).split(',').map((l) => l.trim()).filter(Boolean));
  a.publisherName = await answer(a.publisherName, () => p.text({ message: 'Publisher (who runs the node)', placeholder: 'Example Inc.' }));
  a.publisherUrl = await answer(a.publisherUrl, () => p.text({ message: "Publisher's web site", placeholder: 'https://example.org/', validate: url }));
  a.license = await answer(a.license, () => p.text({ message: 'Licence of the models (SPDX)', initialValue: 'CC0-1.0' }));
  a.subject = await answer(a.subject, () => p.text({ message: 'First subject (a group of models), for example road', validate: (v) => (/^[a-z][a-z0-9-]*$/.test(v ?? '') ? undefined : 'Lower case letters, digits and hyphens') }));
  if (a.github === undefined && await answer(undefined, () => p.confirm({ message: 'Create a public GitHub repository with gh and turn on GitHub Pages?', initialValue: false }))) {
    a.github = await answer(undefined, () => p.text({ message: 'Repository (owner/name)', placeholder: 'example/models' }));
  }
  p.outro('Writing the files.');
  return a;
}

try { process.exitCode = await main(process.argv.slice(2)); } catch (e) {
  if (!(e instanceof Exit)) throw e;
  console.error(e.message);
  process.exitCode = e.code;
}
