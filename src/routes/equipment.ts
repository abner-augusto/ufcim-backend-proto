import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { EquipmentService } from '@/services/equipment.service';
import { EquipmentReportService } from '@/services/equipment-report.service';
import { validate } from '@/middleware/validation';
import { rbac, extractRole } from '@/middleware/rbac';
import { createEquipmentSchema, updateEquipmentStatusSchema } from '@/validators/equipment.schema';
import { createEquipmentReportSchema, dismissReportSchema } from '@/validators/equipment-report.schema';
import type { z } from 'zod';

export const equipmentRoutes = new Hono<AppEnv>();

// POST /equipment — create equipment (staff, maintenance)
equipmentRoutes.post(
  '/',
  rbac(['staff', 'maintenance']),
  validate(createEquipmentSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new EquipmentService(db);
    const body = c.get('validatedBody') as z.infer<typeof createEquipmentSchema>;

    const item = await service.create(c.get('user').sub, body);
    return c.json(item, 201);
  }
);

// ─── Equipment Report routes (must be before generic /:id routes) ─────────

// GET /equipment/reports/pending — staff/maintenance
equipmentRoutes.get('/reports/pending', rbac(['staff', 'maintenance']), async (c) => {
  const db = createDb(c.env.DB);
  const service = new EquipmentReportService(db);
  const user = c.get('user');

  const status = c.req.query('status') ?? 'pending';
  const spaceId = c.req.query('spaceId');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  const reports = await service.listPending({ status, spaceId, page, limit });
  return c.json(reports);
});

// GET /equipment/reports/mine — current user
equipmentRoutes.get('/reports/mine', async (c) => {
  const db = createDb(c.env.DB);
  const service = new EquipmentReportService(db);
  const user = c.get('user');

  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = parseInt(c.req.query('limit') ?? '20', 10);

  const reports = await service.listByUser(user.sub, page, limit);
  return c.json(reports);
});

// PATCH /equipment/reports/:id/acknowledge — staff/maintenance
equipmentRoutes.patch('/reports/:id/acknowledge', rbac(['staff', 'maintenance']), async (c) => {
  const db = createDb(c.env.DB);
  const service = new EquipmentReportService(db);
  const report = await service.acknowledge(c.req.param('id'), c.get('user').sub);
  return c.json(report);
});

// PATCH /equipment/reports/:id/resolve — staff/maintenance
equipmentRoutes.patch('/reports/:id/resolve', rbac(['staff', 'maintenance']), async (c) => {
  const db = createDb(c.env.DB);
  const service = new EquipmentReportService(db);
  const report = await service.resolve(c.req.param('id'), c.get('user').sub);
  return c.json(report);
});

// PATCH /equipment/reports/:id/dismiss — staff/maintenance
equipmentRoutes.patch(
  '/reports/:id/dismiss',
  rbac(['staff', 'maintenance']),
  validate(dismissReportSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new EquipmentReportService(db);
    const body = c.get('validatedBody') as z.infer<typeof dismissReportSchema>;
    const report = await service.dismiss(c.req.param('id'), c.get('user').sub, body.reason);
    return c.json(report);
  }
);

// ─── Per-equipment report routes ──────────────────────────────────────────

// POST /equipment/:id/reports — any authenticated user
equipmentRoutes.post(
  '/:id/reports',
  validate(createEquipmentReportSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new EquipmentReportService(db);
    const user = c.get('user');
    const body = c.get('validatedBody') as z.infer<typeof createEquipmentReportSchema>;
    const report = await service.create(user.sub, extractRole(user) ?? 'student', {
      equipmentId: c.req.param('id'),
      ...body,
    });
    return c.json(report, 201);
  }
);

// GET /equipment/:id/reports — any authenticated user
equipmentRoutes.get('/:id/reports', async (c) => {
  const db = createDb(c.env.DB);
  const service = new EquipmentReportService(db);
  const reports = await service.listByEquipment(c.req.param('id'));
  return c.json(reports);
});

// ─── Existing routes ─────────────────────────────────────────────────────

// PATCH /equipment/:id/status — update status (staff, maintenance)
equipmentRoutes.patch(
  '/:id/status',
  rbac(['staff', 'maintenance']),
  validate(updateEquipmentStatusSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new EquipmentService(db);
    const body = c.get('validatedBody') as z.infer<typeof updateEquipmentStatusSchema>;

    const item = await service.updateStatus(c.req.param('id'), c.get('user').sub, body);
    return c.json(item);
  }
);

// GET /equipment/space/:spaceId — list equipment for a space (any role)
equipmentRoutes.get('/space/:spaceId', async (c) => {
  const db = createDb(c.env.DB);
  const service = new EquipmentService(db);
  const data = await service.listBySpace(c.req.param('spaceId'));
  return c.json(data);
});
