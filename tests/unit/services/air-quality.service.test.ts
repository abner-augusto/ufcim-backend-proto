import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, Env } from '@/types/env';
import { globalErrorHandler } from '@/middleware/error-handler';
import { sha256Hex } from '@/lib/crypto';
import {
  ingestSamples,
  getSpaceAirQuality,
  getSpaceAirQualityHistory,
  findCollectorByToken,
} from '@/services/air-quality.service';
import { ingestRoutes } from '@/routes/ingest';
import type { IngestSamplesBody } from '@/validators/ingest.schema';
import { createSqliteD1, sqlite } from '../helpers/d1-sqlite';

const NOW = new Date('2026-11-03T17:14:30.000Z');
const T = '2026-01-01T00:00:00.000Z';
const TOKEN = 'collector-token-bancada';
const DEVICE = 'ebdaebfb3e5ed2f01crg1m';

let d1: D1Database;
let raw: ReturnType<typeof createSqliteD1>['raw'];

async function seed() {
  ({ d1, raw } = createSqliteD1());
  const hash = await sha256Hex(TOKEN);
  raw.exec(`
    INSERT INTO departments (id, name, campus, created_at, updated_at) VALUES ('iaud', 'IAUD', 'Benfica', '${T}', '${T}');
    INSERT INTO spaces (id, name, number, type, block, campus, department, capacity, created_at, updated_at)
      VALUES ('sala-09', 'Sala 09', 'B3-09', 'classroom', 'Bloco 3', 'Benfica', 'iaud', 36, '${T}', '${T}'),
             ('sala-10', 'Sala 10', 'B3-10', 'classroom', 'Bloco 3', 'Benfica', 'iaud', 36, '${T}', '${T}');
    INSERT INTO sensor_collectors (id, name, token_hash, created_at, updated_at)
      VALUES ('col-1', 'bancada', '${hash}', '${T}', '${T}'),
             ('col-2', 'outro', 'hash-do-outro', '${T}', '${T}');
    INSERT INTO sensor_devices (id, external_id, vendor, model, label, collector_id, space_id, created_at, updated_at)
      VALUES ('dev-1', '${DEVICE}', 'tuya', 'BREATHE BTL40001', 'Airmonitor 01', 'col-1', 'sala-09', '${T}', '${T}'),
             ('dev-2', 'device-do-outro', 'tuya', 'BREATHE BTL40001', NULL, 'col-2', 'sala-10', '${T}', '${T}');
  `);
}

function body(overrides: Partial<IngestSamplesBody> = {}): IngestSamplesBody {
  return {
    collector: { version: '0.1.0' },
    samples: [
      {
        device: DEVICE,
        measured_at: '2026-11-03T17:13:42.000Z',
        values: { co2_ppm: 482, pm25_ugm3: 5, pm10_ugm3: 6, pm1_ugm3: 4, tvoc_mgm3: 0, hcho_mgm3: 0.001, temperature_c: 30, humidity_pct: 58, battery_pct: 100 },
      },
    ],
    device_status: [],
    ...overrides,
  };
}

const collector = { id: 'col-1', name: 'bancada' };

describe.skipIf(!sqlite)('air quality ingestion', () => {
  beforeEach(seed);

  it('stores a sample truncated to the minute and reads it back for the room', async () => {
    const result = await ingestSamples(d1, collector, body(), NOW);
    expect(result).toEqual({ accepted: 1, duplicates: 0, rejected_samples: 0, rejected_fields: 0, unknown_devices: [] });

    const room = await getSpaceAirQuality(d1, 'sala-09', NOW);
    expect(room.device).toMatchObject({ id: 'dev-1', label: 'Airmonitor 01', model: 'BREATHE BTL40001' });
    expect(room.latest).toMatchObject({ measuredAt: '2026-11-03T17:13:00.000Z', co2Ppm: 482, hchoMgm3: 0.001, batteryPct: 100 });
    expect(room.stale).toBe(false);
  });

  it('absorbs a resent batch as duplicates', async () => {
    await ingestSamples(d1, collector, body(), NOW);
    const again = await ingestSamples(d1, collector, body(), NOW);
    expect(again).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(raw.prepare('SELECT count(*) AS n FROM sensor_readings').get()).toEqual({ n: 1 });
  });

  it('nulls an out-of-range value instead of dropping the sample', async () => {
    const b = body();
    b.samples[0].values.co2_ppm = 50_000;
    const result = await ingestSamples(d1, collector, b, NOW);
    expect(result).toMatchObject({ accepted: 1, rejected_fields: 1 });
    expect((await getSpaceAirQuality(d1, 'sala-09', NOW)).latest?.co2Ppm).toBeNull();
  });

  it('rejects samples from a wrong clock: too far in the future or older than 7 days', async () => {
    const b = body();
    b.samples.push({ ...b.samples[0], measured_at: '2026-11-03T17:30:00.000Z' });
    b.samples.push({ ...b.samples[0], measured_at: '2026-10-20T17:30:00.000Z' });
    const result = await ingestSamples(d1, collector, b, NOW);
    expect(result).toMatchObject({ accepted: 1, rejected_samples: 2 });
  });

  it("refuses another collector's device and unknown devices", async () => {
    const b = body();
    b.samples.push({ ...b.samples[0], device: 'device-do-outro' });
    b.samples.push({ ...b.samples[0], device: 'nao-cadastrado' });
    const result = await ingestSamples(d1, collector, b, NOW);
    expect(result.accepted).toBe(1);
    expect(result.unknown_devices.sort()).toEqual(['device-do-outro', 'nao-cadastrado']);
    expect((await getSpaceAirQuality(d1, 'sala-10', NOW)).latest).toBeNull();
  });

  it('records device status and the collector heartbeat', async () => {
    await ingestSamples(
      d1,
      collector,
      body({ samples: [], device_status: [{ device: DEVICE, state: 'auth_failed', error: 'decrypt failed' }] }),
      NOW
    );
    expect(raw.prepare("SELECT last_status, last_error FROM sensor_devices WHERE id = 'dev-1'").get()).toEqual({
      last_status: 'auth_failed',
      last_error: 'decrypt failed',
    });
    expect(raw.prepare("SELECT last_seen_at, last_version FROM sensor_collectors WHERE id = 'col-1'").get()).toEqual({
      last_seen_at: NOW.toISOString(),
      last_version: '0.1.0',
    });
  });

  it('marks the reading stale after 5 minutes, and a room without device as empty', async () => {
    await ingestSamples(d1, collector, body(), NOW);
    const later = new Date(NOW.getTime() + 6 * 60 * 1000);
    expect((await getSpaceAirQuality(d1, 'sala-09', later)).stale).toBe(true);
    expect(await getSpaceAirQuality(d1, 'sem-sensor', NOW)).toEqual({ device: null, latest: null, stale: true });
  });

  it('averages history per hour, with the CO₂ peak and sample count', async () => {
    const b = body();
    b.samples = [
      { ...b.samples[0], measured_at: '2026-11-03T16:10:00Z', values: { co2_ppm: 500 } },
      { ...b.samples[0], measured_at: '2026-11-03T16:40:00Z', values: { co2_ppm: 700 } },
      { ...b.samples[0], measured_at: '2026-11-03T17:05:00Z', values: { co2_ppm: 450 } },
    ];
    await ingestSamples(d1, collector, b, NOW);
    const history = await getSpaceAirQualityHistory(d1, 'sala-09', {
      from: '2026-11-03T16:00:00.000Z',
      to: '2026-11-03T18:00:00.000Z',
      bucket: 'hour',
    });
    expect(history.points.map((p) => [p.measuredAt, p.co2Ppm, p.co2PpmMax, p.samples])).toEqual([
      ['2026-11-03T16:00:00.000Z', 600, 700, 2],
      ['2026-11-03T17:00:00.000Z', 450, 450, 1],
    ]);
    const empty = await getSpaceAirQualityHistory(d1, 'sem-sensor', { from: T, to: NOW.toISOString(), bucket: 'hour' });
    expect(empty).toMatchObject({ device: null, points: [] });
  });

  it('resolves only active collector tokens', async () => {
    expect(await findCollectorByToken(d1, TOKEN)).toEqual({ id: 'col-1', name: 'bancada' });
    raw.exec(`UPDATE sensor_collectors SET revoked_at = '${T}' WHERE id = 'col-1'`);
    expect(await findCollectorByToken(d1, TOKEN)).toBeNull();
    expect(await findCollectorByToken(d1, 'qualquer')).toBeNull();
  });
});

describe.skipIf(!sqlite)('POST /ingest/v1/samples', () => {
  beforeEach(seed);

  function makeEnv(): Env {
    return { DB: d1, ENVIRONMENT: 'development' } as unknown as Env;
  }
  function makeApp() {
    const app = new Hono<AppEnv>();
    app.onError(globalErrorHandler);
    app.route('/ingest/v1', ingestRoutes);
    return app;
  }
  const post = (headers: Record<string, string>, payload: unknown) =>
    makeApp().request(
      'http://localhost/ingest/v1/samples',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) },
      makeEnv()
    );

  it('returns 401 without a token or with a wrong one', async () => {
    expect((await post({}, body())).status).toBe(401);
    expect((await post({ Authorization: 'Bearer errado' }, body())).status).toBe(401);
  });

  it('returns 400 for a batch over 500 samples', async () => {
    const b = body();
    b.samples = Array.from({ length: 501 }, () => b.samples[0]);
    expect((await post({ Authorization: `Bearer ${TOKEN}` }, b)).status).toBe(400);
  });

  it('accepts a valid batch', async () => {
    const b = body();
    b.samples[0].measured_at = new Date().toISOString();
    const res = await post({ Authorization: `Bearer ${TOKEN}` }, b);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1 });
  });
});
