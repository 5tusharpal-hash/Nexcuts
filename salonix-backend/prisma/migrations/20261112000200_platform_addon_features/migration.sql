BEGIN;

CREATE TABLE platform_addon_features (
    addon_id UUID NOT NULL REFERENCES platform_addons(id) ON DELETE CASCADE,
    feature_key VARCHAR(100) NOT NULL,
    feature_value JSONB NOT NULL DEFAULT 'true'::jsonb,
    PRIMARY KEY (addon_id, feature_key)
);

COMMIT;
