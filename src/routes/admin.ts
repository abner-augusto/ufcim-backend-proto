import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { z } from 'zod';
import type { AppEnv } from '@/types/env';
import { AppError } from '@/middleware/error-handler';
import { createDb } from '@/db/client';
import { SpaceService } from '@/services/space.service';
import { SpaceManagerService } from '@/services/space-manager.service';
import { ReservationService } from '@/services/reservation.service';
import { BlockingService } from '@/services/blocking.service';
import { EquipmentService } from '@/services/equipment.service';
import { UserService } from '@/services/user.service';
import { UserAdminService } from '@/services/user-admin.service';
import { InvitationService } from '@/services/invitation.service';
import { InvitationRequestService } from '@/services/invitation-request.service';
import type { EmailResult } from '@/services/email.service';
import { DepartmentService } from '@/services/department.service';
import { StatsService } from '@/services/stats.service';
import { createSpaceSchema, updateSpaceSchema } from '@/validators/space.schema';
import { createBlockingSchema } from '@/validators/blocking.schema';
import { createEquipmentSchema } from '@/validators/equipment.schema';
import { createInvitationSchema, approveInvitationRequestSchema } from '@/validators/invitation.schema';
import { IAUD_PINS } from '@/lib/iaud-pins';

import { getActingUserId } from '@/admin/context';
import { reservationFilterSchema, blockingFilterSchema, equipmentFormSchema } from '@/admin/filters';
import {
  blankToUndefined,
  formDataToObject,
  parseSpaceForm,
  renderActionError,
  renderValidationErrors,
  stringValue,
  today,
} from '@/admin/ui';
import { renderDashboard } from '@/admin/views/dashboard.view';
import { renderSpacesView, renderSpaceDetail } from '@/admin/views/spaces.view';
import { renderReservationsView } from '@/admin/views/reservations.view';
import { renderBlockingsView } from '@/admin/views/blockings.view';
import { renderEquipmentView } from '@/admin/views/equipment.view';
import { renderUsersView } from '@/admin/views/users.view';
import { renderInvitationsView } from '@/admin/views/invitations.view';
import { renderInvitationRequestsView } from '@/admin/views/invitation-requests.view';
import { renderDepartmentsView } from '@/admin/views/departments.view';
import { renderLogsView } from '@/admin/views/logs.view';

const createEquipmentFormSchema = createEquipmentSchema;

/** Human-readable note about whether the invitation e-mail went out. */
function emailStatus(email: EmailResult): string {
  return email.sent
    ? 'E-mail enviado.'
    : `E-mail não enviado (${email.reason}) — copie o link abaixo e envie manualmente.`;
}

export const adminRoutes = new Hono<AppEnv>();

// Error boundary for the dashboard's HTMX flow. Action/partial handlers below
// can throw freely (NotFoundError, ConflictError, etc.); instead of the JSON
// error that HTMX would silently discard, this renders a verbose error panel
// that swaps into #admin-content. Runs after auth (mounted on the parent), so
// 401/403 still propagate as JSON and the client redirects to login.
adminRoutes.use('*', async (c, next) => {
  try {
    await next();
  } catch (err) {
    const status = err instanceof AppError ? err.statusCode : 500;
    // Auth failures bubble to the global handler so the client bounces to login.
    if (status === 401 || status === 403) throw err;
    // Non-HTMX callers (direct hits) get the standard JSON error.
    if (c.req.header('HX-Request') !== 'true') throw err;

    console.error(JSON.stringify({
      scope: 'admin',
      msg: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : 'Error',
      code: err instanceof AppError ? err.code : 'INTERNAL_ERROR',
      status,
      path: c.req.path,
      method: c.req.method,
    }));

    return c.html(renderActionError(c, err), status as ContentfulStatusCode);
  }
});

adminRoutes.get('/partials/dashboard', async (c) => {
  const db = createDb(c.env.DB);
  const statsService = new StatsService(db);
  const stats = await statsService.getDashboardStats();
  return c.html(renderDashboard(stats));
});

adminRoutes.get('/partials/spaces', async (c) => {
  return c.html(await renderSpacesView(c));
});

adminRoutes.get('/partials/spaces/:id', async (c) => {
  const db = createDb(c.env.DB);
  const spaceService = new SpaceService(db);
  const userService = new UserService(db);
  const space = await spaceService.getById(c.req.param('id'));
  const [availability, allUsers, allSpaces, depts] = await Promise.all([
    spaceService.getAvailability(space.id, today()),
    userService.list(1, 200),
    spaceService.list({ page: 1, limit: 100 }),
    new DepartmentService(db).list(),
  ]);
  const usedModelIds = new Set(allSpaces.filter((s) => s.id !== space.id).map((s) => s.modelId).filter(Boolean));
  const availablePins = IAUD_PINS.filter((p) => !usedModelIds.has(p.id));
  const deptOptions = depts.map((d) => ({ value: d.id, label: d.name }));

  return c.html(renderSpaceDetail(space, availability, allUsers, availablePins, deptOptions));
});

adminRoutes.get('/partials/reservations', async (c) => {
  return c.html(await renderReservationsView(c));
});

adminRoutes.get('/partials/blockings', async (c) => {
  return c.html(await renderBlockingsView(c));
});

adminRoutes.get('/partials/equipment', async (c) => {
  return c.html(await renderEquipmentView(c));
});

adminRoutes.get('/partials/users', async (c) => {
  return c.html(await renderUsersView(c));
});

adminRoutes.get('/partials/invitations', async (c) => {
  return c.html(await renderInvitationsView(c));
});

adminRoutes.get('/partials/invitation-requests', async (c) => {
  return c.html(await renderInvitationRequestsView(c));
});

adminRoutes.get('/partials/departments', async (c) => {
  return c.html(await renderDepartmentsView(c));
});

adminRoutes.post('/actions/departments', async (c) => {
  const body = await c.req.parseBody();
  const db = createDb(c.env.DB);
  const service = new DepartmentService(db);
  const dept = await service.create({
    id: (body.id as string).trim().toLowerCase(),
    name: (body.name as string).trim(),
    campus: (body.campus as string).trim(),
  });
  return c.html(await renderDepartmentsView(c, { message: `Departamento "${dept!.name}" criado.` }));
});

adminRoutes.patch('/actions/departments/:id', async (c) => {
  const body = await c.req.parseBody();
  const db = createDb(c.env.DB);
  const service = new DepartmentService(db);
  const dept = await service.update(c.req.param('id'), {
    name: (body.name as string)?.trim(),
    campus: (body.campus as string)?.trim(),
  });
  return c.html(await renderDepartmentsView(c, { message: `Departamento "${dept!.name}" atualizado.` }));
});

adminRoutes.get('/partials/logs', async (c) => {
  return c.html(await renderLogsView(c));
});


adminRoutes.post('/actions/spaces', async (c) => {
  const body = await formDataToObject(c);
  const parsed = createSpaceSchema.safeParse(parseSpaceForm(body));
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new SpaceService(db);
  const space = await service.create(getActingUserId(c), parsed.data);
  return c.html(await renderSpacesView(c, { message: `Espaço ${space.number} criado`, selectedSpaceId: space.id }));
});

adminRoutes.put('/actions/spaces/:id', async (c) => {
  const body = await formDataToObject(c);
  const parsed = updateSpaceSchema.safeParse(parseSpaceForm(body));
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new SpaceService(db);
  const space = await service.update(c.req.param('id'), getActingUserId(c), parsed.data);
  return c.html(await renderSpacesView(c, { message: `Espaço ${space.number} atualizado`, selectedSpaceId: space.id }));
});

adminRoutes.delete('/actions/spaces/:id', async (c) => {
  const db = createDb(c.env.DB);
  const service = new SpaceService(db);
  // Errors (e.g. space in use) propagate to the admin error boundary, which
  // renders a verbose red panel — instead of a green "success" message.
  await service.delete(c.req.param('id'), getActingUserId(c));
  return c.html(await renderSpacesView(c, { message: 'Espaço removido com sucesso' }));
});

adminRoutes.patch('/actions/reservations/series/:id/cancel', async (c) => {
  const body = await formDataToObject(c);
  const filters = reservationFilterSchema.parse(body);
  const cancelReason = typeof body.cancelReason === 'string' && body.cancelReason.trim() ? body.cancelReason.trim() : undefined;
  const db = createDb(c.env.DB);
  const service = new ReservationService(db);
  await service.cancelSeries(c.req.param('id'), getActingUserId(c), 'staff', cancelReason);
  return c.html(await renderReservationsView(c, { ...filters, message: 'Série recorrente cancelada' }));
});

adminRoutes.patch('/actions/reservations/:id/cancel', async (c) => {
  const body = await formDataToObject(c);
  const filters = reservationFilterSchema.parse(body);
  const cancelReason = typeof body.cancelReason === 'string' && body.cancelReason.trim() ? body.cancelReason.trim() : undefined;
  const db = createDb(c.env.DB);
  const service = new ReservationService(db);
  await service.cancel(c.req.param('id'), getActingUserId(c), 'staff', cancelReason);
  return c.html(await renderReservationsView(c, { ...filters, message: 'Reserva cancelada' }));
});

adminRoutes.post('/actions/blockings', async (c) => {
  const body = await formDataToObject(c);
  const parsed = createBlockingSchema.safeParse(body);
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new BlockingService(db);
  await service.create(getActingUserId(c), parsed.data);
  return c.html(await renderBlockingsView(c, { message: 'Bloqueio criado' }));
});

adminRoutes.patch('/actions/blockings/:id/remove', async (c) => {
  const filters = blockingFilterSchema.parse(await formDataToObject(c));
  const db = createDb(c.env.DB);
  const service = new BlockingService(db);
  await service.remove(c.req.param('id'), getActingUserId(c), 'staff');
  return c.html(await renderBlockingsView(c, { ...filters, message: 'Bloqueio removido' }));
});

adminRoutes.patch('/actions/equipment/:id/status', async (c) => {
  const body = await formDataToObject(c);
  const parsed = equipmentFormSchema.safeParse(body);
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new EquipmentService(db);
  await service.updateStatus(c.req.param('id'), getActingUserId(c), {
    status: parsed.data.status,
    notes: parsed.data.notes,
  });

  return c.html(await renderEquipmentView(c, { message: 'Status do equipamento atualizado' }));
});

adminRoutes.post('/actions/equipment', async (c) => {
  const body = await formDataToObject(c);
  const parsed = createEquipmentFormSchema.safeParse(body);
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new EquipmentService(db);
  await service.create(getActingUserId(c), parsed.data);

  return c.html(await renderEquipmentView(c, { message: 'Equipamento cadastrado' }));
});

adminRoutes.post('/actions/invitations', async (c) => {
  const body = await formDataToObject(c);
  const parsed = createInvitationSchema.safeParse({
    email: stringValue(body.email),
    name: stringValue(body.name),
    role: stringValue(body.role),
    department: stringValue(body.department),
    registration: blankToUndefined(body.registration),
  });
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new InvitationService(db, c.env);
  const { invitation, url, email } = await service.create({
    inviterId: getActingUserId(c),
    ...parsed.data,
  });
  return c.html(await renderInvitationsView(c, {
    message: `Convite criado para ${invitation.email}. ${emailStatus(email)}`,
    highlightUrl: url,
    highlightInvitationId: invitation.id,
  }));
});

adminRoutes.delete('/actions/invitations/:id', async (c) => {
  const db = createDb(c.env.DB);
  const service = new InvitationService(db, c.env);
  await service.revoke(getActingUserId(c), c.req.param('id'));
  return c.html(await renderInvitationsView(c, { message: 'Convite revogado.' }));
});

adminRoutes.post('/actions/invitations/:id/resend', async (c) => {
  const db = createDb(c.env.DB);
  const service = new InvitationService(db, c.env);
  const { invitation, url, email } = await service.resend(getActingUserId(c), c.req.param('id'));
  return c.html(await renderInvitationsView(c, {
    message: `Link reenviado para ${invitation.email}. ${emailStatus(email)}`,
    highlightUrl: url,
    highlightInvitationId: invitation.id,
  }));
});

adminRoutes.post('/actions/invitation-requests/:id/approve', async (c) => {
  const body = await formDataToObject(c);
  const parsed = approveInvitationRequestSchema.safeParse({
    role: stringValue(body.role),
    department: stringValue(body.department),
    registration: blankToUndefined(body.registration),
  });
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new InvitationRequestService(db, c.env);
  const { url, email, request } = await service.approve(getActingUserId(c), c.req.param('id'), parsed.data);
  return c.html(await renderInvitationRequestsView(c, {
    message: `Solicitação de ${request.email} aprovada. ${emailStatus(email)}`,
    highlightUrl: url,
    highlightRequestId: request.id,
  }));
});

adminRoutes.post('/actions/invitation-requests/:id/reject', async (c) => {
  const db = createDb(c.env.DB);
  const service = new InvitationRequestService(db, c.env);
  const request = await service.reject(getActingUserId(c), c.req.param('id'));
  return c.html(await renderInvitationRequestsView(c, { message: `Solicitação de ${request.email} rejeitada.` }));
});

adminRoutes.patch('/actions/users/:id/role', async (c) => {
  const body = await formDataToObject(c);
  const newRole = stringValue(body.role);
  const db = createDb(c.env.DB);
  const service = new UserAdminService(db, c.env);
  await service.changeRole(getActingUserId(c), c.req.param('id'), newRole as Parameters<UserAdminService['changeRole']>[2]);
  return c.html(await renderUsersView(c, { message: 'Papel atualizado.' }));
});

adminRoutes.patch('/actions/users/:id/disable', async (c) => {
  const body = await formDataToObject(c);
  const disabled = body.disabled === 'true';
  const db = createDb(c.env.DB);
  const service = new UserAdminService(db, c.env);
  await service.setDisabled(getActingUserId(c), c.req.param('id'), disabled);
  return c.html(await renderUsersView(c, { message: disabled ? 'Conta desativada.' : 'Conta reativada.' }));
});

adminRoutes.post('/actions/users/:id/reset-password', async (c) => {
  const db = createDb(c.env.DB);
  const service = new UserAdminService(db, c.env);
  const { url } = await service.resetPassword(getActingUserId(c), c.req.param('id'));
  return c.html(await renderUsersView(c, { message: 'Link de redefinição gerado.', highlightUrl: url, highlightUserId: c.req.param('id') }));
});

adminRoutes.delete('/actions/users/:id/sessions', async (c) => {
  const db = createDb(c.env.DB);
  const service = new UserAdminService(db, c.env);
  const { revoked } = await service.revokeAllSessions(getActingUserId(c), c.req.param('id'));
  return c.html(await renderUsersView(c, { message: `${revoked} sessão(ões) encerrada(s).` }));
});

adminRoutes.delete('/actions/users/:id', async (c) => {
  const db = createDb(c.env.DB);
  const service = new UserAdminService(db, c.env);
  await service.softDelete(getActingUserId(c), c.req.param('id'));
  return c.html(await renderUsersView(c, { message: 'Usuário excluído.' }));
});

adminRoutes.post('/actions/spaces/:spaceId/managers', async (c) => {
  const body = await formDataToObject(c);
  const spaceId = c.req.param('spaceId');
  const parsed = z.object({ userId: z.string(), role: z.string() }).safeParse(body);
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new SpaceManagerService(db);
  await service.assign(getActingUserId(c), { spaceId, userId: parsed.data.userId, role: parsed.data.role });
  return c.html(await renderSpacesView(c, { message: 'Gestor atribuído com sucesso', selectedSpaceId: spaceId }));
});

adminRoutes.delete('/actions/spaces/:spaceId/managers/:userId', async (c) => {
  const spaceId = c.req.param('spaceId');
  const userId = c.req.param('userId');
  const db = createDb(c.env.DB);
  const service = new SpaceManagerService(db);
  await service.remove(getActingUserId(c), spaceId, userId);
  return c.html(await renderSpacesView(c, { message: 'Gestor removido com sucesso', selectedSpaceId: spaceId }));
});
