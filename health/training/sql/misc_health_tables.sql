-- cpap_daily: one row per night from OSCAR CPAP export
CREATE TABLE IF NOT EXISTS cpap_daily (
    date                DATE    PRIMARY KEY,
    session_count       SMALLINT,
    start_time          TIMESTAMPTZ,
    end_time            TIMESTAMPTZ,
    total_hours         NUMERIC(5,2),
    ahi                 NUMERIC(6,3),           -- apnea-hypopnea index (events/hr)
    oa_count            SMALLINT,               -- obstructive apnea
    ca_count            SMALLINT,               -- central apnea
    h_count             SMALLINT,               -- hypopnea
    ua_count            SMALLINT,               -- unclassified apnea
    fl_count            SMALLINT,               -- flow limitation
    median_pressure     NUMERIC(5,2),           -- cmH2O
    pressure_95         NUMERIC(5,2),
    pressure_995        NUMERIC(5,2)
);

ALTER TABLE cpap_daily ENABLE ROW LEVEL SECURITY;

-- substance_logs: one row per use event
-- substance: 'cannabis' | 'mdma' | 'ketamine' | 'cocaine' | 'psilocybin' | 'lsd' | 'amphetamine' | 'nitrous' | 'other'
CREATE TABLE IF NOT EXISTS substance_logs (
    id                  BIGSERIAL PRIMARY KEY,
    date                DATE,
    timestamp           TIMESTAMPTZ,
    substance           TEXT        NOT NULL,
    amount_raw          TEXT,                   -- original text e.g. "2 cones", "0.13g"
    notes               TEXT,
    raw_line            TEXT        NOT NULL    -- original source line for audit
);

ALTER TABLE substance_logs ENABLE ROW LEVEL SECURITY;

-- cycling_logs: one row per ride from Strava export
CREATE TABLE IF NOT EXISTS cycling_logs (
    id                  BIGSERIAL PRIMARY KEY,
    date                DATE        NOT NULL,
    name                TEXT,
    duration_seconds    INTEGER,
    distance_km         NUMERIC(7,2),
    elevation_m         INTEGER,
    UNIQUE (date, name, duration_seconds)
);

ALTER TABLE cycling_logs ENABLE ROW LEVEL SECURITY;
