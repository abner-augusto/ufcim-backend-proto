import { Hono } from 'hono';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { ReservationService } from '@/services/reservation.service';
import { validate, validateQuery } from '@/middleware/validation';
import { rbac } from '@/middleware/rbac';
import { extractRole } from '@/middleware/rbac';
import {
  createReservationSchema,
  createRecurringReservationSchema,
} from '@/validators/reservation.schema';
import { paginationSchema } from '@/validators/common.schema';
import type { z } from 'zod';

export const reservationRoutes = new Hono<AppEnv>();

// POST /reservations — create reservation (student, professor, staff)
reservationRoutes.post(
  '/',
  rbac(['student', 'professor', 'staff']),
  validate(createReservationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const user = c.get('user');
    const body = c.get('validatedBody') as z.infer<typeof createReservationSchema>;

    const reservation = await service.create(
      user.sub,
      extractRole(user) ?? 'student',
      user.department ?? 'Unknown',
      body
    );
    return c.json(reservation, 201);
  }
);

// POST /reservations/recurring — create recurring series (professor, staff)
reservationRoutes.post(
  '/recurring',
  rbac(['professor', 'staff']),
  validate(createRecurringReservationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const user = c.get('user');
    const body = c.get('validatedBody') as z.infer<typeof createRecurringReservationSchema>;

    const result = await service.createRecurring(user.sub, extractRole(user) ?? 'professor', body);
    return c.json(result, 201);
  }
);

// PATCH /reservations/:id/cancel (student, professor, staff)
reservationRoutes.patch(
  '/:id/cancel',
  rbac(['student', 'professor', 'staff']),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const user = c.get('user');

    let cancelReason: string | undefined;
    try {
      const body = await c.req.json();
      if (typeof body?.cancelReason === 'string' && body.cancelReason.trim()) {
        cancelReason = body.cancelReason.trim();
      }
    } catch {
      // body absent or not JSON — cancelReason stays undefined
    }

    const result = await service.cancel(c.req.param('id'), user.sub, extractRole(user) ?? 'student', cancelReason);
    return c.json(result);
  }
);

// GET /reservations/mine — current user's reservations (any role)
reservationRoutes.get(
  '/mine',
  validateQuery(paginationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const { page, limit } = c.get('validatedQuery') as z.infer<typeof paginationSchema>;

    const data = await service.listByUser(c.get('user').sub, page, limit);
    return c.json(data);
  }
);

// GET /reservations/space/:spaceId?date=YYYY-MM-DD (any role)
reservationRoutes.get('/space/:spaceId', async (c) => {
  const db = createDb(c.env.DB);
  const service = new ReservationService(db);
  const date = c.req.query('date');

  const data = await service.listBySpace(c.req.param('spaceId'), date);
  return c.json(data);
});
