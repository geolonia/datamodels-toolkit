# datamodels-toolkit (`@geolonia/datamodels` CLI + GitHub Action + build library)

Canonical docs (do not duplicate): AGENTS.md (setup, test, hard constraints incl. no `process.exit()`, changes/ files), README.md (commands, Action, build library exports, release steps), CONTRIBUTING.md, changes/README.md. User-facing command docs live in the OTHER repo: geolonia/datamodels `site/toolkit/` + `site/en/toolkit/` — a CLI change needs a PR there too.

Source map:
- `bin/datamodels.mjs` = CLI entry (commander); most subcommands implemented in `src/<name>.mjs` (convert, mapping, export, init, add, extend, release, version, discover, catalog); check/build live in `src/build/`.
- `src/build/` = build library (`./build` export) used by datamodels.jp itself and by every node; also `check.mjs`, `model-rules.mjs` (generic model rules), Eleventy page templates (`pages/`, `eleventy.config.mjs`).
- `src/ngsi.mjs` = `./ngsi` export; must stay import-free (runs in browser/Worker).
- `src/adapters/` = export targets (`./adapters` export).
- `action.yml` = composite GitHub Action; `init` pins it via `ACTION_REF`/`ACTION_VERSION` in `src/init.mjs`.
- `skills/datamodels/SKILL.md` = agent skill, not shipped in npm package.

Cross-repo: datamodels (catalog) consumes this package at a pinned exact version; `test/fixtures/catalog/` must match what the catalog build produces (refresh with `npm run fixtures:build -- <datamodels checkout>`).

Further: `mem:tech_stack`, `mem:suggested_commands`, `mem:conventions`, `mem:task_completion`.
