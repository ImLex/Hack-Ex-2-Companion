// Never edit an existing migration — phones already ran it. Add a new one and bump LATEST_VERSION.

export const LATEST_VERSION = 4;

/**
 * V1. Unique addresses are what let the parser resolve log lines back to targets;
 * extracted-crypto totals are deliberately not columns — they derive from crypto_history.
 */
const V1 = `
-- Rarely changes; volatile fields live in target_info.
CREATE TABLE targets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  device        TEXT,
  date_added    INTEGER NOT NULL,
  attack_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_targets_name ON targets(name);

CREATE TABLE target_info (
  target_id       INTEGER PRIMARY KEY REFERENCES targets(id) ON DELETE CASCADE,
  level           INTEGER NOT NULL DEFAULT 0,
  crypto          REAL    NOT NULL DEFAULT 0,
  activity        TEXT    NOT NULL DEFAULT 'REVIEW',
  potential_score REAL    NOT NULL DEFAULT 0,
  notes           TEXT    NOT NULL DEFAULT '',
  last_updated    INTEGER NOT NULL
);
CREATE INDEX idx_target_info_score    ON target_info(potential_score DESC);
CREATE INDEX idx_target_info_level    ON target_info(level DESC);
CREATE INDEX idx_target_info_activity ON target_info(activity);

CREATE TABLE tags (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL UNIQUE,
  category  TEXT    NOT NULL DEFAULT 'CUSTOM',
  color     TEXT,
  is_system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE target_tags (
  target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (target_id, tag_id)
);
CREATE INDEX idx_target_tags_tag ON target_tags(tag_id);

-- Raw log lines. Must be created before the tables that reference them.
CREATE TABLE logs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id                INTEGER REFERENCES targets(id) ON DELETE CASCADE,
  raw_log                  TEXT    NOT NULL,
  timestamp                INTEGER NOT NULL,
  raw_timestamp            TEXT,
  event_type               TEXT    NOT NULL DEFAULT 'UNKNOWN',
  crypto_extracted         REAL    NOT NULL DEFAULT 0,
  extracted_ip_count       INTEGER NOT NULL DEFAULT 0,
  extracted_wallet_count   INTEGER NOT NULL DEFAULT 0,
  extracted_ips            TEXT    NOT NULL DEFAULT '',
  extracted_wallets        TEXT    NOT NULL DEFAULT '',
  extracted_software       TEXT,
  extracted_software_level INTEGER,
  parser_confidence        REAL    NOT NULL DEFAULT 0,
  imported_at              INTEGER NOT NULL,
  hash                     TEXT    NOT NULL UNIQUE
);
CREATE INDEX idx_logs_target    ON logs(target_id);
CREATE INDEX idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX idx_logs_event     ON logs(event_type);

-- address is UNIQUE so the parser can resolve IP -> target.
CREATE TABLE ip_relations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id         INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  address           TEXT    NOT NULL UNIQUE,
  status            TEXT    NOT NULL DEFAULT 'UNKNOWN',
  found_from_log_id INTEGER REFERENCES logs(id) ON DELETE SET NULL,
  source            TEXT    NOT NULL DEFAULT 'MANUAL',
  discovered_at     INTEGER NOT NULL
);
CREATE INDEX idx_ips_target ON ip_relations(target_id);

-- target_id is nullable until the owner is identified.
CREATE TABLE wallets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id         INTEGER REFERENCES targets(id) ON DELETE CASCADE,
  display_address   TEXT    NOT NULL UNIQUE,
  full_address      TEXT,
  cracked           INTEGER NOT NULL DEFAULT 0,
  found_from_log_id INTEGER REFERENCES logs(id) ON DELETE SET NULL,
  discovered_at     INTEGER NOT NULL
);
CREATE INDEX idx_wallets_target ON wallets(target_id);

-- Every crypto extraction event. Totals are derived from this table.
CREATE TABLE crypto_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id     INTEGER REFERENCES targets(id) ON DELETE CASCADE,
  wallet_id     INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
  amount        REAL    NOT NULL,
  date          INTEGER NOT NULL,
  source        TEXT    NOT NULL DEFAULT 'MANUAL',
  source_log_id INTEGER REFERENCES logs(id) ON DELETE SET NULL
);
CREATE INDEX idx_crypto_target ON crypto_history(target_id);
CREATE INDEX idx_crypto_date   ON crypto_history(date DESC);

CREATE TABLE software (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT    NOT NULL UNIQUE,
  category TEXT    NOT NULL DEFAULT 'UTILITY'
);

-- owner distinguishes the target's own defences from what you uploaded.
CREATE TABLE installed_software (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id   INTEGER NOT NULL REFERENCES targets(id)  ON DELETE CASCADE,
  software_id INTEGER NOT NULL REFERENCES software(id) ON DELETE CASCADE,
  level       INTEGER NOT NULL DEFAULT 1,
  owner       TEXT    NOT NULL DEFAULT 'TARGET',
  source      TEXT    NOT NULL DEFAULT 'MANUAL',
  updated_at  INTEGER NOT NULL,
  UNIQUE (target_id, software_id, owner)
);
CREATE INDEX idx_installed_target   ON installed_software(target_id);
CREATE INDEX idx_installed_software ON installed_software(software_id);

-- Anything the parser could not place, awaiting a human decision.
CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id   INTEGER REFERENCES targets(id) ON DELETE CASCADE,
  log_id      INTEGER REFERENCES logs(id)    ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  reason      TEXT    NOT NULL,
  payload     TEXT,
  status      TEXT    NOT NULL DEFAULT 'OPEN',
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX idx_reviews_status ON reviews(status);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * V2: drop non-target software from the catalogue. Rows referenced by installed_software
 * are kept — deleting them would cascade user data. 'IPScanner' covers the alternate
 * spelling ensureSoftware() may have created from a log line.
 */
const V2 = `
DELETE FROM software
 WHERE name IN ('Virus', 'Keygen', 'IP Scanner', 'IPScanner', 'Notes')
   AND id NOT IN (SELECT software_id FROM installed_software);
`;

/**
 * V3: your own virus deployments (spam and siphon), read off the game's
 * SPAM EARNINGS / SIPHON EARNINGS panels. The same device can carry both, so
 * the key is (kind, address). address is the displayed string and may be
 * partially masked ("204.31.xxx.xxx"); fully-masked rows are never stored.
 * Rows missing from a later capture are flipped inactive rather than deleted,
 * keeping what they earned. rate_per_hour is spam-only; percent siphon-only.
 * age_days is fractional — the game shows siphon ages down to the hour.
 */
const V3 = `
CREATE TABLE virus_deployments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL,
  address       TEXT    NOT NULL,
  level         INTEGER,
  rate_per_hour REAL,
  percent       REAL,
  earned        REAL    NOT NULL DEFAULT 0,
  age_days      REAL,
  active        INTEGER NOT NULL DEFAULT 1,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  UNIQUE (kind, address)
);
CREATE INDEX idx_virus_active ON virus_deployments(kind, active, earned DESC);
`;

/**
 * V4: when an enemy screen was last captured. Connecting to a player counts as
 * activity even when nothing was looted, which log timestamps alone can't show.
 */
const V4 = `
ALTER TABLE target_info ADD COLUMN last_seen_at INTEGER;
`;

export interface Migration {
  version: number;
  label: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, label: 'Initial Trakker 3 structure', sql: V1 },
  { version: 2, label: 'Trim the software catalogue', sql: V2 },
  { version: 3, label: 'Own virus deployments', sql: V3 },
  { version: 4, label: 'Target last-seen timestamp', sql: V4 },
];
