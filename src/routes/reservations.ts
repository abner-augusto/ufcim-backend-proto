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
  updateReservationSchema,
} from '@/validators/reservation.schema';
import { paginationSchema } from '@/validators/common.schema';
import { withRequesterContactFor } from '@/lib/reservation-privacy';
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

    const result = await service.createRecurring(
      user.sub,
      extractRole(user) ?? 'professor',
      user.department ?? 'Unknown',
      body
    );
    return c.json(result, 201);
  }
);

// PATCH /reservations/:id — edit date, time or description (MEL-023).
// Owner or staff; the service enforces ownership and revalidates the slot.
reservationRoutes.patch(
  '/:id',
  rbac(['student', 'professor', 'staff']),
  validate(updateReservationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const user = c.get('user');
    const body = c.get('validatedBody') as z.infer<typeof updateReservationSchema>;

    const role = extractRole(user) ?? 'student';
    const reservation = await service.update(
      c.req.param('id'),
      user.sub,
      role,
      user.department ?? 'Unknown',
      body
    );
    return c.json(withRequesterContactFor(role, reservation));
  }
);

// PATCH /reservations/:id/cancel (owner or staff)
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

    const role = extractRole(user) ?? 'student';
    const result = await service.cancel(c.req.param('id'), user.sub, role, cancelReason);
    return c.json(withRequesterContactFor(role, result));
  }
);

// PATCH /reservations/series/:recurrenceId/cancel (series owner, staff, or the
// series' registered requester — who may be a student, MEL-025)
reservationRoutes.patch(
  '/series/:recurrenceId/cancel',
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

    const role = extractRole(user) ?? 'student';
    const result = await service.cancelSeries(c.req.param('recurrenceId'), user.sub, role, cancelReason);
    return c.json(result.map((row) => withRequesterContactFor(role, row)));
  }
);

// GET /reservations/series/:recurrenceId/impact — preview cancel impact
// (professor, staff, and a student who is the series' requester, MEL-025)
reservationRoutes.get(
  '/series/:recurrenceId/impact',
  rbac(['student', 'professor', 'staff']),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);

    const result = await service.getSeriesImpact(c.req.param('recurrenceId'));
    return c.json(result);
  }
);

// GET /reservations/mine — reservations I own or that staff registered for me
// (MEL-025), any role
reservationRoutes.get(
  '/mine',
  validateQuery(paginationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const service = new ReservationService(db);
    const { page, limit } = c.get('validatedQuery') as z.infer<typeof paginationSchema>;
    const user = c.get('user');

    const data = await service.listByUser(user.sub, extractRole(user) ?? 'student', page, limit);
    return c.json(data);
  }
);

