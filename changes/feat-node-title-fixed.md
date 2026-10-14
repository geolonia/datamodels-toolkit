---
section: Fixed
---
- `datamodels nodes` and `datamodels search` skip an empty or non-text publisher name in another language: a node whose `catalog.json` has `name: { en: " ", ja: X }` is named X, no longer by its host.
