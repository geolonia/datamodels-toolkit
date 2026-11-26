---
section: Changed
---
- The GeonicDB adapter sends the ISO 8601 duration `pattern` again (Task's `estimatedDuration`, the fieldservice durations), so GeonicDB checks a duration's format. It needs GeonicDB v0.29.0 or later: v0.25.0 to v0.28.x refuse the pattern and with it the whole body (geolonia/geonicdb#4180, fixed in v0.29.0).
