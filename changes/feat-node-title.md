---
section: Added
---
- `node.yaml` takes an optional `title` and `description` of the node, each a text in every language of the node, like `subject.yaml` (geolonia/datamodels#220). `catalog.json` lists them at the top (still `formatVersion: 1`). The pages use the title as the site's name, and the home page shows the description; `llms.txt` uses them too. Without them, every file stays as before. `datamodels check` reports a text that is missing a language of the node, a value that is not a text per language, and a key that is not a language. `datamodels init` writes both, commented out, to fill in.
- `datamodels nodes` and `datamodels search` show a node by its title when its `catalog.json` has one; `--json` adds `title` to each node and `siteTitle` to each result.
