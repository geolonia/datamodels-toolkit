# datamodels-toolkit

Command-line tools for the [datamodels.jp](https://datamodels.jp) catalog.

`convert` turns a published list (CSV) into entities of a catalog model; `export` writes files made from a model for tools that do not read NGSI-LD (a spreadsheet, an AI model, PostgreSQL); `build` writes the files of a data model node, a site of your own in the [web of data models](https://github.com/geolonia/datamodels/issues/200). More commands come only when someone needs them for a real task that existing JSON-LD and FIWARE tools do not cover ([geolonia/datamodels#91](https://github.com/geolonia/datamodels/issues/91)).

## Install

Node.js 24 or later. Until the package is on npm, run a release from GitHub:

```bash
npx github:geolonia/datamodels-toolkit#v0.3.3 convert <subject>/<Type> <mapping> <file.csv>
```

## convert

```bash
datamodels convert disaster/EvacuationSite jichitai-opendata-site 092011_evacuation_space.csv --out sites.json
datamodels convert disaster/EvacuationSite gsi-emergency-site 13101_2.csv --set localGovernmentCode=13101
```

This turns, for example, a municipality's 指定緊急避難場所一覧 (自治体標準オープンデータセット 03) or GSI's data into EvacuationSite entities. Each entity is validated against the model's JSON Schema.

- `<subject>/<Type>`: the model, as on its page (`/models/disaster/EvacuationSite/`).
- `<mapping>`: one of the model's mapping files. The model page lists them under "Mapping files (YAML)", and `catalog.json` lists them as `mappingUrls`.
- `--set attribute=value`: a value the list does not carry, such as GSI's municipality code, which is only in the file name.
- `--normalized`: NGSI-LD normalized form instead of key-values, with the subject's `@context` alias and the NGSI-LD core context.
- `--out file.json`: write to a file (default: standard output).
- `--site URL|dir`: where to read the catalog (default `https://datamodels.jp`). A directory laid out like the site also works, for example the `dist/` that `npm run build` makes in [geolonia/datamodels](https://github.com/geolonia/datamodels), to try a mapping before it is published.

It reads `catalog.json`, the model's schema and the mapping file from the site, and any mapping that one names with `via` (such as `common/JapaneseAddress/jichitai-opendata-address` for the address columns). The conversion rules in a mapping file:

- A field with `column` (one column or a list), an optional `transform`, a constant `value`, or `via` is converted.
- The `convert.id` template names the entities.
- Fields with only `to` are documentation.
- Transforms: `text`, `code6`, `number`, `integer`, `numbers`, `flag`, `flags` (with `values`), `split`, `municipality`, `machiazaId`, `nationalShelterType` (`src/convert.mjs`).

It detects UTF-8 and Shift_JIS. It repairs only what it can prove, such as a local government code that lost its leading zero or lacks its check digit (the check digit decides), and lists every repair on standard error. Invalid rows are left out and listed by line. The exit code is 1 when a row is invalid or a file cannot be read, and 2 for a usage error.

## init

```bash
datamodels init my-node      # asks in a terminal
datamodels init --base-url https://models.example.org --publisher "Example Inc." \
  --publisher-url https://example.org/ --subject road --languages ja,en --yes
```

Starts a data model node: `node.yaml`, the first subject in `models/`, a README, `.gitignore`, the workflow that checks pull requests and publishes to GitHub Pages ([GitHub Action](#github-action)), a Dependabot configuration that proposes new releases of the Action, and `LICENSE`. In a terminal it asks for what the options do not give; in CI and scripts it never asks, and a missing answer is a usage error. Defaults: hash IRIs, English, CC0-1.0.

`LICENSE` is the legal code of the licence, for CC0-1.0 and CC-BY-4.0. For another licence, init says so, and the licence text goes into `LICENSE` by hand. A licence file under another name (`LICENSE.md`, `LICENSE.txt`, `COPYING`) counts as `LICENSE`.

It also works in an existing repository, for example one made by the Backstage scaffolder: it adds only the files that are missing, never overwrites one, and adds its lines to an existing `.gitignore`. It lists what it added and what it kept.

`--github owner/name` (or yes to the question) puts the node on GitHub with the `gh` CLI: in a folder without a remote it makes the first commit and creates the public repository; with a remote it keeps it. Either way it sets GitHub Pages to deploy from GitHub Actions.

## add

```bash
datamodels add road/RoadPatrol           # an entity type
datamodels add road/Segment --value      # a value type, used inside attributes
```

Adds a model to a subject of the node: `schema.json` (with `id` and `type` for an entity), `catalog.yaml` with a title and description in each of the node's languages, `examples/example.json`, and the type in the subject's `@context`. The skeleton builds and passes `check` at once; then add its attributes, each with an `x-iri` and a description in `catalog.yaml`.

## extend

```bash
datamodels extend task/Task road/RoadTask               # the same type, with more attributes
datamodels extend task/Task road/PatrolTask --subclass  # a subtype with its own IRI
datamodels extend                                        # in a terminal: pick the model from a list
```

Starts a model of this node from a model of another node, such as datamodels.jp's: what the [extension builder](https://datamodels.jp/guide/builder) does in the browser. The model is `<subject>/<Type>` as listed in the other node's `catalog.json`, or its type IRI; `--index` names that `catalog.json` (default: the first node in `node.yaml`, else datamodels.jp).

It copies the other model's schema at its current version, imports its `@context` (exact version) into the subject's, takes the titles and attribute descriptions from the other catalog, adapts its example, and records the model in `extends`, so `check` keeps its names and meanings. It adds the other node to `nodes` in `node.yaml` when it is not there yet. Then add this node's attributes, as for `add`.

- **Default:** the same type with more attributes. The type keeps the other model's IRI (`x-alias-of`).
- **`--subclass`:** a type of its own in this node's namespace, with the other model as its parent (`x-subclass-of`).

## export

```bash
datamodels export disaster/EvacuationSite --to csv,table-schema       # a CSV template and its Table Schema
datamodels export disaster/EvacuationSite --to ai --out schemas       # structured output for AI
datamodels export disaster/EvacuationSite --to postgis                # a PostgreSQL / PostGIS table
datamodels export road/RoadPatrol my-node --to postgis                # a model of your own node
```

Writes the files of one or more adapters for one entity model into `--out` (default: the current directory), named `<Type>.<ext>`. The model is the node's in `[dir]` (default: the current directory) when it has one; otherwise it is `<subject>/<Type>` (or its type IRI) in another node's `catalog.json`: `--index`, default the first node in `node.yaml`, else datamodels.jp. Every file uses the model's attribute names and IRIs, so data converts to the NGSI-LD form and back without a mapping.

| `--to` | File | What it is |
|---|---|---|
| `csv` | `<Type>.csv` | The header row of a CSV file: one column per attribute. Fill in one row per entity in a spreadsheet. |
| `table-schema` | `<Type>.tableschema.json` | A [Frictionless Table Schema](https://datapackage.org/standard/table-schema/) (v2) for those columns, so a CSV file can be checked with `frictionless validate` or another Table Schema tool: types, required columns, allowed values, patterns, limits. |
| `ai` | `<Type>.ai.json` | A strict JSON Schema for the structured output of a large language model, to extract entities from text: `{ name, description, strict, schema }`, the `json_schema` of OpenAI's Structured Outputs, and `schema` is the `input_schema` of a Claude tool. |
| `postgis` | `<Type>.sql` | `CREATE TABLE` for PostgreSQL with PostGIS: one row per entity, constraints for the model's rules, the location as a geometry with a GiST index, and the descriptions and IRIs in `COMMENT ON`. |

How the model becomes columns, the same in the CSV file and the table:

- One column per attribute, named as the attribute (`hazardTypes`); in SQL in snake_case (`hazard_types`). `id` is the first column and the primary key; `type` is the model.
- `location`: in the CSV file `longitude` and `latitude` (WGS 84); a model that allows other shapes than a point also has a `location` column for a GeoJSON geometry. In SQL `geometry(<type>, 4326)`, with the type the model allows (`Point`, or `Geometry` for any).
- A value type made of plain fields, such as `address` (JapaneseAddress), becomes one column per field: `address.postalCode` in the CSV file, `address_postal_code` in SQL, each with its own rules. One column per field, not one JSON column, so a spreadsheet can fill it and SQL can check and index each field.
- A list of plain values: one column, the values separated by `;` (a Table Schema `list`); in SQL an array (`text[]`) whose values are checked.
- Anything else (a JSON structure, such as the answers of a Decision): JSON in one column, checked with the attribute's JSON Schema (Table Schema `jsonSchema`; `jsonb` in SQL).
- Rules on several attributes ("at least one of externalSiteId and nationalShelterId"): a `CHECK` in SQL, a sentence in the Table Schema's and the AI schema's descriptions. Other rules (if/then) stay in the JSON Schema; the files say so.

The Table Schema has its titles and descriptions in the first language of the catalog (Japanese for datamodels.jp) and the others under `x-translations`; each column's IRI is `x-iri`, and `x-typeIri`, `x-schema` and `x-context` name the model. Table Schema has no short labels in the catalog to draw on: a title is the start of the description when that is short.

The AI schema keeps to what both OpenAI's and Anthropic's structured outputs accept, as their documentation says on 2026-10-11 ([OpenAI, supported schemas](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas), [Anthropic, JSON Schema limitations](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)): every object has `additionalProperties: false` and lists every property in `required`, and an optional attribute may be `null` instead; no `$ref` (the value types are written out); `anyOf` instead of `oneOf`; formats `date-time`, `date`, `time`, `duration`, `email`, `hostname`, `ipv4`, `ipv6` and `uuid` only; patterns without lookarounds; no `minimum`, `maximum`, `minLength`, `maxLength`, `maxItems` or `uniqueItems`, and `minItems` only 0 or 1. What it leaves out goes into the description, for example "(minimum 0; maximum 9)". `id` and `type` are not in it: your application sets them, and the key-values entity is the answer plus `id`, `type` and `@context`. Descriptions are in English. A model with an attribute that has no strict form (a map with any keys, such as Decision's answers) has no AI file.

Claude's strict mode takes at most 16 properties with a union (a type with `null`) per request, and most models have more optional attributes; `export` says so. Use the schema there as a tool's `input_schema` without `strict`, or remove the attributes you do not need. OpenAI's strict mode takes it as it is.

`build` writes the same files for every entity model of a node; see [build](#build).

## build

```bash
datamodels build             # the node in the current directory, into _site/
datamodels build my-node --out public
```

A node is a folder with `node.yaml` and `models/`. `models/` is laid out as in [geolonia/datamodels](https://github.com/geolonia/datamodels/tree/main/models): one folder per subject with `subject.yaml` and `context.jsonld`, and one folder per model with `schema.json`, `catalog.yaml` and `examples/`. A node needs only one language and has no mapping files or ADOPTERS files ([what a node publishes](https://github.com/geolonia/datamodels/blob/main/docs/node.md)).

```yaml
# node.yaml
baseUrl: https://models.example.org
iris: hash          # /ns/<subject>#<Term>; slash needs w3id.org or a server that redirects
languages: [en]
publisher: { name: { en: Example Inc. }, url: https://example.org/ }
license: CC0-1.0    # required; licenseUrl is optional
nodes:              # optional: nodes you know; a context may import theirs
  - { url: https://datamodels.jp/, index: https://datamodels.jp/catalog.json }
```

It writes `catalog.json`, the @contexts (exact version and alias), JSON Schemas, vocabularies, examples, `llms.txt`, the pages and the adapters' files: for every entity model the files of [export](#export) at `/adapters/<name>/<subject>/<Type>.<ext>` (`csv`, `table-schema`, `ai`, `postgis`), listed under `adapters` in the model's entry in `catalog.json`, as on datamodels.jp. Schemas that a model refers to on another node (such as datamodels.jp's JapaneseAddress) are read online, only from the `schema/` folder of a node listed under `nodes` in `node.yaml` (`extend` adds it); when one is elsewhere or cannot be read, that model gets no adapter files and `build` says so (`check --offline` reads none). Adapter files are rebuilt every time and are not covered by the promise that published files never change. A model that builds on another node's model lists it in `catalog.yaml` under `extends` (`typeIri`, `version`, `index`).

The pages are plain HTML in a monospace font, with no JavaScript, so they read well with `curl` too ([Eleventy](https://www.11ty.dev/) writes them):

- `/`: the subjects and their models.
- One page per subject. With hash IRIs it is the namespace document (`/ns/<subject>`, written as `ns/<subject>.html`), with an anchor for every type and attribute, so every IRI opens on it.
- One page per model (`/models/<subject>/<Type>/`), with an anchor per attribute, the standards it maps (`mapping/*.yaml`, with links to the tables) and its notes (`notes.yaml`: the sources, the decisions and their reasons), so readers can judge how well-founded it is.
- For a model that a released version had and the current one does not (renamed or removed): a page at its old address that says which versions had it, links its last schema and @context, names the current model with the same type IRI when there is one, and lists the current models. The subject page keeps an anchor for every term that earlier versions minted, so their hash IRIs still open on it. Both come from the release snapshots (`datamodels release`, `bump`).
- `/adapters/`: what each adapter writes and its file for every model. A model page has a Download line with its files and a link to its row there, without naming a product.
- `404.html`: what GitHub Pages and most static hosts show for an address with no page (for example the page of a model that a new version renamed). One page at the root, in the node's first language with the other languages' texts, linking to the index, `catalog.json` and every model.

One set of pages per language of the node: the first language at the base URL (where the IRIs open), each other one under `/<lang>/` (for example `/en/`), with a link to switch in the header. Each page shows the node's texts in its language, falling back to the first language that has one; the fixed texts are in Japanese and English (English for other languages). When English is not the first language, `catalog.json` lists the English pages as `pageUrlEn`, as datamodels.jp does. The pages follow the device's light or dark setting.

Every page links to `catalog.json` (`<link rel="alternate" type="application/json">`) and carries a description, Open Graph tags for link previews, and `<meta name="generator">`. Every page but `404.html` also carries a canonical URL and its other languages (`hreflang`); `404.html` answers at any address, so it has neither and asks not to be indexed. The footer names the toolkit and links to the guide for publishing your own models. The exit code is 1 when the node is invalid, 2 for a usage error.

## check

```bash
datamodels check             # the node in the current directory
datamodels check --offline   # without the network
```

The checks a node runs in CI before it publishes:

- Every schema compiles, and every `examples/example.json` is valid against its schema. A model has one example (`example.json`, and `example-normalized.jsonld` in the normalized form); another file in `examples/` is not read, published or validated, and is noted.
- Every entity type and attribute is a term of the subject's `@context` (or an NGSI-LD core term such as `location`), and expands to the IRI in the schema (`x-iri`). Otherwise JSON-LD drops the attribute, or gives it another meaning. A term from a context imported by URL is checked online; offline it is only noted.
- Release snapshots in `models/<subject>/releases/vX.Y.Z/`, where the node keeps them, hold exactly what the sources produce.
- An exact version (`v0.1.0`) that is already online is served unchanged. One that is not online yet is new.
- A model does not redefine a term of a model it `extends`: the same name keeps the same IRI.

The exit code is 1 on a problem. Another node that cannot be reached, or does not answer within 20 seconds, is only noted: a node that is down never fails someone else's check. `--offline` skips the published files, the extended models and schemas on other sites.

## release

```bash
datamodels release road      # in the node's directory
```

Keeps the current version of a subject online. A node's site holds the current version of each subject; when `subject.yaml` gets a new version, the files of the old one leave the site, although data may still point to them. `release` writes a snapshot of the current version's @context, vocabulary and schemas into `models/<subject>/releases/vX.Y.Z/`; `build` publishes every snapshot next to the current version.

Run it once a version is published, before you change its sources, and commit the snapshot. Online, it first compares the snapshot with the published files and refuses when the sources changed since, or when the site does not answer: then restore them (for example with git), release, and make the change with a new version. A snapshot that exists is kept; `build` stops when the sources of a released version change. `check` notes a published version that has no snapshot yet. `--offline` skips the comparison.

## bump

```bash
datamodels bump road minor   # 0.1.0 → 0.2.0
```

Gives a subject a new version: `patch`, `minor` or `major`, as in [Semantic Versioning](https://semver.org/) (major for a change that breaks existing data). It runs `release` first, so the current version stays online and is compared with the published files, then raises `version` in `subject.yaml` and the version in the subject's own schema URLs (`$id`, and `$ref` between its models). `--offline` releases without the comparison.

## upgrade

```bash
datamodels upgrade              # the latest release
datamodels upgrade --to v0.3.0
```

Moves the node to a release of this toolkit: the Action in `.github/workflows/` is pinned to the release's commit SHA, with the tag as a comment, and `npx github:geolonia/datamodels-toolkit#vX.Y.Z` in the Markdown files at the top of the node runs that release. It reads the release from the GitHub API. Dependabot does the same for the workflow, a week or so later.

## GitHub Action

This repository is also a GitHub Action: it runs `check` and `build` and deploys the node to GitHub Pages. A node's workflow:

```yaml
# .github/workflows/publish.yml
name: Publish
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions: {}

jobs:
  check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: geolonia/datamodels-toolkit@dcde74fb4c84710d2514a0ed0539e0d3840fd323 # v0.3.3
        with:
          deploy: 'false'

  publish:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.node.outputs.page_url }}
    concurrency:
      group: pages
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - id: node
        uses: geolonia/datamodels-toolkit@dcde74fb4c84710d2514a0ed0539e0d3840fd323 # v0.3.3
```

In the repository settings, set Pages to deploy from GitHub Actions. Inputs: `directory` (default `.`), `deploy` (default `true`), `offline` (default `false`). A node upgrades by changing the pinned version; Dependabot can propose it. `datamodels init` writes this workflow.

## Build library

`@geolonia/datamodels/build` builds the machine-readable files of a catalog from a models folder: every published version, the @contexts, vocabularies, JSON Schemas, examples, mapping files and `catalog.json`. It is the code datamodels.jp runs, with the base URL and the required languages as options, so a node of the [web of data models](https://github.com/geolonia/datamodels/issues/200) builds its files the same way ([what a node publishes](https://github.com/geolonia/datamodels/blob/main/docs/node.md)).

```js
import { catalogUrls, loadSubjects, publishCatalog } from '@geolonia/datamodels/build';

const urls = catalogUrls('https://models.example.org');
const subjects = await loadSubjects('models', { urls, languages: ['en'], subjectFields: ['title', 'description'] });
await publishCatalog(subjects, { urls, outDir: 'dist', languages: ['en'], head: { license: 'CC0-1.0' } });
```

## Agent skill

`skills/datamodels/SKILL.md` gives an AI agent the catalog's modelling rules and this toolkit's workflow (find before you define, alias or subclass, `bump` before changing a published model, and more). It points the agent to https://datamodels.jp/llms.txt for the models themselves. For Claude Code, copy the folder into your project's `.claude/skills/` (or `~/.claude/skills/` for every project):

```bash
mkdir -p .claude/skills && cp -R path/to/datamodels-toolkit/skills/datamodels .claude/skills/
```

## Development

```bash
npm ci
npm test
```

The tests read `test/fixtures/site/`, a copy of the files datamodels.jp serves for the mappings they use. After the catalog changes one of those models or mappings, refresh it with `npm run fixtures` and commit the result.

`test/fixtures/catalog/` holds the sources of two subjects of [geolonia/datamodels](https://github.com/geolonia/datamodels) and the files datamodels.jp serves for them; the build library must produce exactly those files. Refresh it with `npm run fixtures:build -- <path to a datamodels checkout>` when the catalog changes those subjects.

## Issues and contributions

Problems with the tool go to [this repository's issues](https://github.com/geolonia/datamodels-toolkit/issues). Questions about a model or a mapping file go to [geolonia/datamodels](https://github.com/geolonia/datamodels/issues), where the conversion rules live. Pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

The code is [Apache-2.0](LICENSE). The files in `test/fixtures/site/` come from datamodels.jp and are CC0 1.0 ([licence](https://datamodels.jp/LICENSE-CONTENT)). The sample rows in the tests come from Utsunomiya City's and GSI's published lists (CC BY 4.0 and compatible terms), credited where they are used.
