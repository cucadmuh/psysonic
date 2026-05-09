use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::Manager;

pub(super) const WAVEFORM_ALGO_VERSION: i64 = 4;
pub(super) const LOUDNESS_ALGO_VERSION: i64 = 1;

/// Bins in waveform BLOB: `2 * bin_count` bytes (peak u8, then mean-abs u8 per time bin).
fn waveform_cache_blob_len_ok(bins: &[u8], bin_count: i64) -> bool {
    if bin_count <= 0 {
        return false;
    }
    let n = bin_count as usize;
    bins.len() == n.saturating_mul(2)
}

#[derive(Debug, Clone)]
pub struct TrackKey {
    pub track_id: String,
    pub md5_16kb: String,
}

#[derive(Debug, Clone)]
pub struct WaveformEntry {
    pub bins: Vec<u8>,
    pub bin_count: i64,
    pub is_partial: bool,
    pub known_until_sec: f64,
    pub duration_sec: f64,
    pub updated_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct LoudnessEntry {
    pub integrated_lufs: f64,
    pub true_peak: f64,
    pub recommended_gain_db: f64,
    pub target_lufs: f64,
    pub updated_at: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct LoudnessSnapshot {
    pub integrated_lufs: f64,
    pub true_peak: f64,
    pub recommended_gain_db: f64,
    pub target_lufs: f64,
    pub updated_at: i64,
}

pub struct AnalysisCache {
    conn: Mutex<Connection>,
}

/// Ranged HTTP seeding uses `stream:<subsonicId>` (see `playback_identity`); backfill
/// and IPC often use the bare `<subsonicId>`. Rows may exist under either key.
fn track_id_cache_variants(id: &str) -> Vec<String> {
    let mut out = vec![id.to_string()];
    if let Some(bare) = id.strip_prefix("stream:") {
        if !bare.is_empty() {
            out.push(bare.to_string());
        }
    } else {
        out.push(format!("stream:{id}"));
    }
    out
}

pub(super) fn now_unix_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl AnalysisCache {
    pub fn init(app: &tauri::AppHandle) -> Result<Self, String> {
        let db_path = analysis_db_path(app)?;
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;
        migrate_schema(&conn).map_err(|e| e.to_string())?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Remove all `loudness_cache` rows for this logical track (bare id and `stream:` variant).
    pub fn delete_loudness_for_track_id(&self, track_id: &str) -> Result<u64, String> {
        if track_id.trim().is_empty() {
            return Ok(0);
        }
        let conn = self
            .conn
            .lock()
            .map_err(|_| "analysis_cache lock poisoned".to_string())?;
        let mut total: u64 = 0;
        for tid in track_id_cache_variants(track_id) {
            let n = conn
                .execute("DELETE FROM loudness_cache WHERE track_id = ?1", params![tid])
                .map_err(|e| e.to_string())?;
            total = total.saturating_add(n as u64);
        }
        Ok(total)
    }

    /// Remove all `waveform_cache` rows for this logical track (bare id and `stream:` variant).
    pub fn delete_waveform_for_track_id(&self, track_id: &str) -> Result<u64, String> {
        if track_id.trim().is_empty() {
            return Ok(0);
        }
        let conn = self
            .conn
            .lock()
            .map_err(|_| "analysis_cache lock poisoned".to_string())?;
        let mut total: u64 = 0;
        for tid in track_id_cache_variants(track_id) {
            let n = conn
                .execute("DELETE FROM waveform_cache WHERE track_id = ?1", params![tid])
                .map_err(|e| e.to_string())?;
            total = total.saturating_add(n as u64);
        }
        Ok(total)
    }

    /// Remove all cached waveform rows across all tracks/variants.
    pub fn delete_all_waveforms(&self) -> Result<u64, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "analysis_cache lock poisoned".to_string())?;
        let n = conn
            .execute("DELETE FROM waveform_cache", [])
            .map_err(|e| e.to_string())?;
        Ok(n as u64)
    }

    pub fn touch_track_status(&self, key: &TrackKey, status: &str) -> Result<(), String> {
        let now = now_unix_ts();
        let conn = self.conn.lock().map_err(|_| "analysis_cache lock poisoned".to_string())?;
        conn.execute(
            r#"
            INSERT INTO analysis_track (
                track_id, md5_16kb, status, waveform_algo_version, loudness_algo_version, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(track_id, md5_16kb) DO UPDATE SET
                status = excluded.status,
                waveform_algo_version = excluded.waveform_algo_version,
                loudness_algo_version = excluded.loudness_algo_version,
                updated_at = excluded.updated_at
            "#,
            params![
                key.track_id,
                key.md5_16kb,
                status,
                WAVEFORM_ALGO_VERSION,
                LOUDNESS_ALGO_VERSION,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn upsert_waveform(&self, key: &TrackKey, entry: &WaveformEntry) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "analysis_cache lock poisoned".to_string())?;
        conn.execute(
            r#"
            INSERT INTO waveform_cache (
                track_id, md5_16kb, bins, bin_count, is_partial, known_until_sec, duration_sec, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(track_id, md5_16kb) DO UPDATE SET
                bins = excluded.bins,
                bin_count = excluded.bin_count,
                is_partial = excluded.is_partial,
                known_until_sec = excluded.known_until_sec,
                duration_sec = excluded.duration_sec,
                updated_at = excluded.updated_at
            "#,
            params![
                key.track_id,
                key.md5_16kb,
                entry.bins,
                entry.bin_count,
                if entry.is_partial { 1 } else { 0 },
                entry.known_until_sec,
                entry.duration_sec,
                entry.updated_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn upsert_loudness(&self, key: &TrackKey, entry: &LoudnessEntry) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "analysis_cache lock poisoned".to_string())?;
        conn.execute(
            r#"
            INSERT INTO loudness_cache (
                track_id, md5_16kb, integrated_lufs, true_peak, recommended_gain_db, target_lufs, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(track_id, md5_16kb, target_lufs) DO UPDATE SET
                integrated_lufs = excluded.integrated_lufs,
                true_peak = excluded.true_peak,
                recommended_gain_db = excluded.recommended_gain_db,
                updated_at = excluded.updated_at
            "#,
            params![
                key.track_id,
                key.md5_16kb,
                entry.integrated_lufs,
                entry.true_peak,
                entry.recommended_gain_db,
                entry.target_lufs,
                entry.updated_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_waveform(&self, key: &TrackKey) -> Result<Option<WaveformEntry>, String> {
        let conn = self.conn.lock().map_err(|_| "analysis_cache lock poisoned".to_string())?;
        let row = conn
            .query_row(
                r#"
            SELECT w.bins, w.bin_count, w.is_partial, w.known_until_sec, w.duration_sec, w.updated_at
            FROM waveform_cache w
            JOIN analysis_track a
              ON a.track_id = w.track_id
             AND a.md5_16kb = w.md5_16kb
            WHERE w.track_id = ?1
              AND w.md5_16kb = ?2
              AND a.waveform_algo_version = ?3
            "#,
                params![key.track_id, key.md5_16kb, WAVEFORM_ALGO_VERSION],
                |row| {
                    Ok(WaveformEntry {
                        bins: row.get(0)?,
                        bin_count: row.get(1)?,
                        is_partial: row.get::<_, i64>(2)? != 0,
                        known_until_sec: row.get(3)?,
                        duration_sec: row.get(4)?,
                        updated_at: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row.filter(|e| waveform_cache_blob_len_ok(&e.bins, e.bin_count)))
    }

    /// True when this exact `(track_id, md5_16kb)` has a loudness row for the current algo version.
    /// Used after `delete_loudness_for_track_id`: waveform may still be cached, but EBU data was removed.
    pub fn loudness_row_exists_for_key(&self, key: &TrackKey) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|_| "analysis_cache lock poisoned".to_string())?;
        let exists: i64 = conn
            .query_row(
                r#"
            SELECT EXISTS (
              SELECT 1
              FROM loudness_cache l
              JOIN analysis_track a
                ON a.track_id = l.track_id
               AND a.md5_16kb = l.md5_16kb
              WHERE l.track_id = ?1
                AND l.md5_16kb = ?2
                AND a.loudness_algo_version = ?3
            )
            "#,
                params![key.track_id, key.md5_16kb, LOUDNESS_ALGO_VERSION],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(exists != 0)
    }

    pub fn get_latest_waveform_for_track(&self, track_id: &str) -> Result<Option<WaveformEntry>, String> {
        let conn = self.conn.lock().map_err(|_| "analysis_cache lock poisoned".to_string())?;
        const SQL: &str = r#"
            SELECT w.bins, w.bin_count, w.is_partial, w.known_until_sec, w.duration_sec, w.updated_at
            FROM waveform_cache w
            JOIN analysis_track a
              ON a.track_id = w.track_id
             AND a.md5_16kb = w.md5_16kb
            WHERE w.track_id = ?1
              AND a.waveform_algo_version = ?2
            ORDER BY w.updated_at DESC
            LIMIT 1
            "#;
        for tid in track_id_cache_variants(track_id) {
            let row = conn
                .query_row(
                    SQL,
                    params![tid, WAVEFORM_ALGO_VERSION],
                    |row| {
                        Ok(WaveformEntry {
                            bins: row.get(0)?,
                            bin_count: row.get(1)?,
                            is_partial: row.get::<_, i64>(2)? != 0,
                            known_until_sec: row.get(3)?,
                            duration_sec: row.get(4)?,
                            updated_at: row.get(5)?,
                        })
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(e) = row {
                if waveform_cache_blob_len_ok(&e.bins, e.bin_count) {
                    return Ok(Some(e));
                }
            }
        }
        Ok(None)
    }

    /// Both waveform and loudness rows exist — a CPU seed from bytes/file would only
    /// decode the file to immediately skip with `SkippedWaveformCacheHit`.
    pub fn cpu_seed_redundant_for_track(&self, track_id: &str) -> Result<bool, String> {
        Ok(
            self.get_latest_waveform_for_track(track_id)?.is_some()
                && self.get_latest_loudness_for_track(track_id)?.is_some(),
        )
    }

    pub fn get_latest_loudness_for_track(&self, track_id: &str) -> Result<Option<LoudnessSnapshot>, String> {
        let conn = self.conn.lock().map_err(|_| "analysis_cache lock poisoned".to_string())?;
        const SQL: &str = r#"
            SELECT l.integrated_lufs, l.true_peak, l.recommended_gain_db, l.target_lufs, l.updated_at
            FROM loudness_cache l
            JOIN analysis_track a
              ON a.track_id = l.track_id
             AND a.md5_16kb = l.md5_16kb
            WHERE l.track_id = ?1
              AND a.loudness_algo_version = ?2
            ORDER BY l.updated_at DESC
            LIMIT 1
            "#;
        for tid in track_id_cache_variants(track_id) {
            let row = conn
                .query_row(
                    SQL,
                    params![tid, LOUDNESS_ALGO_VERSION],
                    |row| {
                        Ok(LoudnessSnapshot {
                            integrated_lufs: row.get(0)?,
                            true_peak: row.get(1)?,
                            recommended_gain_db: row.get(2)?,
                            target_lufs: row.get(3)?,
                            updated_at: row.get(4)?,
                        })
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if row.is_some() {
                return Ok(row);
            }
        }
        Ok(None)
    }
}

fn analysis_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    Ok(base.join("audio-analysis.sqlite"))
}

fn configure_connection(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

fn migrate_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS analysis_track (
            track_id TEXT NOT NULL,
            md5_16kb TEXT NOT NULL,
            status TEXT NOT NULL,
            waveform_algo_version INTEGER NOT NULL,
            loudness_algo_version INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (track_id, md5_16kb)
        );

        CREATE TABLE IF NOT EXISTS waveform_cache (
            track_id TEXT NOT NULL,
            md5_16kb TEXT NOT NULL,
            bins BLOB NOT NULL,
            bin_count INTEGER NOT NULL,
            is_partial INTEGER NOT NULL,
            known_until_sec REAL NOT NULL,
            duration_sec REAL NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (track_id, md5_16kb)
        );

        CREATE TABLE IF NOT EXISTS loudness_cache (
            track_id TEXT NOT NULL,
            md5_16kb TEXT NOT NULL,
            integrated_lufs REAL NOT NULL,
            true_peak REAL NOT NULL,
            recommended_gain_db REAL NOT NULL,
            target_lufs REAL NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (track_id, md5_16kb, target_lufs)
        );

        CREATE INDEX IF NOT EXISTS idx_analysis_track_status
            ON analysis_track(status);
        "#,
    )?;
    Ok(())
}
