-- Milestone: https://datamodels.jp/ns/task/Milestone
-- task v1.0.0. JSON Schema: https://datamodels.jp/schema/task/Milestone/v1.0.0.json
-- @context: https://datamodels.jp/context/task/v1.jsonld
-- Columns are the attributes in snake_case; <attribute>_<field> columns are the fields of one value (an address).
CREATE TABLE milestone (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  project text,
  start text,
  due text,
  milestone_status text,
  source text,
  external_id text,
  date_created timestamptz,
  date_modified timestamptz,
  CHECK (start ~ E'^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}))?$'),
  CHECK (due ~ E'^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}))?$'),
  CHECK (milestone_status IN ('open', 'locked', 'closed'))
);
COMMENT ON TABLE milestone IS 'マイルストーン。プロジェクトの中でタスクをまとめる、予定の目標です。Redmine のバージョン、GitHub や GitLab のマイルストーン、Jira の修正バージョンなどにあたります。名前、期限、状態を持ちます。
Milestone. A planned target that groups tasks within a project: a version in Redmine, a milestone in GitHub or GitLab, a fix version in Jira. It has a name, a due date and a state.
<https://datamodels.jp/ns/task/Milestone>';
COMMENT ON COLUMN milestone.id IS 'エンティティの ID（URI。例：urn:ngsi-ld:Milestone:001）
Entity id: a URI, for example urn:ngsi-ld:Milestone:001';
COMMENT ON COLUMN milestone.name IS '名称
Name
<https://uri.etsi.org/ngsi-ld/name>';
COMMENT ON COLUMN milestone.description IS '説明
Description
<http://purl.org/dc/terms/description>';
COMMENT ON COLUMN milestone.project IS '所属するプロジェクト
The project this belongs to
<https://datamodels.jp/ns/task/project>';
COMMENT ON COLUMN milestone.start IS '予定期間の開始。日付か日時
Planned start: a date, or a date and time
<https://datamodels.jp/ns/task/start>';
COMMENT ON COLUMN milestone.due IS '期限（予定しているリリースや完了）。日付か日時
Due: the planned release or completion, a date or a date and time
<https://datamodels.jp/ns/task/due>';
COMMENT ON COLUMN milestone.milestone_status IS '状態：open（受付中）、locked（ロック中。新しいタスクを追加できない）、closed（完了）。status は core context の予約語なので、milestoneStatus という名前にしています。
State: open = accepting tasks, locked = no new tasks may be added, closed = done; status is protected in the core context, hence milestoneStatus
<https://datamodels.jp/ns/task/milestoneStatus>';
COMMENT ON COLUMN milestone.source IS '元のシステムでのこのマイルストーンの URL
URL of this object in the system of record
<https://smart-data-models.github.io/data-models/terms.jsonld#/definitions/source>';
COMMENT ON COLUMN milestone.external_id IS '元のシステムでの識別子
Identifier in the system of record
<https://datamodels.jp/ns/task/externalId>';
COMMENT ON COLUMN milestone.date_created IS '元のシステムでの作成日時（ブローカーの createdAt とは別）
Creation time in the system of record (distinct from the broker attribute createdAt)
<https://smart-data-models.github.io/data-models/terms.jsonld#/definitions/dateCreated>';
COMMENT ON COLUMN milestone.date_modified IS '元のシステムでの更新日時
Last modification time in the system of record
<https://smart-data-models.github.io/data-models/terms.jsonld#/definitions/dateModified>';
