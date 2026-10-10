# Changelog

All notable changes to `@geolonia/datamodels`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow [Semantic Versioning](https://semver.org/). Before 1.0.0, a minor version may change the command line.

## [Unreleased]

### Added

- `@geolonia/datamodels/build`: builds a catalog's machine-readable files from a models folder, the code of datamodels.jp with the base URL and the languages as options (#10). Its output for datamodels.jp's sources is byte for byte what the site serves.
- `datamodels build`: writes the files a node of the web of data models publishes, from its `node.yaml` and `models/` folder: `catalog.json` with the publisher, licence and known nodes, the @contexts, JSON Schemas, vocabularies, examples and `llms.txt` (#12).
- The pages of a node, written with [Eleventy](https://www.11ty.dev/): plain HTML, monospace, no JavaScript; a page per subject with an anchor per term (the namespace document with hash IRIs) and a page per model with an anchor per attribute (#12).
- `datamodels check`: a node's schemas and examples, its release snapshots, its published versions online, and the terms of the models it extends (#12). `--offline` skips the network.
- `datamodels init`: starts a node with every file it needs (no template repository), in a new folder or an existing repository without overwriting anything; asks with [@clack/prompts](https://github.com/bombshell-dev/clack) only in a terminal; `--github owner/name` creates the repository and turns on Pages with `gh` (#11).
- A GitHub Action (`action.yml`): checks and builds a node and deploys it to GitHub Pages (#14). Tested in CI on `test/fixtures/node`.
- Hash IRIs (`/ns/<subject>#<Term>`), the default for nodes; `extends` in a model's `catalog.yaml` goes into `catalog.json` (#12).
- `datamodels --help` lists the commands; `datamodels <command> --help` explains each option (#6).

### Changed

- The command line is built on [commander](https://github.com/tj/commander.js) (#9), ready for more commands. `--help` also lists the arguments; error messages and exit codes stay the same.
- `--normalized`: dates follow the catalog's rule (geolonia/datamodels#183). An attribute with `format: date` becomes `{"@type": "Date"}`, and one that takes a date or a date-time (Task's `start` and `due`) gets the type that fits the value.

## 0.1.0 - not released yet

First version: the CSV converter moved from [geolonia/datamodels](https://github.com/geolonia/datamodels) ([geolonia/datamodels#91](https://github.com/geolonia/datamodels/issues/91)).

### Added

- `datamodels convert <subject>/<Type> <mapping> <file.csv>`: turns a published list (CSV, UTF-8 or Shift_JIS) into entities of a catalog model and validates each one against the model's JSON Schema. Options `--set`, `--normalized`, `--out` and `--site` (#1).
- Reads `catalog.json`, the schemas and the mapping files from datamodels.jp, or from a local copy of the site (#1).
- Checks the transform names of a mapping, and of the mappings it reaches through `via`, before any row is read (#1).
- Lists the columns a mapping reads but the file does not have; such a column gives no value, never `false` (#1).
- Empty records are left out and listed, also `""` in a one-column file (#4).
- Errors are one line on standard error; exit code 1 for invalid rows or unreadable files, 2 for usage errors. Output written to a pipe is complete (#1, #4).

[Unreleased]: https://github.com/geolonia/datamodels-toolkit/commits/main
