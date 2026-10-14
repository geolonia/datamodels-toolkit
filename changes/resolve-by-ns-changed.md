---
section: Changed
---
- `export` and `extend` with a type IRI and no `--index`: the node that made the IRI now comes before a model with the same IRI (an alias) in the first node of `node.yaml`. For example, datamodels.jp's `Task` IRI now gives datamodels.jp's `Task`, not GTT's `Issue`. `extend` records that node in `extends[].index` and, when it is new, in `node.yaml`. To get the alias, give `--index` with the alias's node, or `<subject>/<Type>` (geolonia/datamodels#222).
