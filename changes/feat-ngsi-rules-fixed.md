---
section: Fixed
---
- An attribute named `__proto__` is kept as an attribute by `toKeyValues`, `unwrapKeyValues`, `wrapKeyValues` and `toNormalized` in `@geolonia/datamodels/ngsi`. Before, it was dropped and changed the prototype of the result instead. `datamodels check` now also reports it in the key-values form of `example-normalized.jsonld` when the schema allows no other properties.
