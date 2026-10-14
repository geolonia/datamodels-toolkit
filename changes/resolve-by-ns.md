---
section: Added
---
- `export` and `extend` find a model of another node by its type IRI without `--index`: they first read the index of the node that made the IRI (the part before `/ns/`, plus `catalog.json`), and use it when it lists the model; otherwise they read the index they read before, and its error says why the first one was not used. That first index is read only over https from a public host name, and for at most 5 seconds (geolonia/datamodels#222).
- `indexForIri()` in `@geolonia/datamodels/build`: the index URL of the node that made a type IRI, or null.
- `extend` says which index it read the model from.
