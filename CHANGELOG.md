# Changelog

All notable changes to `@geolonia/datamodels`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow [Semantic Versioning](https://semver.org/). Before 1.0.0, a minor version may change the command line.

## [Unreleased]

### Changed

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
