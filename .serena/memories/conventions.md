# Conventions

Authoritative list: AGENTS.md "Constraints" and CONTRIBUTING.md. Key ones agents trip on:
- Never `process.exit()` in CLI code; throw `Exit` or return the code from `main()`.
- User-visible change → new `changes/<branch>.md` (one section per file); never edit CHANGELOG.md outside a release PR.
- Conversion rules belong to the catalog's mapping files; don't encode model-specific logic here.
- New subcommands need a named user + task (geolonia/datamodels#91).
- Plain, simple English in comments/commits/docs. DCO sign-off (`git commit -s`).
- Tests: `test/<topic>.test.mjs`, usually named after the command or build module (not 1:1). Behaviour changes need a test.
