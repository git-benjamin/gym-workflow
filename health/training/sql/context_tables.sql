-- life_phases: location and life context periods
CREATE TABLE IF NOT EXISTS life_phases (
    id          SERIAL PRIMARY KEY,
    start_date  DATE    NOT NULL,
    end_date    DATE,
    location    TEXT,
    living_situation TEXT,
    notes       TEXT
);

ALTER TABLE life_phases ENABLE ROW LEVEL SECURITY;

-- medication_logs: time-series of medication doses
-- medication: 'retatrutide' | etc.
CREATE TABLE IF NOT EXISTS medication_logs (
    id          BIGSERIAL PRIMARY KEY,
    date        DATE        NOT NULL,
    medication  TEXT        NOT NULL,
    dose_mg     NUMERIC(7,3),
    units       INTEGER,
    notes       TEXT,
    raw_line    TEXT,
    UNIQUE (date, medication)
);

ALTER TABLE medication_logs ENABLE ROW LEVEL SECURITY;

-- supplement_protocols: static reference docs for compound protocols
-- type: 'vitamins' | 'peptide' | 'stack'
CREATE TABLE IF NOT EXISTS supplement_protocols (
    id              SERIAL PRIMARY KEY,
    effective_date  DATE,
    name            TEXT        NOT NULL,
    type            TEXT,
    content         TEXT,
    notes           TEXT
);

ALTER TABLE supplement_protocols ENABLE ROW LEVEL SECURITY;
