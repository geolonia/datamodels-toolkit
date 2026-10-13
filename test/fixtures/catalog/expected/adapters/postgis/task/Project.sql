-- Project: https://datamodels.jp/ns/task/Project
-- task v1.0.0. JSON Schema: https://datamodels.jp/schema/task/Project/v1.0.0.json
-- @context: https://datamodels.jp/context/task/v1.jsonld
-- Columns are the attributes in snake_case; <attribute>_<field> columns are the fields of one value (an address).
CREATE TABLE project (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  identifier text,
  parent text,
  project_status text,
  is_public boolean,
  homepage text,
  start text,
  "end" text,
  location geometry(Geometry, 4326),
  keywords text[],
  source text,
  external_id text,
  date_created timestamptz,
  date_modified timestamptz,
  CHECK (project_status IN ('active', 'closed', 'archived')),
  CHECK (start ~ E'^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}))?$'),
  CHECK ("end" ~ E'^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}))?$'),
  CHECK (array_position(keywords, NULL) IS NULL)
);
CREATE INDEX project_location_idx ON project USING gist (location);
COMMENT ON TABLE project IS 'プロジェクト。タスクをまとめる単位です。案件、災害対応の 1 つのオペレーション、キャンペーンなど、用途によって呼び方は変わっても、共通の属性を持ちます。
Project. A grouping of tasks: a project in a tracker, one disaster-response operation, a campaign. Called differently in different settings, with the same common attributes.
<https://datamodels.jp/ns/task/Project>';
COMMENT ON COLUMN project.id IS 'エンティティの ID（URI。例：urn:ngsi-ld:Project:001）
Entity id: a URI, for example urn:ngsi-ld:Project:001';
COMMENT ON COLUMN project.name IS '名称・件名
Name or subject
<https://uri.etsi.org/ngsi-ld/name>';
COMMENT ON COLUMN project.description IS '説明
Description
<http://purl.org/dc/terms/description>';
COMMENT ON COLUMN project.identifier IS '短い識別子（スラッグやコード。元のシステムの中で一意）
Short handle: a slug or code, unique within the source system
<https://schema.org/identifier>';
COMMENT ON COLUMN project.parent IS '親プロジェクト
Parent project
<https://datamodels.jp/ns/task/parent>';
COMMENT ON COLUMN project.project_status IS '状態：active（進行中）、closed（終了）、archived（アーカイブ済み。使わなくなったが残している）。status は core context の予約語なので、projectStatus という名前にしています。
State: active = in progress, closed = finished, archived = no longer used but kept; status is protected in the core context, hence projectStatus
<https://datamodels.jp/ns/task/projectStatus>';
COMMENT ON COLUMN project.is_public IS '公開プロジェクトなら true
true when public
<https://datamodels.jp/ns/task/isPublic>';
COMMENT ON COLUMN project.homepage IS 'ホームページ
Homepage
<https://schema.org/url>';
COMMENT ON COLUMN project.start IS '予定期間の開始。日付か日時
Planned start: a date, or a date and time
<https://datamodels.jp/ns/task/start>';
COMMENT ON COLUMN project."end" IS '予定期間の終了。日付か日時
Planned end: a date, or a date and time
<https://datamodels.jp/ns/task/end>';
COMMENT ON COLUMN project.location IS '位置。点、線、面、それらの集まりなど、任意の GeoJSON ジオメトリ
Location as any GeoJSON geometry: point, line, polygon or a collection
<https://uri.etsi.org/ngsi-ld/location>';
COMMENT ON COLUMN project.keywords IS 'キーワード、ラベル
Keywords or labels
<https://schema.org/keywords>';
COMMENT ON COLUMN project.source IS '元のシステムでのこのプロジェクトの URL
URL of this object in the system of record
<https://smart-data-models.github.io/data-models/terms.jsonld#/definitions/source>';
COMMENT ON COLUMN project.external_id IS '元のシステムでの識別子
Identifier in the system of record
<https://datamodels.jp/ns/task/externalId>';
COMMENT ON COLUMN project.date_created IS '元のシステムでの作成日時（ブローカーの createdAt とは別）
Creation time in the system of record (distinct from the broker attribute createdAt)
<https://smart-data-models.github.io/data-models/terms.jsonld#/definitions/dateCreated>';
COMMENT ON COLUMN project.date_modified IS '元のシステムでの更新日時
Last modification time in the system of record
<https://smart-data-models.github.io/data-models/terms.jsonld#/definitions/dateModified>';
