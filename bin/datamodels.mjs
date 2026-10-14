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
//   datamodels convert disaster/EvacuationSite ./my-list.yaml my-list.csv --check
//   datamodels convert disaster/EvacuationSite csv-template sites.csv
//
// The mapping may also be a file of your own (a path, or a name ending in
// .yaml), or csv-template for a CSV with the columns of the model's CSV
// template. --check converts the first rows (--rows, default 20), writes
// nothing and reports what to fix; the exit code is 0 when every checked row
// is valid.
//
//   datamodels mapping disaster/EvacuationSite my-list.csv --out my-list.yaml
//
// mapping writes a first mapping file for a CSV: a row per attribute, with
// the column that fits it or a TODO, for a person or an AI agent to finish.
//
//   datamodels build [dir] [--out dir]
//
// build writes the files a node publishes (node.yaml and models/ in dir,
// default the current directory) into --out (default dir/_site). The exit
// code is 1 when the node is invalid, 2 for a usage error.
//
//   datamodels check [dir] [--offline] [--base origin/main] [--all-released]
//
// check runs the checks a node needs in CI: valid schemas and examples,
// the NGSI-LD and JSON-LD rules of the examples, release snapshots,
// published versions unchanged online and (--base) in git, no term of an
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
//
//   datamodels export <subject>/<Type> [dir] --to csv,table-schema,ai,postgis [--out dir] [--index URL]
//
// export writes the files of the adapters (src/adapters/) for one entity
// model: a CSV template, its Table Schema, a JSON Schema for the structured
// output of AI models, a PostgreSQL / PostGIS table. The model is the node's
// in dir when it has one; otherwise it is read from --index (default: for a
// type IRI the index of the node that minted it, when that index lists it;
// else the first node in node.yaml, else datamodels.jp).
//
//   datamodels search <words…> [--index URL] [--depth N] [--limit N] [--json]
//   datamodels nodes [--index URL] [--depth N] [--json]
//
// search finds models by words in their type, title, attributes and
// description, in an index (default datamodels.jp) and the nodes it links to
// (`nodes` and `extends` in its catalog.json), up to --depth links away
// (default 1). nodes lists those nodes. A linked node that cannot be read is
// noted on standard error; the exit code is 1 only when the index itself
// cannot be read.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { decodeCsv, parseCsv, convertRows, mappingProblems, mappedColumns, unknownFields, LINE } from '../src/convert.mjs';
import { toNormalized, wrapKeyValues } from '../src/ngsi.mjs';
import { siteReader, loadTarget, isMappingFile, CORE_CONTEXT_URL, SITE } from '../src/catalog.mjs';
import { TEMPLATE, siteModel, templateMapping, catalogMappings, startMapping } from '../src/mapping.mjs';
import { buildNode, readNode } from '../src/build/node.mjs';
import { checkNode } from '../src/build/check.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initSettings, writeNode, publishToGitHub, askInit, parseLanguages } from '../src/init.mjs';
import { addModel } from '../src/add.mjs';
import { releaseSubject } from '../src/release.mjs';
import { upgradeNode, bumpSubject } from '../src/version.mjs';
import { extendModel, extendChoices, extendMessage } from '../src/extend.mjs';
import { exportModel, writeExport } from '../src/export.mjs';
import { ADAPTERS } from '../src/adapters/index.mjs';
import { unionCount } from '../src/adapters/ai/index.mjs';
import { crossRules } from '../src/adapters/model.mjs';
import { discoverNodes, searchModels, words, plain, DEFAULT_INDEX, MAX_DEPTH } from '../src/discover.mjs';

const USAGES = {
  convert: `usage: datamodels convert <subject>/<Type> <mapping|file.yaml|${TEMPLATE}> <file.csv> [--set attr=value]... [--normalized] [--out file.json] [--check [--rows N]] [--site URL|dir]`,
  mapping: `usage: datamodels mapping <subject>/<Type> <file.csv> [--out file.yaml] [--site URL|dir]`,
  build: `usage: datamodels build [dir] [--out dir]`,
  check: `usage: datamodels check [dir] [--offline] [--base <git ref>] [--all-released]`,
  add: `usage: datamodels add <subject>/<Type> [dir] [--value]`,
  release: `usage: datamodels release <subject> [dir] [--offline]`,
  bump: `usage: datamodels bump <subject> <patch|minor|major> [dir] [--offline]`,
  upgrade: `usage: datamodels upgrade [dir] [--to vX.Y.Z]`,
  extend: `usage: datamodels extend <model> <subject>/<Type> [dir] [--index URL] [--subclass]`,
  export: `usage: datamodels export <subject>/<Type> [dir] --to ${ADAPTERS.map((a) => a.name).join(',')} [--out dir] [--index URL]`,
  search: `usage: datamodels search <words...> [--index URL] [--depth N] [--limit N] [--json]`,
  nodes: `usage: datamodels nodes [--index URL] [--depth N] [--json]`,
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
function program({ onConvert, onMapping, onBuild, onCheck, onInit, onAdd, onRelease, onExtend, onBump, onUpgrade, onExport, onSearch, onNodes }) {
  // An option's value: present, not empty (--out=) and not another option.
  const value = (name) => (v) => { if (v === '' || v.startsWith('-')) throw new InvalidArgumentError(`${name} needs a value`); return v; };
  const count = (name) => (v) => { if (!/^[1-9]\d*$/.test(v)) throw new InvalidArgumentError(`${name} needs a whole number above 0`); return Number(v); };
  const depth = (v) => { if (!/^\d+$/.test(v) || Number(v) > MAX_DEPTH) throw new InvalidArgumentError(`--depth needs a whole number from 0 to ${MAX_DEPTH}`); return Number(v); };
  const cli = new Command('datamodels')
    .exitOverride()
    .configureOutput({ outputError: () => {} })
    .configureHelp({ styleTitle: (title) => title.toLowerCase() })
    .addHelpText('after', '\nMore on each command, with examples: https://datamodels.jp/en/toolkit/reference');
  cli.command('convert')
    .description('turn a published list (CSV) into entities of a catalog model, validated against its JSON Schema')
    .usage(USAGES.convert.replace('usage: datamodels convert ', ''))
    .argument('<subject/Type>', 'the model, as on its page, for example disaster/EvacuationSite')
    .argument('<mapping>', `one of the model's mapping files, a mapping file of your own (./my-list.yaml), or ${TEMPLATE} for the columns of the model's CSV template`)
    .argument('<file.csv>', 'the list, UTF-8 or Shift_JIS')
    // In the words of the documentation (datamodels.jp/en/toolkit), which has the details and examples.
    .option('--set <attribute=value>', "a value the list does not carry, such as GSI's municipality code", (v, all = []) => [...all, value('--set')(v)])
    .option('--normalized', 'NGSI-LD normalized form instead of key-values')
    .option('--out <file.json>', 'write to a file (default: standard output)', value('--out'))
    .option('--check', 'convert only the first rows, write nothing, and report what to fix in the mapping or the list')
    .option('--rows <N>', 'how many rows --check converts (default 20)', count('--rows'))
    .option('--site <URL|dir>', 'where to read the catalog, or a directory laid out like the site', value('--site'), SITE)
    .addHelpText('after', '\nMore on each option, with examples: https://datamodels.jp/en/toolkit/reference#convert')
    // exitOverride, the output and the help style are inherited from cli.
    .action(onConvert);
  cli.command('mapping')
    .description('write a first mapping file for your own list (CSV) and a catalog model: a row per attribute with the column that fits it, or a TODO')
    .usage(USAGES.mapping.replace('usage: datamodels mapping ', ''))
    .argument('<subject/Type>', 'the model, as on its page, for example disaster/EvacuationSite')
    .argument('<file.csv>', 'the list, UTF-8 or Shift_JIS')
    .option('--out <file.yaml>', 'write to a new file (default: standard output); an existing file is never overwritten', value('--out'))
    .option('--site <URL|dir>', 'where to read the catalog, or a directory laid out like the site', value('--site'), SITE)
    .action(onMapping);
  cli.command('build')
    .description("write the files a data model node publishes: catalog.json, @contexts, JSON Schemas, vocabularies, examples, llms.txt, the pages and the adapters' files")
    .usage(USAGES.build.replace('usage: datamodels build ', ''))
    .argument('[dir]', 'the node: node.yaml and models/', '.')
    .option('--out <dir>', 'where to write the files (default: <dir>/_site)', value('--out'))
    .action(onBuild);
  cli.command('check')
    .description('check a data model node before it publishes: schemas, examples, published versions, extended terms')
    .usage(USAGES.check.replace('usage: datamodels check ', ''))
    .argument('[dir]', 'the node: node.yaml and models/', '.')
    .option('--offline', 'skip what needs the network: published files, extended models, schemas on other sites')
    .option('--base <git ref>', 'compare the release snapshots with a git ref, such as origin/main: a published version is never changed or removed', value('--base'))
    .option('--all-released', 'require a release snapshot of the current version of every subject')
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
  cli.command('release')
    .description("keep the subject's current version online: snapshot its @context, vocabulary and schemas, so the next version leaves them in place")
    .usage(USAGES.release.replace('usage: datamodels release ', ''))
    .argument('<subject>', 'the subject, for example road')
    .argument('[dir]', 'the node: node.yaml and models/', '.')
    .option('--offline', 'do not compare the snapshot with the published files')
    .action(onRelease);
  cli.command('bump')
    .description("give a subject a new version: release the current one (it stays online), then raise the version in subject.yaml and the subject's schema URLs")
    .usage(USAGES.bump.replace('usage: datamodels bump ', ''))
    .argument('<subject>', 'the subject, for example road')
    .argument('<level>', 'patch, minor or major (Semantic Versioning: major for a change that breaks existing data)')
    .argument('[dir]', 'the node: node.yaml and models/', '.')
    .option('--offline', 'release without comparing with the published files')
    .action(onBump);
  cli.command('upgrade')
    .description("move the node to a release of datamodels-toolkit: the Action's pin in the workflows and npx in the Markdown files")
    .usage(USAGES.upgrade.replace('usage: datamodels upgrade ', ''))
    .argument('[dir]', 'the node', '.')
    .option('--to <vX.Y.Z>', 'a release (default: the latest)', value('--to'))
    .action(onUpgrade);
  cli.command('extend')
    .description("start a model from a model of another node, such as datamodels.jp's: a copy of its schema at its version, its @context imported, recorded in extends")
    .usage(USAGES.extend.replace('usage: datamodels extend ', ''))
    .argument('[model]', 'the model to extend: <subject>/<Type> as in the index, or its type IRI (asked in a terminal)')
    .argument('[subject/Type]', 'the new model in this node, for example road/RoadTask (asked in a terminal)')
    .argument('[dir]', 'the node: node.yaml and models/', '.')
    .option('--index <URL>', "the other node's catalog.json (default: for a type IRI, its own node's index when that lists it; else the first node in node.yaml, else datamodels.jp)", value('--index'))
    .option('--subclass', "a subtype with its own type IRI, instead of the same type with more attributes")
    .action(onExtend);
  cli.command('export')
    .description('write files made from a model for other tools: a CSV template and its Table Schema, a JSON Schema for the structured output of AI models, a PostgreSQL / PostGIS table')
    .usage(USAGES.export.replace('usage: datamodels export ', ''))
    .argument('<subject/Type>', 'the model, for example disaster/EvacuationSite, or its type IRI')
    .argument('[dir]', "the node; its own model if it has one, else the other node's", '.')
    .requiredOption('--to <adapters>', `one or more of ${ADAPTERS.map((a) => a.name).join(', ')}, comma-separated`, value('--to'))
    .option('--out <dir>', 'where to write the files (default: the current directory)', value('--out'))
    .option('--index <URL>', "another node's catalog.json (default: for a type IRI, its own node's index when that lists it; else the first node in node.yaml, else datamodels.jp)", value('--index'))
    .action(onExport);
  cli.command('search')
    .description('find models by words in their type, title, attributes and description, in datamodels.jp (or another index) and the nodes it links to')
    .usage(USAGES.search.replace('usage: datamodels search ', ''))
    .argument('<words...>', 'what to look for, in English or Japanese, for example 避難 or "road closure"')
    .option('--index <URL>', 'the catalog.json, or the address of a node, to start at', value('--index'), DEFAULT_INDEX)
    .option('--depth <N>', 'how many links to follow from it; 0 reads only the index', depth, 1)
    .option('--limit <N>', 'how many models to list', count('--limit'), 10)
    .option('--json', 'machine-readable output: the models with their type IRI, schema, @context and index')
    .action(onSearch);
  cli.command('nodes')
    .description('list the data model nodes reachable from datamodels.jp (or another index): name, address, licence and number of models')
    .usage(USAGES.nodes.replace('usage: datamodels nodes ', ''))
    .option('--index <URL>', 'the catalog.json, or the address of a node, to start at', value('--index'), DEFAULT_INDEX)
    .option('--depth <N>', 'how many links to follow from it; 0 reads only the index', depth, 1)
    .option('--json', 'machine-readable output')
    .action(onNodes);
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
    onMapping: async (target, file, options) => { code = await mapping(target, file, options); },
    onBuild: async (dir, options) => { code = await build(dir, options); },
    onCheck: async (dir, options) => { code = await check(dir, options); },
    onInit: async (dir, options) => { code = await init(dir, options); },
    onAdd: async (target, dir, options) => { code = await add(target, dir, options); },
    onRelease: async (subject, dir, options) => { code = await release(subject, dir, options); },
    onBump: async (subject, level, dir, options) => { code = await bump(subject, level, dir, options); },
    onUpgrade: async (dir, options) => { code = await upgrade(dir, options); },
    onExtend: async (model, target, dir, options) => { code = await extend(model, target, dir, options); },
    onExport: async (target, dir, options) => { code = await exportFiles(target, dir, options); },
    onSearch: async (query, options) => { code = await search(query, options); },
    onNodes: async (options) => { code = await listNodes(options); },
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

async function convert(target, mappingName, file, { set: sets = [], normalized, out, site, check, rows: limit }) {
  if (sets.some((kv) => kv.indexOf('=') < 1)) usage('--set needs attribute=value', USAGES.convert);
  if (limit !== undefined && !check) usage('--rows is for --check', USAGES.convert);
  if (check && (out || normalized)) usage(`--check writes nothing; leave out ${out ? '--out' : '--normalized'}`, USAGES.convert);

  const reader = siteReader(site);
  let loaded;
  try {
    // The CSV template's rules come from the model's columns, the same as export writes them.
    const template = mappingName === TEMPLATE ? templateMapping((await siteModel(reader, target)).columns) : undefined;
    loaded = await loadTarget(reader, target, mappingName, { mapping: template });
  } catch (e) { fail(e.message); }
  const { entry, schema, mapping, mappings, validate, errorsText, todos } = loaded;
  // Rules this converter cannot apply stop the run before any row is read.
  const ruleProblems = mappingProblems(mapping, mappings);
  if (ruleProblems.length) fail(`${target} ${mappingName}: the mapping cannot be applied:\n${ruleProblems.map((p) => `  ${p}`).join('\n')}`);
  // A file of your own may name an attribute the model does not have, or still have a TODO
  // that datamodels mapping wrote: convert refuses it, --check reports it with the rows.
  const ownProblems = [
    ...(isMappingFile(mappingName) ? unknownFields(mapping, schema) : []),
    ...todos.map((t) => `${t.file} line ${t.line}: a TODO is left: ${t.text.length > 100 ? `${t.text.slice(0, 99)}…` : t.text}`),
  ];
  if (ownProblems.length && !check) fail(`${target} ${mappingName}: the mapping is not finished:\n${ownProblems.map((p) => `  ${p}`).join('\n')}\n(datamodels convert ... --check shows what the rows need)`);
  const set = Object.fromEntries(sets.map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
  // A name the mapping converts nothing into would be ignored without a word.
  const settable = Object.keys(mapping.fields ?? {}).filter((k) => mapping.fields[k]?.via === undefined && mapping.fields[k]?.value === undefined && mapping.fields[k]?.transform !== 'flags');
  const unknown = Object.keys(set).filter((k) => !settable.includes(k));
  if (unknown.length) usage(`--set ${unknown.join(', ')}: not a field that ${mappingName} fills (${settable.join(', ')})`, USAGES.convert);

  let text, encoding, all;
  try { ({ text, encoding } = decodeCsv(await readFile(file))); all = parseCsv(text); } catch (e) { fail(`${file}: ${e.message}`); }
  const rows = check ? all.slice(0, limit ?? 20) : all;
  const results = convertRows(rows, mapping, { type: entry.type, mappings, set });

  const invalid = [];
  const invalidIndex = new Set();
  const repairs = new Map();
  // --check shows the first schema errors of a row, convert all of them.
  const schemaErrors = (errors) => (check && errors.length > 3 ? `${errorsText(errors.slice(0, 3))} (and ${errors.length - 3} more)` : errorsText(errors));
  for (const [i, r] of results.entries()) {
    for (const f of r.fixes) { const k = `${f.field}: ${f.repair}`; const e = repairs.get(k) ?? { n: 0, example: f.detail }; e.n++; repairs.set(k, e); }
    if (r.problems.length || !validate(r.entity)) { invalidIndex.add(i); invalid.push({ line: rows[i][LINE], problems: [...r.problems, ...(r.problems.length ? [] : [schemaErrors(validate.errors)])] }); }
  }
  // Valid as the schema describes them; in key-values form a JsonProperty or VocabProperty keeps its wrapper.
  const entities = results.filter((_, i) => !invalidIndex.has(i)).map((r) => wrapKeyValues(r.entity, schema));
  if (!check) {
    const context = [entry.contextAliasUrl, CORE_CONTEXT_URL];
    const json = `${JSON.stringify(normalized ? entities.map((e) => toNormalized(e, schema, context)) : entities, null, 2)}\n`;
    if (out) {
      try { await writeFile(out, json); } catch (e) { fail(`${out}: ${e.code ?? e.message}`); }
    } else process.stdout.write(json);
    console.error(`${file}: ${encoding}, ${rows.length} row(s), ${entities.length} valid ${entry.type}, ${invalid.length} invalid`);
  } else console.error(`${file}: ${encoding}, checked ${rows.length} of ${all.length} row(s) with ${mappingName}`);
  for (const p of ownProblems) console.error(`  mapping: ${p}`);
  // Columns the mapping reads that the file does not have: their attributes stay empty, unless --set fills them.
  const filled = new Set(Object.keys(set).flatMap((k) => [].concat(mapping.fields[k]?.column ?? [])));
  const absent = mappedColumns(mapping, mappings).filter((c) => !all.columns.includes(c) && !filled.has(c));
  if (absent.length) console.error(`  not in the file, so left empty: ${absent.join(', ')}`);
  // In a file of your own, such a column is most often a typo: --check counts it as a problem.
  const own = isMappingFile(mappingName);
  // Required attributes that no row gets: a column is missing from the mapping, not a fault of one row.
  const required = (schema.required ?? []).filter((k) => k !== 'id' && k !== 'type');
  const groups = crossRules(schema).atLeastOne;
  const none = (k) => results.every((r) => r.entity[k] === undefined);
  const missing = [...required.filter(none), ...groups.filter((g) => g.every(none)).map((g) => `one of ${g.join(', ')}`)];
  if (check && rows.length && missing.length) console.error(`  required, but no row gets a value: ${missing.join('; ')}`);
  if (all.skipped.length) console.error(`  skipped ${all.skipped.length} record(s) with only empty fields: line ${all.skipped.slice(0, 10).join(', ')}${all.skipped.length > 10 ? ', …' : ''}`);
  for (const [k, e] of repairs) console.error(`  repaired ${e.n}×: ${k} (e.g. ${e.example})`);
  for (const x of invalid.slice(0, 20)) console.error(`  line ${x.line}: ${x.problems.join('; ')}`);
  if (invalid.length > 20) console.error(`  … ${invalid.length - 20} more`);
  if (!check) return invalid.length ? 1 : 0;
  // The summary is the last line, so a script or an agent can read it alone.
  const problems = ownProblems.length + (rows.length && missing.length ? 1 : 0) + (own && absent.length ? 1 : 0);
  console.error(rows.length ? `${entities.length} of ${rows.length} rows valid${problems ? `; ${problems} problem(s) in the mapping` : ''}` : 'no rows to check');
  return rows.length && !invalid.length && !problems ? 0 : 1;
}

async function mapping(target, file, { out, site }) {
  const reader = siteReader(site);
  let model, catalog;
  try { model = await siteModel(reader, target); catalog = await catalogMappings(reader, model.entry); } catch (e) { fail(e.message); }
  // The commands in the file name the model as convert takes it, also when it was given by its type IRI.
  target = `${model.entry.subject}/${model.entry.type}`;
  let encoding, rows;
  try { let text; ({ text, encoding } = decodeCsv(await readFile(file))); rows = parseCsv(text); } catch (e) { fail(`${file}: ${e.message}`); }
  const r = startMapping({ target, ...model, header: rows.columns, rows, catalog: catalog.mappings, csv: file, out });
  if (out) {
    // A mapping someone has filled in is work: never write over it.
    try { await writeFile(out, r.text, { flag: 'wx' }); } catch (e) { fail(e.code === 'EEXIST' ? `${out}: the file exists, not overwritten (choose another name, or delete it first)` : `${out}: ${e.code ?? e.message}`); }
  } else process.stdout.write(r.text);
  for (const n of catalog.notes) console.error(`  note: ${n}`);
  const [hint] = r.hints;
  if (hint) console.error(`  note: the header has ${hint.n} of the ${hint.all} columns of the catalog's mapping ${hint.name}; if the list follows that standard, try: datamodels convert ${target} ${hint.name} ${file} --check`);
  console.error(`  ${r.chosen.size} of ${r.targets.length} attributes and fields have a column; ${r.todos.length + (r.idTodo ? 1 : 0) + (r.allDayTodo ? 1 : 0)} TODO(s)`);
  if (r.unused.length) console.error(`  columns no row reads: ${r.unused.join(', ')}`);
  console.error(`${file}: ${encoding}, ${rows.columns.length} column(s)${out ? `, mapping written to ${out}` : ''}. Next: fill in the TODOs, then datamodels convert ${target} ${out ?? '<mapping.yaml>'} ${file} --check`);
  return 0;
}

async function build(dir, { out }) {
  let r;
  try { r = await buildNode(dir, out ? { out } : {}); } catch (e) { fail(e.message); }
  for (const n of r.notes) console.error(`  note: ${n}`);
  console.error(`${dir}: ${r.subjects.length} subject(s), ${r.catalog.models.length} model(s), written to ${out ?? join(dir, '_site')}`);
  return 0;
}

async function check(dir, { offline, base, allReleased }) {
  const { problems, notes } = await checkNode(dir, { offline, base, allReleased });
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
  if (r.released) console.error(`  note: v${r.released} of this subject was released, so its files cannot change; give the subject a new version (subject.yaml) before you build`);
  console.error(`${target}: ${r.typeIri}. Next: its attributes in schema.json (each with x-iri) and catalog.yaml, then datamodels check.`);
  return 0;
}

async function release(subjectName, dir, { offline }) {
  let r;
  try { r = await releaseSubject(dir, subjectName, { offline }); } catch (e) { fail(e.message); }
  for (const n of r.notes) console.error(`  note: ${n}`);
  if (!r.written) console.error(`${r.subject} v${r.version}: already released (${r.dir}), unchanged`);
  else console.error(`${r.subject} v${r.version}: released into ${r.dir}${r.online ? `, the same as the ${r.online} published file(s)` : ''}. Commit it; the next version leaves these files online.`);
  return 0;
}

async function bump(subjectName, level, dir, { offline }) {
  let r;
  try { r = await bumpSubject(dir, subjectName, level, { offline }); } catch (e) { fail(e.message); }
  for (const n of r.released.notes) console.error(`  note: ${n}`);
  console.error(`  ${r.released.written ? 'released' : 'already released'} v${r.from} (${r.released.dir})`);
  for (const f of r.changed) console.error(`  changed ${f}`);
  console.error(`${r.subject}: ${r.from} → ${r.to}. Commit both; the site keeps v${r.from} and adds v${r.to}.`);
  return 0;
}

async function upgrade(dir, { to }) {
  let r;
  try { r = await upgradeNode(dir, { to }); } catch (e) { fail(e.message); }
  for (const f of r.changed) console.error(`  changed ${f}`);
  console.error(r.changed.length ? `${dir}: datamodels-toolkit ${r.version} (${r.sha.slice(0, 7)}). Commit the changes.` : `${dir}: already at datamodels-toolkit ${r.version}, nothing changed`);
  return 0;
}

async function extend(model, target, dir, { index, subclass }) {
  if (!model || !target) {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) usage('missing arguments', USAGES.extend);
    ({ model, target, index } = await askExtend(model, target, dir, index));
  }
  let r;
  try { r = await extendModel(dir, model, target, { index, subclass }); } catch (e) { fail(e.message); }
  for (const f of r.added) console.error(`  added ${f}`);
  for (const f of r.changed) console.error(`  changed ${f}`);
  console.error(extendMessage(target, r));
  return 0;
}

async function exportFiles(target, dir, { to, out = '.', index }) {
  const names = to.split(',').map((n) => n.trim()).filter(Boolean);
  const unknown = names.filter((n) => !ADAPTERS.some((a) => a.name === n));
  if (unknown.length || !names.length) usage(`--to ${unknown.join(', ') || to}: not an adapter (${ADAPTERS.map((a) => a.name).join(', ')})`, USAGES.export);
  let r, written;
  try { r = await exportModel(target, names, { dir, index }); written = await writeExport(r.files, out); } catch (e) { fail(e.message); }
  for (const f of written) console.error(`  wrote ${f}`);
  // Claude's strict mode allows 16 properties with a union (a type with null) per request.
  const ai = r.files.find((f) => f.adapter === 'ai');
  const unions = ai ? unionCount(JSON.parse(ai.content).schema) : 0;
  if (unions > 16) console.error(`  note: ${unions} properties of the AI schema can be null; Claude's strict mode takes 16 per request, so use it there without strict, or remove the attributes you do not need (OpenAI's strict mode takes it as it is)`);
  console.error(`${target}: ${r.typeIri}, from ${r.from}`);
  return 0;
}

async function search(query, { index, depth, limit, json }) {
  const text = query.join(' ');
  if (!words(text).size) usage(`nothing to search for in "${text}": a word in Latin letters needs 3 or more, a Japanese word 2 or more characters with a kanji or katakana`, USAGES.search);
  let found;
  try { found = await discoverNodes(index, { depth }); } catch (e) { fail(e.message); }
  const { nodes, notes } = found;
  const { results, total } = searchModels(text, nodes, { limit });
  for (const n of notes) console.error(`  note: ${n}`);
  if (json) {
    console.log(JSON.stringify({ query: text, index: nodes[0].index, depth, nodes: nodes.map(({ name, title, url, index: i }) => ({ name, title, url, index: i })), results, total, notes }, null, 2));
  } else {
    for (const r of results) {
      const title = [...new Set(Object.values(r.title).filter((t) => typeof t === 'string'))].join(' / ');
      console.log([`${plain(r.subject ? `${r.subject}/${r.type}` : r.type)}${r.kind === 'value' ? ' (value type)' : ''}`, plain(title), plain(r.siteTitle ?? r.site, 80), plain(r.pageUrl ?? r.typeIri ?? '', 300)].filter(Boolean).join('  '));
    }
  }
  const models = nodes.reduce((sum, n) => sum + n.catalog.models.length, 0);
  console.error(`${total ? `${total} of ${models}` : `none of ${models}`} models in ${nodes.length} node(s) match${total > results.length ? `; the first ${results.length} are listed (--limit)` : ''}`);
  return 0;
}

async function listNodes({ index, depth, json }) {
  let found;
  try { found = await discoverNodes(index, { depth }); } catch (e) { fail(e.message); }
  const { nodes, notes } = found;
  for (const n of notes) console.error(`  note: ${n}`);
  const rows = nodes.map(({ name, title, url, index: i, license, depth: d, linkedFrom, catalog }) => ({ name, title, url, index: i, license, models: catalog.models.length, depth: d, linkedFrom }));
  if (json) console.log(JSON.stringify({ index: nodes[0].index, depth, nodes: rows, notes }, null, 2));
  else {
    // A node is shown by its own title when its catalog.json has one, else by its publisher.
    const nameOf = new Map(rows.map((r) => [r.index, r.title ?? r.name]));
    for (const r of rows) {
      console.log([plain(r.title ?? r.name, 80), plain(r.url, 300), plain(r.license ?? 'no licence given', 80), `${r.models} model${r.models === 1 ? '' : 's'}`, r.linkedFrom ? `(linked from ${plain(nameOf.get(r.linkedFrom) ?? r.linkedFrom, 80)})` : ''].filter(Boolean).join('  '));
    }
  }
  console.error(`${nodes.length} node(s) within ${depth} link(s) of ${nodes[0].index}`);
  return 0;
}

// The questions of extend: the model, picked from the index, and the name of the new one.
async function askExtend(model, target, dir, index) {
  const p = await import('@clack/prompts');
  const answer = async (v) => { if (p.isCancel(v)) { p.cancel('Nothing written.'); throw new Exit(1, 'extend cancelled'); } return v; };
  p.intro('datamodels extend: a model from another node');
  if (!model) {
    // The model picked is extended from this index (extendChoices).
    let models;
    try { ({ index, models } = await extendChoices(dir, index)); } catch (e) { fail(e.message); }
    model = await answer(await p.select({ message: `Model to extend (${index})`, options: models.map((m) => ({ value: m.typeIri, label: `${m.subject}/${m.type}`, hint: m.title?.en ?? m.title?.ja })) }));
  }
  if (!target) target = await answer(await p.text({ message: 'The new model in this node (<subject>/<Type>)', placeholder: 'road/RoadTask', validate: (v) => (/^[a-z][a-z0-9-]*\/[A-Z][A-Za-z0-9]*$/.test(v ?? '') ? undefined : 'subject/Type, for example road/RoadTask') }));
  p.outro('Writing the files.');
  return { model, target, index };
}

async function init(dir, options) {
  let answers = {
    baseUrl: options.baseUrl, iris: options.iris, publisherName: options.publisher, publisherUrl: options.publisherUrl,
    license: options.license, subject: options.subject, github: options.github,
    languages: options.languages === undefined ? undefined : parseLanguages(options.languages),
  };
  // Questions only in a terminal: CI and scripts never wait for an answer.
  const interactive = !options.yes && process.stdin.isTTY && process.stdout.isTTY;
  if (interactive) answers = await askInit(answers);
  if (!answers) throw new Exit(1, 'init cancelled');
  const missing = [['baseUrl', '--base-url'], ['publisherName', '--publisher'], ['publisherUrl', '--publisher-url'], ['subject', '--subject']].filter(([k]) => !answers[k]).map(([, o]) => o);
  if (missing.length) usage(`missing ${missing.join(', ')}`, USAGES.init);
  const settings = initSettings(Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)));
  if (settings.problems.length) fail(`init: nothing written:\n${settings.problems.map((p) => `  ${p}`).join('\n')}`);
  const { added, kept, appended, notes } = await writeNode(dir, settings);
  for (const f of added) console.error(`  added ${f}`);
  for (const f of appended) console.error(`  added lines to ${f}`);
  for (const f of kept) console.error(`  kept ${f} (it exists)`);
  for (const n of notes) console.error(`  ${n}`);
  if (answers.github) {
    const run = async (cmd, args, opts = {}) => (await promisify(execFile)(cmd, args, opts)).stdout;
    let steps;
    try { steps = await publishToGitHub(dir, answers.github, { run, files: [...added, ...appended] }); } catch (e) { fail(`--github: ${e.stderr?.trim() || e.message}`); }
    for (const s of steps) console.error(`  ${s}`);
  }
  console.error(`${dir}: a data model node. Next: add a model under models/${settings.subject}/, then datamodels check and datamodels build.`);
  return 0;
}

try { process.exitCode = await main(process.argv.slice(2)); } catch (e) {
  if (!(e instanceof Exit)) throw e;
  console.error(e.message);
  process.exitCode = e.code;
}
