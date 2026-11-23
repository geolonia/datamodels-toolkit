---
section: Fixed
---
- The GeonicDB adapter no longer sends the ISO 8601 duration `pattern` (`^P(?!$)…`). GeonicDB v0.25.0 and later refuse it as possible catastrophic backtracking, so bodies with a duration (datamodels.jp's Task and four fieldservice models) could not be registered at all. A note says the pattern was left out. GeonicDB then does not check the duration's format until geolonia/geonicdb#4180 is fixed.
