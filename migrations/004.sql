-- Adopt the fixed reading format without changing rule identities or delivery history.
UPDATE rules
SET config_json = json_set(
      json_remove(config_json, '$.filters.bookIds', '$.filters.authors', '$.output.fields'),
      '$.schemaVersion', 2,
      '$.output.tags', json((SELECT json_group_array(value) FROM json_each(rules.config_json, '$.output.tags') WHERE value NOT IN ('微信读书', '#微信读书')))
    ),
    revision = revision + 1
WHERE json_extract(config_json, '$.schemaVersion') = 1;
