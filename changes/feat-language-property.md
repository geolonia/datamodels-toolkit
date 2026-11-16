---
section: Added
---
- A model may declare `"x-ngsi": { "type": "LanguageProperty" }` for a name or text in several languages. Its schema describes the language map: `"type": "object"` with string values, written out (a `$ref` or `allOf` is not accepted yet), or a `"type": "array"` of them when the attribute is multi-valued. Its key-values form keeps the `{"languageMap": {...}}` wrapper as NGSI-LD's simplified form does, and `convert` and `check` handle it like JsonProperty and VocabProperty. `check` compares language tags case-insensitively, since JSON-LD lowercases them (`zh-Hant` comes back as `zh-hant`). The GeonicDB adapter sends it as a LanguageProperty with the value type of its schema (`object`, or `array` when multi-valued).
