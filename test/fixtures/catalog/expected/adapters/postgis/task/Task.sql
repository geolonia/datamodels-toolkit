-- Task: https://datamodels.jp/ns/task/Task
-- task v1.0.0. JSON Schema: https://datamodels.jp/schema/task/Task/v1.0.0.json
-- @context: https://datamodels.jp/context/task/v1.jsonld
-- Columns are the attributes in snake_case; <attribute>_<field> columns are the fields of one value (an address).
CREATE TABLE task (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  project text,
  milestone text,
  parent text,
  related_to text[],
  refers_to text,
  progress text,
  status_label text,
  subtype text,
  priority bigint,
  assignee text[],
  author text,
  start text,
  due text,
  completed_at timestamptz,
  estimated_duration text,
  percent_complete bigint,
  keywords text[],
  location geometry(Geometry, 4326),
  spatial_id text[],
  is_private boolean,
  source text,
  external_id text,
  date_created timestamptz,
  date_modified timestamptz,
  CHECK (cardinality(related_to) >= 1),
  CHECK (array_position(related_to, NULL) IS NULL),
  CHECK (progress IN ('needs-action', 'in-process', 'completed', 'failed', 'cancelled')),
  CHECK (char_length(status_label) >= 1),
  CHECK (priority >= 0),
  CHECK (priority <= 9),
  CHECK (cardinality(assignee) >= 1),
  CHECK (array_position(assignee, NULL) IS NULL),
  CHECK (start ~ E'^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}))?$'),
  CHECK (due ~ E'^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}))?$'),
  CHECK (estimated_duration ~ E'^P(?!$)(\\d+Y)?(\\d+M)?(\\d+W)?(\\d+D)?(T(?=\\d)(\\d+H)?(\\d+M)?(\\d+S)?)?$'),
  CHECK (percent_complete >= 0),
  CHECK (percent_complete <= 100),
  CHECK (array_position(keywords, NULL) IS NULL),
  CHECK (array_position(spatial_id, NULL) IS NULL),
  CHECK (progress IS NOT NULL OR status_label IS NOT NULL)
);
CREATE INDEX task_location_idx ON task USING gist (location);
COMMENT ON TABLE task IS 'タスク。追跡の対象となる作業の単位です。課題管理システムの「チケット」や「Issue」、カレンダーの ToDo、自治体の作業指示などにあたります。状態と優先度の値は RFC 8984（JSCalendar）に合わせ、元のシステム固有の状態名や種別は statusLabel と subtype に残します。位置には任意のジオメトリを使えます。progress、statusLabel のどれか 1 つは必須です。
Task. A tracked unit of work: a ticket or issue in a tracker, a calendar to-do, a municipal work order. State and priority follow RFC 8984 (JSCalendar); the source system''s own status name and kind are kept in statusLabel and subtype. Location may be any geometry. At least one of progress, statusLabel is needed.
<https://datamodels.jp/ns/task/Task>';
COMMENT ON COLUMN task.id IS 'エンティティの ID（URI。例：urn:ngsi-ld:Task:001）
Entity id: a URI, for example urn:ngsi-ld:Task:001';
COMMENT ON COLUMN task.name IS '名称・件名
Name or subject
<https://uri.etsi.org/ngsi-ld/name>';
COMMENT ON COLUMN task.description IS '説明
Description
<http://purl.org/dc/terms/description>';
COMMENT ON COLUMN task.project IS '所属するプロジェクト（元のシステムにプロジェクトの概念があるとき）
The project this belongs to, when the source system has projects
<https://datamodels.jp/ns/task/project>';
COMMENT ON COLUMN task.milestone IS '予定しているマイルストーン（バージョン、リリース）
The milestone (version, release) this is planned for
<https://datamodels.jp/ns/task/milestone>';
COMMENT ON COLUMN task.parent IS '親タスク（RFC 8984 relatedTo parent）
Parent task (RFC 8984 relatedTo parent)
<https://datamodels.jp/ns/task/parent>';
COMMENT ON COLUMN task.related_to IS '関連するタスク。key-values の形では、対象が 1 つでも配列です。関係の種類（blocks、precedes、duplicates など）は拡張で表します。
Related tasks. Always an array in the key-values form, even with one target. The kind of relation (blocks, precedes, duplicates) is left to extensions
<https://datamodels.jp/ns/task/relatedTo>';
COMMENT ON COLUMN task.refers_to IS 'このタスクが対象とするエンティティ（通報、設備、道路など）
The entity this task is about (a report, an asset, a road)
<https://datamodels.jp/ns/task/refersTo>';
COMMENT ON COLUMN task.progress IS '正規化した進行状態（RFC 8984 progress）：needs-action（未着手）、in-process（対応中）、completed（完了）、failed（失敗）、cancelled（取消）。合う値がないときは省き、statusLabel に元の呼び方を書きます。
Normalised state (RFC 8984 progress): needs-action = not started, in-process = in progress, completed = done, failed = failed, cancelled = cancelled. When no value fits, leave it out and give the local wording in statusLabel.
<https://datamodels.jp/ns/task/progress>';
COMMENT ON COLUMN task.status_label IS '元のシステムの状態名をそのまま（「対応中」「解決」など）。progress を省いたときは必須です。
The source system''s own status name, unchanged (for example "In progress", "Resolved"). Required when progress is left out
<https://datamodels.jp/ns/task/statusLabel>';
COMMENT ON COLUMN task.subtype IS '元のシステムでの種別（トラッカー、Issue のタイプ、カテゴリなど）
The source system''s kind, for example a tracker, an issue type or a category
<https://datamodels.jp/ns/task/subtype>';
COMMENT ON COLUMN task.priority IS '優先度 0〜9。1 が最高、9 が最低で、0 は未定義です（RFC 8984）。
Priority 0 to 9: 1 highest, 9 lowest, 0 undefined (RFC 8984)
<https://datamodels.jp/ns/task/priority>';
COMMENT ON COLUMN task.assignee IS '担当する人、組織、チーム（そのエンティティ。この分野の外の URN でも構いません）。key-values の形では、対象が 1 つでも配列です。
Assignees: person, organisation or team entities, possibly outside this subject. Always an array in the key-values form, even with one target
<https://datamodels.jp/ns/task/assignee>';
COMMENT ON COLUMN task.author IS '作成者（人、組織、チームのエンティティ）
Creator (a person, organisation or team entity)
<https://schema.org/author>';
COMMENT ON COLUMN task.start IS '開始の予定。日付か日時（RFC 8984 start）
Planned start: a date, or a date and time (RFC 8984 start)
<https://datamodels.jp/ns/task/start>';
COMMENT ON COLUMN task.due IS '期限。日付か日時（RFC 8984 due）
Due: a date, or a date and time (RFC 8984 due)
<https://datamodels.jp/ns/task/due>';
COMMENT ON COLUMN task.completed_at IS 'progress が completed になった日時
When progress became completed
<https://datamodels.jp/ns/task/completedAt>';
COMMENT ON COLUMN task.estimated_duration IS '見積もった作業時間。ISO 8601 の期間（例：PT1H30M）で書きます（RFC 8984 estimatedDuration）。
Estimated effort as an ISO 8601 duration, e.g. PT1H30M (RFC 8984 estimatedDuration)
<https://datamodels.jp/ns/task/estimatedDuration>';
COMMENT ON COLUMN task.percent_complete IS '進捗率 0〜100（RFC 8984 percentComplete）
Completion 0 to 100 (RFC 8984 percentComplete)
<https://datamodels.jp/ns/task/percentComplete>';
COMMENT ON COLUMN task.keywords IS 'キーワード、ラベル
Keywords or labels
<https://schema.org/keywords>';
COMMENT ON COLUMN task.location IS '位置。点、線、面、それらの集まりなど、任意の GeoJSON ジオメトリ
Location as any GeoJSON geometry: point, line, polygon or a collection
<https://uri.etsi.org/ngsi-ld/location>';
COMMENT ON COLUMN task.spatial_id IS 'タスクの範囲を覆う空間 ID（ZFXY）。任意です。
Spatial IDs (ZFXY) covering the task. Optional
<https://datamodels.jp/ns/task/spatialId>';
COMMENT ON COLUMN task.is_private IS '非公開なら true。既定は false です。
true when private; default false
<https://datamodels.jp/ns/task/isPrivate>';
COMMENT ON COLUMN task.source IS '元のシステムでのこのタスクの URL
URL of this object in the system of record
<https://smart-data-models.github.io/data-models/terms.jsonld#/definitions/source>';
COMMENT ON COLUMN task.external_id IS '元のシステムでの識別子
Identifier in the system of record
<https://datamodels.jp/ns/task/externalId>';
COMMENT ON COLUMN task.date_created IS '元のシステムでの作成日時（ブローカーの createdAt とは別）
Creation time in the system of record (distinct from the broker attribute createdAt)
<https://smart-data-models.github.io/data-models/terms.jsonld#/definitions/dateCreated>';
COMMENT ON COLUMN task.date_modified IS '元のシステムでの更新日時
Last modification time in the system of record
<https://smart-data-models.github.io/data-models/terms.jsonld#/definitions/dateModified>';
