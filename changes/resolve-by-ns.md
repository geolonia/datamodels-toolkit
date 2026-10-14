---
section: Added
---
- `export` and `extend` find a model of another node by its type IRI without `--index`: they first read the index of the node that made the IRI (the part before `/ns/`, plus `catalog.json`), and use it when it lists the model; otherwise they read the index they read before. Only https on a public host is read (geolonia/datamodels#222).
- `indexForIri()` in `@geolonia/datamodels/build`: the index URL of the node that made a type IRI, or null.
