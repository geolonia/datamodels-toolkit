---
section: Changed
---
- `export` and `extend` now read the model from the node that made the IRI, even when the first node in node.yaml (else datamodels.jp) lists an alias with the same IRI. To get the alias, give `--index` with the alias's node, or give the alias as `<subject>/<Type>` when that node is the first one in node.yaml. `extend` records the node it used in `extends[].index` and, when it is new, in node.yaml (geolonia/datamodels#222).
- `node.yaml`: `nodes[].url`, `nodes[].index` and `extends[].index` in catalog.yaml must be https URLs, as the toolkit reads other nodes only over https. The error says to change `http://` to `https://`.
