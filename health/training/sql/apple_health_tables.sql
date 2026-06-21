-- daily_health: one row per (date, source) with aggregated metrics
-- source: 'apple_watch' | 'garmin'
CREATE TABLE IF NOT EXISTS daily_health (
    date                 DATE        NOT NULL,
    source               TEXT        NOT NULL,  -- 'apple_watch' | 'garmin'
    avg_hr               NUMERIC(5,1),
    min_hr               SMALLINT,
    max_hr               SMALLINT,
    resting_hr           NUMERIC(5,1),
    walking_hr_avg       NUMERIC(5,1),
    hrv_sdnn             NUMERIC(6,2),           -- ms
    respiratory_rate     NUMERIC(5,2),           -- breaths/min
    vo2max               NUMERIC(5,2),           -- mL/kg/min
    steps                INTEGER,
    active_energy_kcal   NUMERIC(8,1),
    PRIMARY KEY (date, source)
);

ALTER TABLE daily_health ENABLE ROW LEVEL SECURITY;

-- sleep_logs: one row per sleep stage interval
-- stage: 'core' | 'deep' | 'rem' | 'awake' | 'in_bed' | 'asleep'
-- night_date: calendar date of the night (afternoon/evening start maps to that day, post-midnight maps to previous day)
CREATE TABLE IF NOT EXISTS sleep_logs (
    source              TEXT        NOT NULL,  -- 'apple_watch' | 'garmin'
    start_time          TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ NOT NULL,
    stage               TEXT        NOT NULL,
    night_date          DATE        NOT NULL,
    duration_minutes    NUMERIC(7,1),
    PRIMARY KEY (source, start_time)
);

ALTER TABLE sleep_logs ENABLE ROW LEVEL SECURITY;

-- Convenience view: nightly sleep summary per source
CREATE OR REPLACE VIEW sleep_summary AS
SELECT
    night_date,
    source,
    SUM(duration_minutes) FILTER (WHERE stage IN ('core','deep','rem','asleep'))  AS total_sleep_min,
    SUM(duration_minutes) FILTER (WHERE stage = 'deep')                           AS deep_min,
    SUM(duration_minutes) FILTER (WHERE stage = 'rem')                            AS rem_min,
    SUM(duration_minutes) FILTER (WHERE stage = 'core')                           AS core_min,
    SUM(duration_minutes) FILTER (WHERE stage = 'awake')                          AS awake_min,
    MIN(start_time)                                                                AS bedtime,
    MAX(end_time)                                                                  AS wake_time,
    COUNT(*)                                                                       AS interval_count
FROM sleep_logs
GROUP BY night_date, source
ORDER BY night_date DESC, source;
