import { sha256Hex } from '@/lib/crypto';
import { METRIC_NAMES, METRIC_RANGES, type IngestSamplesBody, type MetricName } from '@/validators/ingest.schema';

/**
 * Air quality ingestion and reading (ADR 0002, docs/AIR-QUALITY-COLLECTOR.md).
 * Raw D1 statements: the write path is one batch of `INSERT … ON CONFLICT DO
 * NOTHING`, which Drizzle's D1 batch would only wrap.
 */

/** A sample older than this is rejected: stale outbox or wrong host clock. */
export const MAX_SAMPLE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A sample further in the future than this is rejected: wrong host clock. */
export const MAX_SAMPLE_SKEW_MS = 5 * 60 * 1000;
/** The latest reading counts as stale after this. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

const COLUMN: Record<MetricName, string> = {
  co2_ppm: 'co2_ppm',
  pm1_ugm3: 'pm1_ugm3',
  pm25_ugm3: 'pm25_ugm3',
  pm10_ugm3: 'pm10_ugm3',
  tvoc_mgm3: 'tvoc_mgm3',
  hcho_mgm3: 'hcho_mgm3',
  temperature_c: 'temperature_c',
  humidity_pct: 'humidity_pct',
  battery_pct: 'battery_pct',
};

export interface Collector {
  id: string;
  name: string;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected_samples: number;
  rejected_fields: number;
  unknown_devices: string[];
}

export interface AirQualityReading {
  measuredAt: string;
  co2Ppm: number | null;
  pm1Ugm3: number | null;
  pm25Ugm3: number | null;
  pm10Ugm3: number | null;
  tvocMgm3: number | null;
  hchoMgm3: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  batteryPct: number | null;
}

export interface SpaceAirQuality {
  device: { id: string; label: string | null; model: string; status: string | null; statusAt: string | null } | null;
  latest: AirQualityReading | null;
  stale: boolean;
}

/** Resolves a bearer token to its active collector, or null. */
export async function findCollectorByToken(db: D1Database, token: string): Promise<Collector | null> {
  const hash = await sha256Hex(token);
  const row = await db
    .prepare('SELECT id, name FROM sensor_collectors WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(hash)
    .first<Collector>();
  return row ?? null;
}

/** "2026-11-03T17:13:42.120Z" → "2026-11-03T17:13:00.000Z". */
export function truncateToMinute(iso: string): string {
  const d = new Date(iso);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

export async function ingestSamples(
  db: D1Database,
  collector: Collector,
  body: IngestSamplesBody,
  now = new Date()
): Promise<IngestResult> {
  const nowIso = now.toISOString();
  const refs = [...new Set([...body.samples.map((s) => s.device), ...body.device_status.map((s) => s.device)])];

  // Only devices of this collector: a leaked token cannot write another collector's devices.
  const deviceIdByRef = new Map<string, string>();
  if (refs.length > 0) {
    const placeholders = refs.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT id, external_id FROM sensor_devices
         WHERE collector_id = ? AND retired_at IS NULL AND external_id IN (${placeholders})`
      )
      .bind(collector.id, ...refs)
      .all<{ id: string; external_id: string }>();
    for (const row of results) deviceIdByRef.set(row.external_id, row.id);
  }

  const unknown = new Set<string>();
  let rejectedSamples = 0;
  let rejectedFields = 0;
  const inserts: D1PreparedStatement[] = [];
  const columns = METRIC_NAMES.map((m) => COLUMN[m]);
  const insertSql = `INSERT INTO sensor_readings (device_id, measured_at, received_at, ${columns.join(', ')})
    VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})
    ON CONFLICT (device_id, measured_at) DO NOTHING`;

  for (const sample of body.samples) {
    const deviceId = deviceIdByRef.get(sample.device);
    if (!deviceId) {
      unknown.add(sample.device);
      continue;
    }
    const measuredAt = truncateToMinute(sample.measured_at);
    const offset = new Date(measuredAt).getTime() - now.getTime();
    if (offset > MAX_SAMPLE_SKEW_MS || -offset > MAX_SAMPLE_AGE_MS) {
      rejectedSamples++;
      continue;
    }
    const values = METRIC_NAMES.map((metric) => {
      const value = sample.values[metric];
      if (value === undefined || value === null) return null;
      const [min, max] = METRIC_RANGES[metric];
      if (value < min || value > max) {
        rejectedFields++;
        return null;
      }
      return metric === 'battery_pct' ? Math.round(value) : value;
    });
    inserts.push(db.prepare(insertSql).bind(deviceId, measuredAt, nowIso, ...values));
  }

  const statusUpdates = body.device_status.flatMap((status) => {
    const deviceId = deviceIdByRef.get(status.device);
    if (!deviceId) {
      unknown.add(status.device);
      return [];
    }
    return [
      db
        .prepare(
          `UPDATE sensor_devices SET last_status = ?, last_status_at = ?, last_error = ?, updated_at = ? WHERE id = ?`
        )
        .bind(status.state, nowIso, status.error ?? null, nowIso, deviceId),
    ];
  });

  const touchCollector = db
    .prepare('UPDATE sensor_collectors SET last_seen_at = ?, last_version = ?, updated_at = ? WHERE id = ?')
    .bind(nowIso, body.collector.version, nowIso, collector.id);

  const results = await db.batch([...inserts, ...statusUpdates, touchCollector]);
  const accepted = results.slice(0, inserts.length).reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);

  return {
    accepted,
    duplicates: inserts.length - accepted,
    rejected_samples: rejectedSamples,
    rejected_fields: rejectedFields,
    unknown_devices: [...unknown],
  };
}

interface ReadingRow {
  measured_at: string;
  co2_ppm: number | null;
  pm1_ugm3: number | null;
  pm25_ugm3: number | null;
  pm10_ugm3: number | null;
  tvoc_mgm3: number | null;
  hcho_mgm3: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  battery_pct: number | null;
}

function toReading(row: ReadingRow): AirQualityReading {
  return {
    measuredAt: row.measured_at,
    co2Ppm: row.co2_ppm,
    pm1Ugm3: row.pm1_ugm3,
    pm25Ugm3: row.pm25_ugm3,
    pm10Ugm3: row.pm10_ugm3,
    tvocMgm3: row.tvoc_mgm3,
    hchoMgm3: row.hcho_mgm3,
    temperatureC: row.temperature_c,
    humidityPct: row.humidity_pct,
    batteryPct: row.battery_pct,
  };
}

export type HistoryBucket = 'minute' | 'hour';

/** Longest span per bucket, mirroring the 90-day cap of the space report. */
export const HISTORY_MAX_SPAN_MS: Record<HistoryBucket, number> = {
  minute: 2 * 24 * 60 * 60 * 1000,
  hour: 90 * 24 * 60 * 60 * 1000,
};

export interface AirQualityHistoryPoint extends AirQualityReading {
  /** Peak inside the bucket (equals the value for minute buckets). */
  co2PpmMax: number | null;
  pm25Ugm3Max: number | null;
  /** How many stored samples the bucket averages. */
  samples: number;
}

export interface SpaceAirQualityHistory {
  device: SpaceAirQuality['device'];
  bucket: HistoryBucket;
  from: string;
  to: string;
  points: AirQualityHistoryPoint[];
}

/**
 * Readings of the room's active device in [from, to), averaged per bucket.
 * Hour buckets are UTC hours, which line up with campus hours (UTC−3, no DST).
 */
export async function getSpaceAirQualityHistory(
  db: D1Database,
  spaceId: string,
  range: { from: string; to: string; bucket: HistoryBucket }
): Promise<SpaceAirQualityHistory> {
  const current = await getSpaceAirQuality(db, spaceId);
  const base = { device: current.device, bucket: range.bucket, from: range.from, to: range.to, points: [] };
  if (!current.device) return base;

  const key = range.bucket === 'hour' ? `strftime('%Y-%m-%dT%H:00:00.000Z', measured_at)` : 'measured_at';
  const { results } = await db
    .prepare(
      `SELECT ${key} AS measured_at,
              avg(co2_ppm) AS co2_ppm, max(co2_ppm) AS co2_ppm_max,
              avg(pm1_ugm3) AS pm1_ugm3, avg(pm25_ugm3) AS pm25_ugm3, max(pm25_ugm3) AS pm25_ugm3_max,
              avg(pm10_ugm3) AS pm10_ugm3, avg(tvoc_mgm3) AS tvoc_mgm3, avg(hcho_mgm3) AS hcho_mgm3,
              avg(temperature_c) AS temperature_c, avg(humidity_pct) AS humidity_pct,
              CAST(round(avg(battery_pct)) AS INTEGER) AS battery_pct,
              count(*) AS samples
       FROM sensor_readings
       WHERE device_id = ? AND measured_at >= ? AND measured_at < ?
       GROUP BY ${key}
       ORDER BY ${key}`
    )
    .bind(current.device.id, range.from, range.to)
    .all<ReadingRow & { co2_ppm_max: number | null; pm25_ugm3_max: number | null; samples: number }>();

  return {
    ...base,
    points: results.map((row) => ({
      ...toReading(row),
      co2PpmMax: row.co2_ppm_max,
      pm25Ugm3Max: row.pm25_ugm3_max,
      samples: row.samples,
    })),
  };
}

/** The room's active device and its latest reading. A room without a device is not an error. */
export async function getSpaceAirQuality(db: D1Database, spaceId: string, now = new Date()): Promise<SpaceAirQuality> {
  const device = await db
    .prepare(
      `SELECT id, label, model, last_status, last_status_at FROM sensor_devices
       WHERE space_id = ? AND retired_at IS NULL
       ORDER BY created_at LIMIT 1`
    )
    .bind(spaceId)
    .first<{ id: string; label: string | null; model: string; last_status: string | null; last_status_at: string | null }>();

  if (!device) return { device: null, latest: null, stale: true };

  const row = await db
    .prepare(
      `SELECT measured_at, co2_ppm, pm1_ugm3, pm25_ugm3, pm10_ugm3, tvoc_mgm3, hcho_mgm3,
              temperature_c, humidity_pct, battery_pct
       FROM sensor_readings WHERE device_id = ? ORDER BY measured_at DESC LIMIT 1`
    )
    .bind(device.id)
    .first<ReadingRow>();

  const latest = row ? toReading(row) : null;
  const stale = !latest || now.getTime() - new Date(latest.measuredAt).getTime() > STALE_AFTER_MS;

  return {
    device: {
      id: device.id,
      label: device.label,
      model: device.model,
      status: device.last_status,
      statusAt: device.last_status_at,
    },
    latest,
    stale,
  };
}
