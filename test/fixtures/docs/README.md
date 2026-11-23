# Inputs of the documented examples

`test/docs-examples.test.mjs` runs the command examples of the toolkit pages on
datamodels.jp (`site/toolkit/` in geolonia/datamodels) with these files, and
compares what each command prints and writes with `test/golden/docs/`.

The CSV files have the names and columns of the files the pages use. Their rows
are made up, apart from 番町小学校 in `13101_2.csv` (GSI, CC BY 4.0 compatible).

- `092011_evacuation_space.csv`: a municipal standard list of evacuation sites (03), one row with a broken latitude.
- `13101_2.csv`: GSI's designated emergency evacuation sites of Chiyoda City, with a BOM.
- `my-list.csv`: a list that follows no standard; `my-list.filled.yaml` is its mapping once the TODOs are filled in (step 2 of the page).
- `sites.csv`: the model's CSV template with only some of its columns.
