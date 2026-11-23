---
section: Added
---
- The GeonicDB adapter sends a Relationship's target type as `objectType`, the full type IRI of `x-ngsi.target`. It sends none for `any` or `agent`, and none for a target in the model's own subject when a tenant variant renames types (`typePrefix`, `typeName`). It also sends a list's rules in GeonicDB's form: `validation.items` with the scalar rules of its items, and `minItems`, `maxItems` and `uniqueItems`. Scalar rules at the top level of a list are no longer sent. GeonicDB checks both from v0.25.0 and refuses a body with them before that (geolonia/datamodels#300).
