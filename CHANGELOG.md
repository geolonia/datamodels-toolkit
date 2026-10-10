# Changelog

All notable changes to `@geolonia/datamodels`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow [Semantic Versioning](https://semver.org/). Before 1.0.0, a minor version may change the command line.

## [Unreleased]

### Changed

- `datamodels init` writes a workflow pinned to the v0.2.0 release, and a README whose `npx` commands run v0.2.0.

## [0.2.0] - 2026-10-11

The tools for keeping and growing a data model node: `release` keeps a published version online, `extend` starts a model from another node's model, and `check` compares every type and attribute with the `@context`.

### Added

- `datamodels extend <model> <subject>/<Type>`: starts a model from a model of another node, such as datamodels.jp's, as the same type with more attributes or as a subtype (`--subclass`). It copies the schema, imports the @context, records `extends` and lists the node in `node.yaml`. In a terminal it asks for the model (#13).
- `datamodels release <subject>`: keeps a published version online after the next one, as a snapshot in `models/<subject>/releases/vX.Y.Z/`. It refuses when the sources changed since the version was published. `check` notes a published version without a snapshot (#27).

### Changed

- `datamodels init` writes a workflow that pins the Action to the v0.1.0 release (its commit SHA, with the tag as a comment), instead of `main`. Dependabot can then propose newer releases.
- The README that `datamodels init` writes runs the same release with `npx` (`#v0.1.0`), instead of the latest commit.

### Fixed

- `datamodels check` finds an entity type or attribute that is missing from the `@context`, or that the `@context` expands to another IRI than the schema's `x-iri`, and a redefined NGSI-LD core term (#26).

## [0.1.0] - 2026-10-10

First release: the CSV converter moved from [geolonia/datamodels](https://github.com/geolonia/datamodels) ([geolonia/datamodels#91](https://github.com/geolonia/datamodels/issues/91)), and the tools to publish a data model node of the [web of data models](https://github.com/geolonia/datamodels/issues/200).

### Added

- `datamodels convert <subject>/<Type> <mapping> <file.csv>`: turns a published list (CSV, UTF-8 or Shift_JIS) into entities of a catalog model and validates each one against the model's JSON Schema. Options `--set`, `--normalized`, `--out` and `--site` (#1).
- Reads `catalog.json`, the schemas and the mapping files from datamodels.jp, or from a local copy of the site (#1).
- Checks the transform names of a mapping, and of the mappings it reaches through `via`, before any row is read (#1).
- Lists the columns a mapping reads but the file does not have; such a column gives no value, never `false` (#1).
- Empty records are left out and listed, also `""` in a one-column file (#4).
- Errors are one line on standard error; exit code 1 for invalid rows or unreadable files, 2 for usage errors. Output written to a pipe is complete (#1, #4).
- `@geolonia/datamodels/build`: builds a catalog's machine-readable files from a models folder, the code of datamodels.jp with the base URL and the languages as options (#10). Its output for datamodels.jp's sources is byte for byte what the site serves.
- `datamodels build`: writes the files a node of the web of data models publishes, from its `node.yaml` and `models/` folder: `catalog.json` with the publisher, licence and known nodes, the @contexts, JSON Schemas, vocabularies, examples and `llms.txt` (#12).
- The pages of a node, written with [Eleventy](https://www.11ty.dev/): plain HTML, monospace, no JavaScript; a page per subject with an anchor per term (the namespace document with hash IRIs) and a page per model with an anchor per attribute (#12).
- `datamodels check`: a node's schemas and examples, its release snapshots, its published versions online, and the terms of the models it extends (#12). `--offline` skips the network.
- `datamodels init`: starts a node with every file it needs (no template repository), in a new folder or an existing repository without overwriting anything; asks with [@clack/prompts](https://github.com/bombshell-dev/clack) only in a terminal; `--github owner/name` creates the repository and turns on Pages with `gh` (#11).
- `datamodels add <subject>/<Type>`: a new model in a node that builds and passes `check` at once; `--value` for a value type (#13).
- A GitHub Action (`action.yml`): checks and builds a node and deploys it to GitHub Pages (#14). Tested in CI on `test/fixtures/node`.
- Hash IRIs (`/ns/<subject>#<Term>`), the default for nodes; `extends` in a model's `catalog.yaml` goes into `catalog.json` (#12).
- `datamodels --help` lists the commands; `datamodels <command> --help` explains each option (#6).
- The command line is built on [commander](https://github.com/tj/commander.js) (#9); `--help` also lists the arguments.
- `--normalized`: dates follow the catalog's rule (geolonia/datamodels#183). An attribute with `format: date` becomes `{"@type": "Date"}`, and one that takes a date or a date-time (Task's `start` and `due`) gets the type that fits the value.

[Unreleased]: https://github.com/geolonia/datamodels-toolkit/compare/v0.2.0...main
[0.2.0]: https://github.com/geolonia/datamodels-toolkit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/geolonia/datamodels-toolkit/releases/tag/v0.1.0
