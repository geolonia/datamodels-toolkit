---
section: Added
---
- `datamodels check` checks more rules of the models (geolonia/datamodels#226): an alias (`x-alias-of`) has the attributes, requirements and kind of its type; a subclass (`x-subclass-of`) uses its parent's IRIs and NGSI-LD types and stays as strict; one model per type IRI; `x-personal-data` is `true` or left out; `catalog.yaml` has the title, description and every attribute in every language of the node, and no attribute that the schema lacks; `status` and `supersededBy`; the shape of `notes.yaml`. It lists every missing text at once.
