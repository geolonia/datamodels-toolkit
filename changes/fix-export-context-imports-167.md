---
section: Security
---
- `datamodels export --to geonicdb` reads the contexts that a remote model's context imports only under that catalog's own `context/` path, as it already did for the context itself, and follows no redirect out of that path, for the context itself too (#167). An import elsewhere is not read: the model's context terms stay open, and a model that needs them gets a note instead of a body. Before, such an import was read from any public https host (always through the shared reader), and its terms could become a VocabProperty's allowed terms in the generated body.
