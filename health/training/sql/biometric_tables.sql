-- profile: singleton demographics row
CREATE TABLE IF NOT EXISTS profile (
    id              SERIAL PRIMARY KEY,
    date_of_birth   DATE,
    height_cm       NUMERIC(5,1),
    notes           TEXT
);

ALTER TABLE profile ENABLE ROW LEVEL SECURITY;

-- height_history: track height at different ages
CREATE TABLE IF NOT EXISTS height_history (
    date        DATE PRIMARY KEY,
    height_cm   NUMERIC(5,1),
    notes       TEXT
);

ALTER TABLE height_history ENABLE ROW LEVEL SECURITY;

-- body_composition: DEXA, InBody, etc.
CREATE TABLE IF NOT EXISTS body_composition (
    date            DATE        NOT NULL,
    weight_kg       NUMERIC(6,2),
    body_fat_pct    NUMERIC(5,2),
    lean_mass_kg    NUMERIC(6,2),
    fat_mass_kg     NUMERIC(6,2),
    method          TEXT,       -- 'DEXA' | 'InBody' | 'estimate'
    notes           TEXT,
    PRIMARY KEY (date, method)
);

ALTER TABLE body_composition ENABLE ROW LEVEL SECURITY;

-- blood_tests: individual lab markers per test date
CREATE TABLE IF NOT EXISTS blood_tests (
    id              BIGSERIAL PRIMARY KEY,
    tested_at       TIMESTAMPTZ NOT NULL,
    marker          TEXT        NOT NULL,
    value           NUMERIC(10,4),
    value_text      TEXT,       -- for non-numeric or percentage values
    unit            TEXT,
    normal_range    TEXT,
    notes           TEXT,
    UNIQUE (tested_at, marker)
);

ALTER TABLE blood_tests ENABLE ROW LEVEL SECURITY;

-- body_measurements: tape measurements
CREATE TABLE IF NOT EXISTS body_measurements (
    id              BIGSERIAL PRIMARY KEY,
    date            DATE        NOT NULL,
    measurement     TEXT        NOT NULL,   -- 'chest' | 'waist' | 'neck' | etc.
    value_cm        NUMERIC(6,1),
    value_text      TEXT,                   -- for ranges like '74-83'
    notes           TEXT,
    UNIQUE (date, measurement, value_cm)
);

ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;

-- Add source column to weight_logs to distinguish MFP vs manual
ALTER TABLE weight_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'mfp';
ALTER TABLE weight_logs ADD COLUMN IF NOT EXISTS notes TEXT;

-- meal_entries: individual food items logged per meal per day
CREATE TABLE IF NOT EXISTS meal_entries (
    id              BIGSERIAL PRIMARY KEY,
    date            DATE        NOT NULL,
    meal            TEXT        NOT NULL,   -- 'breakfast' | 'lunch' | 'dinner' | 'snacks'
    food_name       TEXT        NOT NULL,
    short_name      TEXT,
    quantity        NUMERIC(10,2),
    unit            TEXT,
    calories        INTEGER,
    protein         NUMERIC(8,2),
    carbohydrates   NUMERIC(8,2),
    fat             NUMERIC(8,2),
    sugar           NUMERIC(8,2),
    sodium          NUMERIC(10,2),
    fiber           NUMERIC(8,2),
    UNIQUE (date, meal, food_name, quantity, unit)
);

ALTER TABLE meal_entries ENABLE ROW LEVEL SECURITY;
