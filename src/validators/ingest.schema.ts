import { z } from 'zod';

/**
 * Contract of POST /ingest/v1/samples (docs/AIR-QUALITY-COLLECTOR.md).
 * Metric names and units are canonical; nothing vendor-specific crosses it.
 */

/** Accepted range per metric. A value outside it is stored as NULL, not rejected. */
export const METRIC_RANGES = {
  co2_ppm: [0, 10_000],
  pm1_ugm3: [0, 1_000],
  pm25_ugm3: [0, 1_000],
  pm10_ugm3: [0, 1_000],
  tvoc_mgm3: [0, 10],
  hcho_mgm3: [0, 2],
  temperature_c: [-20, 60],
  humidity_pct: [0, 100],
  battery_pct: [0, 100],
} as const satisfies Record<string, readonly [number, number]>;

export type MetricName = keyof typeof METRIC_RANGES;
export const METRIC_NAMES = Object.keys(METRIC_RANGES) as MetricName[];

export const MAX_SAMPLES_PER_REQUEST = 500;

const deviceRef = z.string().min(1).max(128);

const sampleSchema = z.object({
  device: deviceRef,
  measured_at: z.iso.datetime({ offset: true }),
  values: z.partialRecord(z.enum(METRIC_NAMES as [MetricName, ...MetricName[]]), z.number().finite().nullable()),
});

export const deviceStateSchema = z.enum(['ok', 'unreachable', 'auth_failed', 'bad_payload']);

const deviceStatusSchema = z.object({
  device: deviceRef,
  state: deviceStateSchema,
  last_ok_at: z.iso.datetime({ offset: true }).nullable().optional(),
  error: z.string().max(500).nullable().optional(),
});

export const ingestSamplesSchema = z.object({
  collector: z.object({
    version: z.string().min(1).max(32),
    started_at: z.iso.datetime({ offset: true }).optional(),
  }),
  samples: z.array(sampleSchema).max(MAX_SAMPLES_PER_REQUEST).default([]),
  device_status: z.array(deviceStatusSchema).max(100).default([]),
});

export type IngestSamplesBody = z.infer<typeof ingestSamplesSchema>;
