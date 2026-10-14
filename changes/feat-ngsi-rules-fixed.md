---
section: Fixed
---
- An attribute named `__proto__` is kept as an attribute by `toKeyValues` and `toNormalized` in `@geolonia/datamodels/ngsi`. Before, they dropped it and changed the prototype of the result instead. `datamodels check` now also reports it in the key-values form of `example-normalized.jsonld` when the schema allows no other properties.
