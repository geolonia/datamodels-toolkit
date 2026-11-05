---
section: Added
---
- A GeonicDB adapter for every node, off by default: with `adapters: [geonicdb]` in `node.yaml`, the build publishes a ready-made Custom Data Model body per entity model at `/adapters/geonicdb/<subject>/<Type>.json` and lists it under `adapters` in `catalog.json`, so GeonicDB can register the model by its URL (`sourceUrl`). Model pages do not link it: they stay product-neutral. `datamodels export <subject>/<Type> --to geonicdb` writes one body, from this node or another node's catalog. The conversion is the one datamodels.jp uses, moved from geolonia/datamodels; for datamodels.jp's models it gives the same files (#134).
