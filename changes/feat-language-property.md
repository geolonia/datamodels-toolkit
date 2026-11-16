---
section: Added
---
- A model may declare `"x-ngsi": { "type": "LanguageProperty" }` for a name or text in several languages. Its schema describes the language map (`"type": "object"` with string values), its key-values form keeps the `{"languageMap": {...}}` wrapper as NGSI-LD's simplified form does, `convert` and `check` handle it like JsonProperty and VocabProperty, and the GeonicDB adapter sends it as a LanguageProperty with the value type `object`.
