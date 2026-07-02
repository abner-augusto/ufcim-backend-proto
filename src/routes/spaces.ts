import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { spaces } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { SpaceService } from '@/services/space.service';
import { ReportService } from '@/services/report.service';
import { AuditLogService } from '@/services/audit-log.service';
import { NotFoundError } from '@/middleware/error-handler';
import { validate, validateQuery } from '@/middleware/validation';
import { rbac, extractRole, isMasterAdmin } from '@/middleware/rbac';
import { createSpaceSchema, updateSpaceSchema, spaceQuerySchema } from '@/validators/space.schema';
import { dateSchema } from '@/validators/common.schema';
import type { UserRole } from '@/types/auth';

export const spaceRoutes = new Hono<AppEnv>();

const availabilityQuerySchema = z.object({
  date: dateSchema,
});

const reportQuerySchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
});

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
spaceRoutes.get('/:id/availability', validateQuery(availabilityQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const service = new SpaceService(db);
  const { date } = c.get('validatedQuery') as z.infer<typeof availabilityQuerySchema>;

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
// Reports are restricted to the same roles as the occupancy report (CAN_VIEW_REPORTS
// on the frontend); without this guard any authenticated user — including students —
// could fetch per-space report data directly from the API.
spaceRoutes.get('/:id/report', rbac(['professor', 'staff', 'maintenance']), validateQuery(reportQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const service = new ReportService(db);
  const user = c.get('user');
  const { startDate, endDate } = c.get('validatedQuery') as z.infer<typeof reportQuerySchema>;

  const spaceId = c.req.param('id');

  // Pre-load space to eliminate redundant DB query inside the service
  const space = await db.query.spaces.findFirst({
    where: eq(spaces.id, spaceId),
    with: { department: true },
  });
  if (!space) {
    throw new NotFoundError('Space');
  }

  const report = await service.getSpaceReport({
    space,
    spaceId,
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
