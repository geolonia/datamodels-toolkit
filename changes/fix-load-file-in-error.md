---
section: Fixed
---
- A JSON or YAML file in models/ that does not parse is named in the error (`road/context.jsonld: …`), not only the parser's message; also in `datamodels add` and `extend`. An empty `subject.yaml` is reported by its missing name instead of a crash.
