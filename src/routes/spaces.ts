import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { SpaceService } from '@/services/space.service';
import { ReportService } from '@/services/report.service';
import { AuditLogService } from '@/services/audit-log.service';
import { validate, validateQuery } from '@/middleware/validation';
import { rbac, extractRole, isMasterAdmin } from '@/middleware/rbac';
import { createSpaceSchema, updateSpaceSchema, spaceQuerySchema } from '@/validators/space.schema';
import type { z } from 'zod';
import type { UserRole } from '@/types/auth';

export const spaceRoutes = new Hono<AppEnv>();

// POST /spaces — create space (staff only)
spaceRoutes.post(
  '/',
  rbac(['staff']),
  validate(createSpaceSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new SpaceService(db);
    const body = c.get('validatedBody') as z.infer<typeof createSpaceSchema>;

    const space = await service.create(c.get('user').sub, body);
    return c.json(space, 201);
  }
);

// GET /spaces — list spaces with optional filters (any role)
spaceRoutes.get(
  '/',
  validateQuery(spaceQuerySchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new SpaceService(db);
    const filters = c.get('validatedQuery') as z.infer<typeof spaceQuerySchema>;

    const data = await service.list(filters);
    return c.json(data);
  }
);

// GET /spaces/:id — space details with equipment (any role)
spaceRoutes.get('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const service = new SpaceService(db);
  const space = await service.getById(c.req.param('id'));
  return c.json(space);
});

// GET /spaces/:id/availability?date=YYYY-MM-DD (any role)
spaceRoutes.get('/:id/availability', async (c) => {
  const date = c.req.query('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'O parâmetro de consulta "date" é obrigatório (YYYY-MM-DD)', code: 'VALIDATION_ERROR' }, 400);
  }

  const db = createDb(c.env.DB);
  const service = new SpaceService(db);

  // Extract viewer from auth context (if authenticated)
  const user = c.get('user');
  const viewer = user
    ? {
        userId: user.sub,
        role: (
          isMasterAdmin(user)
            ? 'staff' as UserRole  // master admins get staff-level visibility
            : (extractRole(user) ?? 'student')
        ) as UserRole,
      }
    : undefined;

  const availability = await service.getAvailability(c.req.param('id'), date, viewer);

  // Audit log
  if (viewer) {
    const auditLog = new AuditLogService(db);
    const occupiedCount = availability.filter(s => s.status === 'reserved' || s.status === 'blocked').length;
    await auditLog.log(
      viewer.userId,
      'view_space_availability',
      c.req.param('id'),
      'space',
      `Consultou disponibilidade em ${date} (${occupiedCount} slots ocupados)`
    );
  }

  return c.json(availability);
});

// GET /spaces/:id/report?startDate=...&endDate=...
spaceRoutes.get('/:id/report', async (c) => {
  const db = createDb(c.env.DB);
  const service = new ReportService(db);
  const user = c.get('user');

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  if (!startDate || !endDate) {
    return c.json({ error: 'startDate e endDate são obrigatórios', code: 'MISSING_DATE_RANGE' }, 400);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return c.json({ error: 'Datas devem estar no formato AAAA-MM-DD', code: 'VALIDATION_ERROR' }, 400);
  }

  const report = await service.getSpaceReport({
    spaceId: c.req.param('id'),
    startDate,
    endDate,
    viewer: {
      userId: user.sub,
      role: (
        isMasterAdmin(user)
          ? 'staff' as UserRole
          : (extractRole(user) ?? 'student')
      ) as UserRole,
    },
  });

  // Audit log
  const auditLog = new AuditLogService(db);
  await auditLog.log(
    user.sub,
    'view_space_report',
    c.req.param('id'),
    'space',
    `${startDate} a ${endDate}`
  );

  return c.json(report);
});

// PUT /spaces/:id — update space (staff only)
spaceRoutes.put(
  '/:id',
  rbac(['staff']),
  validate(updateSpaceSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new SpaceService(db);
    const body = c.get('validatedBody') as z.infer<typeof updateSpaceSchema>;

    const space = await service.update(c.req.param('id'), c.get('user').sub, body);
    return c.json(space);
  }
);
