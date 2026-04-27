import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { SpaceService } from '@/services/space.service';
import { SpaceManagerService } from '@/services/space-manager.service';
import { ReservationService } from '@/services/reservation.service';
import { BlockingService } from '@/services/blocking.service';
import { EquipmentService } from '@/services/equipment.service';
import { UserService } from '@/services/user.service';
import { AuditLogService } from '@/services/audit-log.service';
import { StatsService } from '@/services/stats.service';
import { createSpaceSchema, updateSpaceSchema } from '@/validators/space.schema';
import { createBlockingSchema } from '@/validators/blocking.schema';
import { createEquipmentSchema, updateEquipmentStatusSchema } from '@/validators/equipment.schema';
import { paginationSchema } from '@/validators/common.schema';
import { renderAdminShell } from '@/admin/admin-shell';
import { DEFAULT_CLOSED_FROM, DEFAULT_CLOSED_TO, normalizeClosedHours } from '@/lib/schedule';

// Filter schemas use z.string() (not .uuid()) because Zod v4 enforces strict
// RFC 4122 compliance, which rejects the deterministic seed UUIDs used in dev.
const reservationFilterSchema = paginationSchema.extend({
  spaceId: z.string().optional(),
  userId: z.string().optional(),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const blockingFilterSchema = paginationSchema.extend({
  spaceId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const logFilterSchema = paginationSchema.extend({
  userId: z.string().optional(),
  actionType: z.string().optional(),
  referenceType: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const equipmentFormSchema = updateEquipmentStatusSchema.extend({
  page: z.coerce.number().int().positive().default(1).optional(),
});

const createEquipmentFormSchema = createEquipmentSchema;

export const adminRoutes = new Hono<AppEnv>();
type AdminContext = Context<AppEnv>;

function getActingUserId(c: AdminContext): string {
  return getCookie(c, 'admin_acting_as') ?? c.get('user').sub;
}

adminRoutes.get('/', (c) => c.html(renderAdminShell('/admin')));
adminRoutes.get('/spaces', (c) => c.html(renderAdminShell('/admin/spaces')));
adminRoutes.get('/reservations', (c) => c.html(renderAdminShell('/admin/reservations')));
adminRoutes.get('/blockings', (c) => c.html(renderAdminShell('/admin/blockings')));
adminRoutes.get('/equipment', (c) => c.html(renderAdminShell('/admin/equipment')));
adminRoutes.get('/users', (c) => c.html(renderAdminShell('/admin/users')));
adminRoutes.get('/logs', (c) => c.html(renderAdminShell('/admin/logs')));

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
  const [availability, allUsers] = await Promise.all([
    spaceService.getAvailability(space.id, today()),
    userService.list(1, 200),
  ]);

  return c.html(renderSpaceDetail(space, availability, allUsers));
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

adminRoutes.get('/partials/logs', async (c) => {
  return c.html(await renderLogsView(c));
});

adminRoutes.get('/partials/user-switcher', async (c) => {
  const db = createDb(c.env.DB);
  const userService = new UserService(db);
  const users = await userService.list(1, 100);
  const actingAs = getActingUserId(c);
  return c.html(renderUserSwitcher(users, actingAs));
});

adminRoutes.post('/actions/acting-as', async (c) => {
  const body = await formDataToObject(c);
  const userId = String(body.userId ?? '');
  setCookie(c, 'admin_acting_as', userId, { path: '/' });
  const db = createDb(c.env.DB);
  const userService = new UserService(db);
  const users = await userService.list(1, 100);
  return c.html(renderUserSwitcher(users, userId));
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
  try {
    await service.delete(c.req.param('id'), getActingUserId(c));
    return c.html(await renderSpacesView(c, { message: 'Espaço removido com sucesso' }));
  } catch (err) {
    return c.html(await renderSpacesView(c, { message: err instanceof Error ? err.message : 'Erro ao remover espaço' }));
  }
});

adminRoutes.patch('/actions/reservations/series/:id/cancel', async (c) => {
  const filters = reservationFilterSchema.parse(await formDataToObject(c));
  const db = createDb(c.env.DB);
  const service = new ReservationService(db);
  await service.cancelSeries(c.req.param('id'), getActingUserId(c), 'staff');
  return c.html(await renderReservationsView(c, { ...filters, message: 'Série recorrente cancelada' }));
});

adminRoutes.patch('/actions/reservations/:id/cancel', async (c) => {
  const filters = reservationFilterSchema.parse(await formDataToObject(c));
  const db = createDb(c.env.DB);
  const service = new ReservationService(db);
  await service.cancel(c.req.param('id'), getActingUserId(c), 'staff');
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

adminRoutes.post('/actions/spaces/:spaceId/managers', async (c) => {
  const body = await formDataToObject(c);
  const spaceId = c.req.param('spaceId');
  const parsed = z.object({ userId: z.string(), role: z.string() }).safeParse(body);
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new SpaceManagerService(db);
  try {
    await service.assign(getActingUserId(c), { spaceId, userId: parsed.data.userId, role: parsed.data.role });
    return c.html(await renderSpacesView(c, { message: 'Gestor atribuído com sucesso', selectedSpaceId: spaceId }));
  } catch (err) {
    return c.html(await renderSpacesView(c, { message: err instanceof Error ? err.message : 'Erro ao atribuir gestor', selectedSpaceId: spaceId }));
  }
});

adminRoutes.delete('/actions/spaces/:spaceId/managers/:userId', async (c) => {
  const spaceId = c.req.param('spaceId');
  const userId = c.req.param('userId');
  const db = createDb(c.env.DB);
  const service = new SpaceManagerService(db);
  try {
    await service.remove(getActingUserId(c), spaceId, userId);
    return c.html(await renderSpacesView(c, { message: 'Gestor removido com sucesso', selectedSpaceId: spaceId }));
  } catch (err) {
    return c.html(await renderSpacesView(c, { message: err instanceof Error ? err.message : 'Erro ao remover gestor', selectedSpaceId: spaceId }));
  }
});

async function renderSpacesView(
  c: AdminContext,
  options?: { message?: string; selectedSpaceId?: string }
) {
  const db = createDb(c.env.DB);
  const spaceService = new SpaceService(db);
  const userService = new UserService(db);
  const spaces = await spaceService.list({ page: 1, limit: 100 });
  const allUsers = await userService.list(1, 200);
  const selectedSpaceId = options?.selectedSpaceId ?? c.req.query('selectedSpaceId');

  let detailHtml = renderEmptyState('Selecione um espaço para inspecionar equipamentos, disponibilidade e editar seus metadados.');
  if (selectedSpaceId) {
    const space = await spaceService.getById(selectedSpaceId);
    const availability = await spaceService.getAvailability(space.id, today());
    detailHtml = renderSpaceDetail(space, availability, allUsers);
  }

  return `
    <section class="space-y-6">
      ${renderMessage(options?.message)}
      <div class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div class="mb-4 flex items-center justify-between">
            <div>
              <h2 class="text-xl font-semibold">Espaços</h2>
              <p class="text-sm text-slate-600">Inventário de espaços reserváveis.</p>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">${spaces.length} espaços</span>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr class="text-left text-slate-500">
                  <th class="px-3 py-2 font-medium">Nome</th>
                  <th class="px-3 py-2 font-medium">Número</th>
                  <th class="px-3 py-2 font-medium">Tipo</th>
                  <th class="px-3 py-2 font-medium">Bloco</th>
                  <th class="px-3 py-2 font-medium">Campus</th>
                  <th class="px-3 py-2 font-medium">Capacidade</th>
                  <th class="px-3 py-2 font-medium">Model ID</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${spaces.map((space) => `
                  <tr
                    class="cursor-pointer hover:bg-slate-50"
                    hx-get="/admin/partials/spaces/${space.id}"
                    hx-target="#space-detail"
                    hx-swap="innerHTML"
                  >
                    <td class="px-3 py-3 font-medium">${escapeHtml(space.name)}</td>
                    <td class="px-3 py-3 text-slate-500">${escapeHtml(space.number)}</td>
                    <td class="px-3 py-3">${escapeHtml(space.type)}</td>
                    <td class="px-3 py-3">${escapeHtml(space.block)}</td>
                    <td class="px-3 py-3">${escapeHtml(space.campus)}</td>
                    <td class="px-3 py-3">${space.capacity}</td>
                    <td class="px-3 py-3 max-w-[160px] truncate text-slate-400" title="${escapeAttribute(space.modelId ?? '')}">${escapeHtml(space.modelId ?? '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="space-y-6">
          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 class="text-xl font-semibold">Criar Espaço</h2>
            <p class="mt-1 text-sm text-slate-600">Utiliza a mesma camada de serviço da API pública.</p>
            <form class="mt-4 grid gap-3 sm:grid-cols-2" hx-post="/admin/actions/spaces" hx-target="#admin-content" hx-swap="innerHTML">
              ${renderSpaceFields()}
              <div class="sm:col-span-2">
                <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Criar</button>
              </div>
            </form>
          </div>

          <div id="space-detail">${detailHtml}</div>
        </div>
      </div>
    </section>
  `;
}

function renderSpaceDetail(
  space: Awaited<ReturnType<SpaceService['getById']>>,
  availability: Awaited<ReturnType<SpaceService['getAvailability']>>,
  allUsers: Awaited<ReturnType<UserService['list']>>
) {
  const closedHours = normalizeClosedHours(space.closedFrom, space.closedTo);
  const assignedUserIds = new Set(space.managers.map((m) => m.userId));
  const unassignedUsers = allUsers.filter((u) => !assignedUserIds.has(u.id));

  return `
    <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-xl font-semibold">${escapeHtml(space.name)}</h3>
          <p class="text-sm text-slate-600">${escapeHtml(space.number)} · ${escapeHtml(space.department)} · ${escapeHtml(space.campus)} campus</p>
        </div>
        <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">${escapeHtml(space.type)}</span>
      </div>

      <dl class="mt-4 grid gap-3 text-sm text-slate-700">
        <div><strong>Bloco:</strong> ${escapeHtml(space.block)}</div>
        <div><strong>Capacidade:</strong> ${space.capacity}</div>
        <div><strong>ID do Modelo:</strong> <span class="font-mono text-xs text-slate-500">${escapeHtml(space.modelId ?? '—')}</span></div>
        <div><strong>Horário Fechado:</strong> ${escapeHtml(closedHours.closedFrom)}-${escapeHtml(closedHours.closedTo)}</div>
        <div><strong>Mobiliário:</strong> ${escapeHtml(space.furniture ?? 'Não informado')}</div>
        <div><strong>Iluminação:</strong> ${escapeHtml(space.lighting ?? 'Não informado')}</div>
        <div><strong>HVAC:</strong> ${escapeHtml(space.hvac ?? 'Não informado')}</div>
        <div><strong>Multimídia:</strong> ${escapeHtml(space.multimedia ?? 'Não informado')}</div>
      </dl>

      <div class="mt-6">
        <h4 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Disponibilidade de Hoje</h4>
        <div class="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          ${availability.map((slot) => `
            <div class="rounded-xl border border-slate-200 px-3 py-3">
              <div class="text-sm font-medium">${slot.startTime}-${slot.endTime}</div>
              <div class="mt-1 text-sm ${slot.status === 'available' ? 'text-emerald-600' : slot.status === 'blocked' || slot.status === 'not_reservable' ? 'text-rose-600' : slot.status === 'closed' ? 'text-slate-500' : 'text-amber-600'}">
                ${renderAvailabilityStatus(slot.status)}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="mt-6">
        <h4 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Equipamentos</h4>
        <ul class="mt-3 space-y-2 text-sm text-slate-700">
          ${space.equipment.length > 0
            ? space.equipment.map((item) => `
              <li class="rounded-xl bg-slate-50 px-3 py-3">
                <div class="font-medium">${escapeHtml(item.name)}</div>
                <div class="text-slate-500">${escapeHtml(item.type)} · ${escapeHtml(item.status)}</div>
              </li>
            `).join('')
            : '<li class="rounded-xl bg-slate-50 px-3 py-3 text-slate-500">Nenhum equipamento cadastrado.</li>'}
        </ul>
      </div>

      <div class="mt-6 border-t border-slate-200 pt-6">
        <h4 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Gestores</h4>
        <ul class="mt-3 space-y-2 text-sm text-slate-700">
          ${space.managers.length > 0
            ? space.managers.map((m) => `
              <li class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3">
                <div>
                  <span class="font-medium">${escapeHtml(m.user?.name ?? m.userId)}</span>
                  <span class="ml-2 text-slate-500">${escapeHtml(m.user?.registration ?? '')} · ${escapeHtml(m.user?.role ?? '')}</span>
                  <span class="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium">${m.role === 'coordinator' ? 'Coordenador' : 'Mantenedor'}</span>
                </div>
                <form
                  hx-delete="/admin/actions/spaces/${space.id}/managers/${m.userId}"
                  hx-target="#admin-content"
                  hx-swap="innerHTML"
                  hx-confirm="Remover gestor ${escapeAttribute(m.user?.name ?? m.userId)} deste espaço?"
                >
                  <button type="submit" class="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">Remover</button>
                </form>
              </li>
            `).join('')
            : '<li class="rounded-xl bg-slate-50 px-3 py-3 text-slate-500">Nenhum gestor atribuído.</li>'}
        </ul>

        ${unassignedUsers.length > 0 ? `
          <div class="mt-4">
            <h5 class="text-sm font-semibold text-slate-700">Atribuir Gestor</h5>
            <form class="mt-2 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
              hx-post="/admin/actions/spaces/${space.id}/managers"
              hx-target="#admin-content"
              hx-swap="innerHTML"
            >
              ${renderSelect('userId', 'Usuário', unassignedUsers.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` })), '', true)}
              ${renderSelect('role', 'Papel', [
                { value: 'coordinator', label: 'Coordenador' },
                { value: 'maintainer', label: 'Mantenedor' },
              ], '', true)}
              <div class="flex items-end">
                <button type="submit" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Atribuir</button>
              </div>
            </form>
          </div>
        ` : ''}
      </div>

      <div class="mt-6 border-t border-slate-200 pt-6">
        <h4 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Editar Espaço</h4>
        <form class="mt-4 grid gap-3 sm:grid-cols-2" hx-put="/admin/actions/spaces/${space.id}" hx-target="#admin-content" hx-swap="innerHTML">
          ${renderSpaceFields(space)}
          <input type="hidden" name="selectedSpaceId" value="${space.id}" />
          <div class="sm:col-span-2 flex items-center gap-3">
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Salvar Alterações</button>
            <button
              type="button"
              class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
              hx-delete="/admin/actions/spaces/${space.id}"
              hx-target="#admin-content"
              hx-swap="innerHTML"
              hx-confirm="Remover espaço '${escapeAttribute(space.number)}'? Isso também remove todos os equipamentos vinculados. Reservas e bloqueios ativos impedem a remoção."
            >Remover Espaço</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

async function renderReservationsView(
  c: AdminContext,
  overrides?: Partial<z.infer<typeof reservationFilterSchema>> & { message?: string }
) {
  const filters = reservationFilterSchema.parse({
    ...c.req.query(),
    ...overrides,
  });
  const normalizedFilters = normalizeEmptyStrings(filters);
  const db = createDb(c.env.DB);
  const reservationService = new ReservationService(db);
  const spaceService = new SpaceService(db);
  const userService = new UserService(db);
  const reservations = await reservationService.listForAdmin(normalizedFilters);
  const spaces = await spaceService.list({ page: 1, limit: 100 });
  const users = await userService.list(1, 100);

  return `
    <section class="space-y-6">
      ${renderMessage(overrides?.message)}
      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div class="mb-4">
          <h2 class="text-xl font-semibold">Reservas</h2>
          <p class="text-sm text-slate-600">Filtre por intervalo de datas, espaço, usuário ou status. Séries recorrentes exibem dia da semana, horário e ação em lote.</p>
        </div>
        <form class="grid gap-3 md:grid-cols-5" hx-get="/admin/partials/reservations" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="true" hx-disabled-elt="find button[type='submit']">
          ${renderSelect('spaceId', 'Espaço', spaces.map((space) => ({ value: space.id, label: space.number })), normalizedFilters.spaceId)}
          ${renderSelect('userId', 'Usuário', users.map((user) => ({ value: user.id, label: user.name })), normalizedFilters.userId)}
          ${renderSelect('status', 'Status', [
            { value: 'confirmed', label: 'Confirmada' },
            { value: 'canceled', label: 'Cancelada' },
            { value: 'overridden', label: 'Sobrescrita' },
          ], normalizedFilters.status)}
          ${renderInput('dateFrom', 'Data Inicial', 'date', normalizedFilters.dateFrom)}
          ${renderInput('dateTo', 'Data Final', 'date', normalizedFilters.dateTo)}
          <div class="md:col-span-5 flex items-center gap-3">
            <button type="submit" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Aplicar Filtros</button>
            ${normalizedFilters.spaceId || normalizedFilters.userId || normalizedFilters.status || normalizedFilters.dateFrom || normalizedFilters.dateTo
              ? `<a href="/admin/reservations" hx-get="/admin/partials/reservations" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/reservations" class="text-sm text-slate-500 hover:text-slate-800">Limpar filtros ×</a>`
              : ''}
          </div>
        </form>
      </div>

      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th class="px-3 py-2 font-medium">Data</th>
                <th class="px-3 py-2 font-medium">Horário</th>
                <th class="px-3 py-2 font-medium">Espaço</th>
                <th class="px-3 py-2 font-medium">Usuário</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Série</th>
                <th class="px-3 py-2 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${reservations.data.length === 0
                ? `<tr><td colspan="7" class="px-3 py-6 text-center text-slate-400">Nenhuma reserva encontrada com os filtros atuais.</td></tr>`
                : renderReservationRows(reservations.data, normalizedFilters)}
            </tbody>
          </table>
        </div>
        ${renderPagination('/admin/partials/reservations', reservations.pagination, normalizedFilters)}
      </div>
    </section>
  `;
}

async function renderBlockingsView(
  c: AdminContext,
  overrides?: Partial<z.infer<typeof blockingFilterSchema>> & { message?: string }
) {
  const filters = blockingFilterSchema.parse({
    ...c.req.query(),
    ...overrides,
  });
  const normalizedFilters = normalizeEmptyStrings(filters);
  const db = createDb(c.env.DB);
  const blockingService = new BlockingService(db);
  const spaceService = new SpaceService(db);
  const result = await blockingService.listActive(normalizedFilters);
  const spaces = await spaceService.list({ page: 1, limit: 100 });

  return `
    <section class="space-y-6">
      ${renderMessage(overrides?.message)}
      <div class="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Criar Bloqueio</h2>
          <p class="mt-1 text-sm text-slate-600">Use para indisponibilidades administrativas ou de manutenção.</p>
          <form class="mt-4 grid gap-3" hx-post="/admin/actions/blockings" hx-target="#admin-content" hx-swap="innerHTML">
            ${renderSelect('spaceId', 'Espaço', spaces.map((space) => ({ value: space.id, label: space.number })))}
            ${renderInput('date', 'Data', 'date', today())}
            ${renderSelect('startTime', 'Hora Inicial', HOURLY_OPTIONS, '08:00', true)}
            ${renderSelect('endTime', 'Hora Final', HOURLY_BOUNDARY_OPTIONS, '09:00', true)}
            ${renderSelect('blockType', 'Tipo de Bloqueio', [
              { value: 'maintenance', label: 'Manutenção' },
              { value: 'administrative', label: 'Administrativo' },
            ])}
            ${renderTextarea('reason', 'Motivo', '', true, 'Descreva o motivo do bloqueio')}
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Criar Bloqueio</button>
          </form>
        </div>

        <div class="space-y-6">
          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold">Bloqueios Ativos</h2>
              ${normalizedFilters.spaceId || normalizedFilters.dateFrom || normalizedFilters.dateTo
                ? `<a href="/admin/blockings" hx-get="/admin/partials/blockings" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/blockings" class="text-sm text-slate-500 hover:text-slate-800">Limpar filtros ×</a>`
                : ''}
            </div>
            <form class="mt-4 grid gap-3 md:grid-cols-4" hx-get="/admin/partials/blockings" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="true" hx-disabled-elt="find button[type='submit']">
              ${renderSelect('spaceId', 'Espaço', spaces.map((space) => ({ value: space.id, label: space.number })), normalizedFilters.spaceId)}
              ${renderInput('dateFrom', 'Data Inicial', 'date', normalizedFilters.dateFrom)}
              ${renderInput('dateTo', 'Data Final', 'date', normalizedFilters.dateTo)}
              <div class="flex items-end">
                <button type="submit" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Filtrar</button>
              </div>
            </form>
          </div>

          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr class="text-left text-slate-500">
                    <th class="px-3 py-2 font-medium">Data</th>
                    <th class="px-3 py-2 font-medium">Horário</th>
                    <th class="px-3 py-2 font-medium">Espaço</th>
                    <th class="px-3 py-2 font-medium">Tipo</th>
                    <th class="px-3 py-2 font-medium">Motivo</th>
                    <th class="px-3 py-2 font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${result.data.length === 0
                    ? `<tr><td colspan="6" class="px-3 py-6 text-center text-slate-400">Nenhum bloqueio ativo encontrado.</td></tr>`
                    : result.data.map((blocking) => `
                      <tr class="hover:bg-slate-50">
                        <td class="px-3 py-3">${blocking.date}</td>
                        <td class="px-3 py-3 tabular-nums">${blocking.startTime}–${blocking.endTime}</td>
                        <td class="px-3 py-3 font-medium">${escapeHtml(blocking.space?.number ?? blocking.spaceId)}</td>
                        <td class="px-3 py-3">${escapeHtml(renderBlockingType(blocking.blockType))}</td>
                        <td class="px-3 py-3 max-w-xs truncate" title="${escapeAttribute(blocking.reason)}">${escapeHtml(blocking.reason)}</td>
                        <td class="px-3 py-3">
                          <form hx-patch="/admin/actions/blockings/${blocking.id}/remove" hx-target="#admin-content" hx-swap="innerHTML" hx-confirm="Remover bloqueio de ${escapeAttribute(blocking.date)} (${escapeAttribute(blocking.startTime)}–${escapeAttribute(blocking.endTime)})? Esta ação não pode ser desfeita.">
                            ${renderHiddenInputs(normalizedFilters)}
                            <button type="submit" class="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">Remover</button>
                          </form>
                        </td>
                      </tr>
                    `).join('')}
                </tbody>
              </table>
            </div>
            ${renderPagination('/admin/partials/blockings', result.pagination, normalizedFilters)}
          </div>
        </div>
      </div>
    </section>
  `;
}

async function renderEquipmentView(
  c: AdminContext,
  options?: { message?: string }
) {
  const db = createDb(c.env.DB);
  const equipmentService = new EquipmentService(db);
  const spaceService = new SpaceService(db);
  const groups = await equipmentService.listGroupedBySpace();
  const spaces = await spaceService.list({ page: 1, limit: 100 });

  return `
    <section class="space-y-6">
      ${renderMessage(options?.message)}
      <div class="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Cadastrar Equipamento</h2>
          <p class="mt-1 text-sm text-slate-600">Cadastre o equipamento com seu identificador patrimonial oficial da universidade.</p>
          <form class="mt-4 grid gap-3" hx-post="/admin/actions/equipment" hx-target="#admin-content" hx-swap="innerHTML">
            ${renderSelect('spaceId', 'Espaço', spaces.map((space) => ({ value: space.id, label: `${space.number} · ${space.department}` })))}
            ${renderInput('assetId', 'ID do Equipamento', 'text', '', false, '', 'ex.: 2020002658')}
            ${renderInput('name', 'Nome do Equipamento', 'text')}
            ${renderInput('type', 'Tipo', 'text', '', false, '', 'projetor, hvac, display, notebook')}
            ${renderSelect('status', 'Status', [
              { value: 'working', label: 'Funcionando' },
              { value: 'broken', label: 'Quebrado' },
              { value: 'under_repair', label: 'Em Reparo' },
              { value: 'replacement_scheduled', label: 'Troca Agendada' },
            ], 'working', true)}
            ${renderInput('notes', 'Observações', 'text')}
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Cadastrar Equipamento</button>
          </form>
        </div>

        <div class="space-y-6">
          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 class="text-xl font-semibold">Equipamentos</h2>
            <p class="mt-1 text-sm text-slate-600">Agrupados por espaço. Atualize os status em linha.</p>
          </div>

          ${groups.map((space) => `
            <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div class="mb-4 flex items-center justify-between">
                <div>
                  <h3 class="text-lg font-semibold">${escapeHtml(space.name)}</h3>
                  <p class="text-sm text-slate-600">${escapeHtml(space.number)} · ${escapeHtml(space.type)} · ${escapeHtml(space.department)}</p>
                </div>
                <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">${space.equipment.length} itens</span>
              </div>
              <div class="space-y-3">
                ${space.equipment.length > 0
                  ? space.equipment.map((item) => `
                    <form class="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1.1fr_0.9fr_0.8fr_1fr_auto]" hx-patch="/admin/actions/equipment/${item.id}/status" hx-target="#admin-content" hx-swap="innerHTML">
                      <div>
                        <div class="font-medium">${escapeHtml(item.name)}</div>
                        <div class="text-sm text-slate-500">${escapeHtml(item.type)}</div>
                      </div>
                      ${renderInput('assetId', 'ID Patrimonial', 'text', item.assetId, true, '', 'ex.: 2020002658')}
                      ${renderSelect('status', 'Status', [
                        { value: 'working', label: 'Funcionando' },
                        { value: 'broken', label: 'Quebrado' },
                        { value: 'under_repair', label: 'Em Reparo' },
                        { value: 'replacement_scheduled', label: 'Troca Agendada' },
                      ], item.status, true)}
                      ${renderInput('notes', 'Observações', 'text', item.notes ?? '', true)}
                      <div class="flex items-end">
                        <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Salvar</button>
                      </div>
                    </form>
                  `).join('')
                  : '<div class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Nenhum equipamento cadastrado para este espaço.</div>'}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

async function renderUsersView(
  c: AdminContext
) {
  const filters = paginationSchema.parse(c.req.query());
  const db = createDb(c.env.DB);
  const userService = new UserService(db);
  const result = await userService.listForAdmin(filters.page, filters.limit);

  return `
    <section class="space-y-6">
      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 class="text-xl font-semibold">Usuários</h2>
        <p class="mt-1 text-sm text-slate-600">Visualização somente leitura. Os registros de usuários são sincronizados a partir das claims do JWT.</p>
      </div>
      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th class="px-3 py-2 font-medium">Nome</th>
                <th class="px-3 py-2 font-medium">Matrícula</th>
                <th class="px-3 py-2 font-medium">Email</th>
                <th class="px-3 py-2 font-medium">Departamento</th>
                <th class="px-3 py-2 font-medium">Papel</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${result.data.map((user) => `
                <tr>
                  <td class="px-3 py-3 font-medium">${escapeHtml(user.name)}</td>
                  <td class="px-3 py-3">${escapeHtml(user.registration ?? '—')}</td>
                  <td class="px-3 py-3">${escapeHtml(user.email)}</td>
                  <td class="px-3 py-3">${escapeHtml(user.department)}</td>
                  <td class="px-3 py-3">${renderRoleBadge(user.role)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${renderPagination('/admin/partials/users', result.pagination, filters)}
      </div>
    </section>
  `;
}

async function renderLogsView(
  c: AdminContext
) {
  const filters = logFilterSchema.parse(c.req.query());
  const normalizedFilters = normalizeEmptyStrings(filters);
  const db = createDb(c.env.DB);
  const userService = new UserService(db);
  const logService = new AuditLogService(db);
  const users = await userService.list(1, 100);
  const result = await logService.list(normalizedFilters);

  return `
    <section class="space-y-6">
      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 class="text-xl font-semibold">Logs de Auditoria</h2>
        <form class="mt-4 grid gap-3 md:grid-cols-5" hx-get="/admin/partials/logs" hx-target="#admin-content" hx-swap="innerHTML">
          ${renderSelect('userId', 'Usuário', users.map((user) => ({ value: user.id, label: user.name })), normalizedFilters.userId)}
          ${renderInput('actionType', 'Tipo de Ação', 'text', normalizedFilters.actionType)}
          ${renderInput('dateFrom', 'Data Inicial', 'date', normalizedFilters.dateFrom)}
          ${renderInput('dateTo', 'Data Final', 'date', normalizedFilters.dateTo)}
          <div class="flex items-end">
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Filtrar</button>
          </div>
        </form>
      </div>

      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th class="px-3 py-2 font-medium">Data/Hora</th>
                <th class="px-3 py-2 font-medium">Usuário</th>
                <th class="px-3 py-2 font-medium">Ação</th>
                <th class="px-3 py-2 font-medium">Referência</th>
                <th class="px-3 py-2 font-medium">Detalhes</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${result.data.map((log) => `
                <tr>
                  <td class="px-3 py-3">${escapeHtml(log.timestamp)}</td>
                  <td class="px-3 py-3 font-medium">${escapeHtml(log.user?.name ?? log.userId)}</td>
                  <td class="px-3 py-3">${escapeHtml(log.actionType)}</td>
                  <td class="px-3 py-3">${escapeHtml(log.referenceType ?? 'n/d')} · ${escapeHtml(log.referenceId ?? 'n/d')}</td>
                  <td class="px-3 py-3">${escapeHtml(log.details ?? 'Sem detalhes')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${renderPagination('/admin/partials/logs', result.pagination, normalizedFilters)}
      </div>
    </section>
  `;
}

function renderUserSwitcher(
  users: Awaited<ReturnType<UserService['list']>>,
  actingAs: string
) {
  const current = users.find((u) => u.id === actingAs);
  const roleLabel: Record<string, string> = {
    student: 'Estudante',
    professor: 'Professor(a)',
    staff: 'Funcionário',
    maintenance: 'Manutenção',
  };

  return `
    <div id="user-switcher" class="flex items-center gap-2 text-sm">
      <span class="font-medium text-slate-700">Agindo como:</span>
      <form hx-post="/admin/actions/acting-as" hx-target="#user-switcher" hx-swap="outerHTML">
        <select
          name="userId"
          onchange="this.form.requestSubmit()"
          class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-slate-900 focus:outline-none"
        >
          ${users.map((u) => `
            <option value="${escapeAttribute(u.id)}" ${u.id === actingAs ? 'selected' : ''}>
              ${escapeHtml(u.name)} · ${escapeHtml(roleLabel[u.role] ?? u.role)}
            </option>
          `).join('')}
        </select>
      </form>
      ${current ? `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">${escapeHtml(current.registration ?? '—')}</span>` : ''}
    </div>
  `;
}

function renderDashboard(stats: Awaited<ReturnType<StatsService['getDashboardStats']>>) {
  return `
    <section class="space-y-6" x-data="dashboardStats()" x-init="stats = ${escapeAttribute(JSON.stringify(stats))}; loading = false;">
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${renderStatCard('Total de Espaços', 'stats.totalSpaces', 'Todos os espaços físicos registrados')}
        ${renderStatCard('Reservas Hoje', 'stats.activeReservationsToday', 'Reservas confirmadas para hoje')}
        ${renderStatCard('Bloqueios Ativos', 'stats.activeBlockings', 'Substituições ativas')}
        ${renderStatCard('Total de Usuários', 'stats.totalUsers', 'Usuários sincronizados a partir das reivindicações de autenticação')}
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Visão Geral</h2>
          <p class="mt-2 text-sm leading-6 text-slate-600">
            Este painel está otimizado para desenvolvimento local. O mesmo aplicativo Hono agora atende tanto à API quanto a uma interface administrativa exclusiva para funcionários, e o painel lê contagens resumidas de <code>/api/v1/stats</code>.
          </p>
        </div>
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Links Rápidos</h2>
          <div class="mt-4 grid gap-3">
            <a href="/admin/spaces" hx-get="/admin/partials/spaces" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/spaces" class="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Gerenciar espaços e inspecionar disponibilidade</a>
            <a href="/admin/reservations" hx-get="/admin/partials/reservations" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/reservations" class="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Revisar reservas e cancelar slots confirmados</a>
            <a href="/admin/blockings" hx-get="/admin/partials/blockings" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/blockings" class="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Criar e remover bloqueios</a>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderReservationRows(
  reservations: Awaited<ReturnType<ReservationService['listForAdmin']>>['data'],
  filters: Record<string, unknown>
) {
  const grouped = new Map<string, typeof reservations>();
  const singles: typeof reservations = [];

  for (const reservation of reservations) {
    if (reservation.recurrenceId) {
      const group = grouped.get(reservation.recurrenceId) ?? [];
      group.push(reservation);
      grouped.set(reservation.recurrenceId, group);
    } else {
      singles.push(reservation);
    }
  }

  const groupedRows = [...grouped.entries()].map(([recurrenceId, items]) => `
    <tr class="bg-slate-50">
      <td colspan="7" class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div class="space-y-1">
            <div>Série recorrente · ${escapeHtml(items[0].recurrence?.description ?? recurrenceId)}</div>
            <div class="normal-case tracking-normal text-slate-600">${escapeHtml(describeRecurringSeries(items))}</div>
          </div>
          ${items.some((item) => item.status === 'confirmed')
            ? `
              <form hx-patch="/admin/actions/reservations/series/${recurrenceId}/cancel" hx-target="#admin-content" hx-swap="innerHTML" hx-confirm="Cancelar todas as reservas confirmadas desta série? Esta ação não pode ser desfeita.">
                ${renderHiddenInputs(filters)}
                <button type="submit" class="rounded-lg border border-rose-200 px-3 py-1.5 text-rose-700 hover:bg-rose-50">Cancelar série</button>
              </form>
            `
            : '<span class="normal-case tracking-normal text-slate-400">Sem ações em lote</span>'}
        </div>
      </td>
    </tr>
    ${items.map((reservation) => renderReservationRow(reservation, filters)).join('')}
  `).join('');

  return `${groupedRows}${singles.map((reservation) => renderReservationRow(reservation, filters)).join('')}`;
}

function renderReservationRow(
  reservation: Awaited<ReturnType<ReservationService['listForAdmin']>>['data'][number],
  filters: Record<string, unknown>
) {
  return `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-3">${reservation.date}</td>
      <td class="px-3 py-3 tabular-nums">${reservation.startTime}–${reservation.endTime}</td>
      <td class="px-3 py-3 font-medium">${escapeHtml(reservation.space?.number ?? reservation.spaceId)}</td>
      <td class="px-3 py-3">${escapeHtml(reservation.user?.name ?? reservation.userId)}</td>
      <td class="px-3 py-3">${renderStatusPill(reservation.status)}</td>
      <td class="px-3 py-3">${reservation.recurrenceId ? 'Recorrente' : 'Simples'}</td>
      <td class="px-3 py-3">
        ${reservation.status === 'confirmed'
          ? `
            <form hx-patch="/admin/actions/reservations/${reservation.id}/cancel" hx-target="#admin-content" hx-swap="innerHTML" hx-confirm="Cancelar esta reserva de ${escapeAttribute(reservation.date)}? Esta ação não pode ser desfeita.">
              ${renderHiddenInputs(filters)}
              <button type="submit" class="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">Cancelar</button>
            </form>
          `
          : '<span class="text-slate-400 text-sm">—</span>'}
      </td>
    </tr>
  `;
}

function renderSpaceFields(space?: Record<string, unknown>) {
  const closedHours = normalizeClosedHours(stringValue(space?.closedFrom), stringValue(space?.closedTo));

  return `
    ${renderInput('name', 'Nome', 'text', stringValue(space?.name))}
    ${renderInput('number', 'Número', 'text', stringValue(space?.number))}
    ${renderSelect('type', 'Tipo', [
      { value: 'classroom', label: 'Sala de aula' },
      { value: 'study_room', label: 'Sala de estudo' },
      { value: 'meeting_room', label: 'Sala de reunião' },
      { value: 'hall', label: 'Auditório' },
      { value: 'other', label: 'Outros' },
    ], stringValue(space?.type))}
    ${renderInput('block', 'Bloco', 'text', stringValue(space?.block))}
    ${renderInput('campus', 'Campus', 'text', stringValue(space?.campus))}
    ${renderInput('department', 'Departamento', 'text', stringValue(space?.department))}
    ${renderInput('capacity', 'Capacidade', 'number', stringValue(space?.capacity))}
    ${renderInput('furniture', 'Mobiliário', 'text', stringValue(space?.furniture), false, 'sm:col-span-2')}
    ${renderInput('lighting', 'Iluminação', 'text', stringValue(space?.lighting))}
    ${renderInput('hvac', 'Controle de temperatura e umidade (HVAC)', 'text', stringValue(space?.hvac))}
    ${renderInput('multimedia', 'Multimídia', 'text', stringValue(space?.multimedia), false, 'sm:col-span-2')}
    ${renderSelect('closedFrom', 'Fechado a partir de', HOURLY_OPTIONS, closedHours.closedFrom || DEFAULT_CLOSED_FROM, true)}
    ${renderSelect('closedTo', 'Fechado até', HOURLY_BOUNDARY_OPTIONS, closedHours.closedTo || DEFAULT_CLOSED_TO, true)}
    <label class="flex items-center gap-2 text-sm sm:col-span-2">
      <input type="checkbox" name="reservable" ${space?.reservable !== false ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300" />
      <span class="font-medium text-slate-700">Disponível para reservas</span>
    </label>
  `;
}

function renderInput(
  name: string,
  label: string,
  type: string,
  value = '',
  compact = false,
  wrapperClass = '',
  placeholder = ''
) {
  const containerClass = compact ? '' : ` ${wrapperClass}`.trim();
  return `
    <label class="grid gap-1 text-sm ${containerClass}">
      <span class="font-medium text-slate-700">${label}</span>
      <input
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none ring-0 focus:border-slate-900"
        type="${type}"
        name="${name}"
        value="${escapeAttribute(value)}"
        placeholder="${escapeAttribute(placeholder)}"
      />
    </label>
  `;
}

function renderTextarea(
  name: string,
  label: string,
  value = '',
  required = false,
  placeholder = ''
) {
  return `
    <label class="grid gap-1 text-sm">
      <span class="font-medium text-slate-700">${label}</span>
      <textarea
        class="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none ring-0 focus:border-slate-900"
        name="${name}"
        placeholder="${escapeAttribute(placeholder)}"
        ${required ? 'required' : ''}
      >${escapeHtml(value)}</textarea>
    </label>
  `;
}

function renderSelect(
  name: string,
  label: string,
  options: Array<{ value: string; label: string }>,
  selectedValue = '',
  compact = false
) {
  return `
    <label class="grid gap-1 text-sm">
      <span class="font-medium text-slate-700">${label}</span>
      <select
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none ring-0 focus:border-slate-900"
        name="${name}"
      >
        ${compact ? '' : '<option value="">Todos</option>'}
        ${options.map((option) => `
          <option value="${escapeAttribute(option.value)}" ${option.value === selectedValue ? 'selected' : ''}>
            ${escapeHtml(option.label)}
          </option>
        `).join('')}
      </select>
    </label>
  `;
}

function renderPagination(basePath: string, pagination: { page: number; totalPages: number }, filters: Record<string, unknown>) {
  if (pagination.totalPages <= 1) return '';

  return `
    <div class="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 text-sm">
      <span class="text-slate-600">Página ${pagination.page} de ${pagination.totalPages}</span>
      <div class="flex gap-2">
        ${pagination.page > 1 ? `
          <button
            hx-get="${basePath}?${buildQuery({ ...filters, page: pagination.page - 1 })}"
            hx-target="#admin-content"
            hx-swap="innerHTML"
            class="rounded-lg border border-slate-300 px-3 py-2"
          >
            Anterior
          </button>
        ` : ''}
        ${pagination.page < pagination.totalPages ? `
          <button
            hx-get="${basePath}?${buildQuery({ ...filters, page: pagination.page + 1 })}"
            hx-target="#admin-content"
            hx-swap="innerHTML"
            class="rounded-lg border border-slate-300 px-3 py-2"
          >
            Próxima
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderHiddenInputs(values: Record<string, unknown>) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `<input type="hidden" name="${escapeAttribute(key)}" value="${escapeAttribute(String(value))}" />`)
    .join('');
}

function renderMessage(message?: string) {
  if (!message) return '';

  return `
    <div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      ${escapeHtml(message)}
    </div>
  `;
}

function renderValidationErrors(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return `
    <div class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <div class="font-medium">Validação falhou</div>
      <ul class="mt-2 list-disc pl-5">
        ${issues.map((issue) => `<li>${escapeHtml(issue.path.join('.') || 'form')}: ${escapeHtml(issue.message)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderStatusPill(status: string) {
  const classMap: Record<string, string> = {
    confirmed: 'bg-emerald-100 text-emerald-700',
    canceled: 'bg-slate-100 text-slate-600',
    overridden: 'bg-amber-100 text-amber-700',
    active: 'bg-rose-100 text-rose-700',
    removed: 'bg-slate-100 text-slate-600',
  };

  const labelMap: Record<string, string> = {
    confirmed: 'Confirmada',
    canceled: 'Cancelada',
    overridden: 'Sobrescrita',
    active: 'Ativo',
    removed: 'Removido',
  };

  return `<span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classMap[status] ?? 'bg-slate-100 text-slate-600'}">${escapeHtml(labelMap[status] ?? status)}</span>`;
}

function renderAvailabilityStatus(status: string) {
  const labels: Record<string, string> = {
    available: 'Disponível',
    blocked: 'Bloqueado',
    reserved: 'Reservado',
    closed: 'Fechado',
    not_reservable: 'Não reservável',
  };

  return escapeHtml(labels[status] ?? status);
}

function renderBlockingType(blockType: string) {
  const labels: Record<string, string> = {
    maintenance: 'Manutenção',
    administrative: 'Administrativo',
  };

  return labels[blockType] ?? blockType;
}

function describeRecurringSeries(
  items: Awaited<ReturnType<ReservationService['listForAdmin']>>['data']
) {
  const sorted = [...items].sort((left, right) => left.date.localeCompare(right.date));
  const first = sorted[0];
  if (!first) return '';

  const confirmedCount = sorted.filter((item) => item.status === 'confirmed').length;
  const totalCount = sorted.length;
  const weekday = formatWeekday(first.date);
  const space = first.space?.number ?? first.spaceId;
  const nextDate = sorted.find((item) => item.status === 'confirmed')?.date;
  const nextLabel = nextDate ? `Próxima: ${nextDate}` : 'Sem próximas reservas ativas';

  return `${weekday} · ${first.startTime}-${first.endTime} · Espaço ${space} · ${confirmedCount}/${totalCount} ativas · ${nextLabel}`;
}

function formatWeekday(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const labels = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  return labels[weekday] ?? date;
}

function renderRoleBadge(role: string) {
  const classMap: Record<string, string> = {
    student: 'bg-sky-100 text-sky-700',
    professor: 'bg-violet-100 text-violet-700',
    staff: 'bg-emerald-100 text-emerald-700',
    maintenance: 'bg-amber-100 text-amber-700',
  };

  const labelMap: Record<string, string> = {
    student: 'Estudante',
    professor: 'Professor(a)',
    staff: 'Funcionário',
    maintenance: 'Manutenção',
  };

  return `<span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classMap[role] ?? 'bg-slate-100 text-slate-700'}">${escapeHtml(labelMap[role] ?? role)}</span>`;
}

function renderStatCard(title: string, expression: string, detail: string) {
  return `
    <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div class="text-sm font-medium uppercase tracking-wide text-slate-500">${title}</div>
      <div class="mt-3 text-4xl font-semibold tracking-tight" x-text="${expression}"></div>
      <div class="mt-2 text-sm text-slate-600">${detail}</div>
    </div>
  `;
}

function renderEmptyState(message: string) {
  return `
    <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
      ${escapeHtml(message)}
    </div>
  `;
}
async function formDataToObject(c: AdminContext) {
  const formData = await c.req.formData();
  return Object.fromEntries(formData.entries());
}

function parseSpaceForm(values: Record<string, unknown>) {
  return {
    name: stringValue(values.name),
    number: stringValue(values.number),
    type: stringValue(values.type),
    block: stringValue(values.block),
    campus: stringValue(values.campus),
    department: stringValue(values.department),
    capacity: Number(values.capacity),
    furniture: blankToUndefined(values.furniture),
    lighting: blankToUndefined(values.lighting),
    hvac: blankToUndefined(values.hvac),
    multimedia: blankToUndefined(values.multimedia),
    reservable: values.reservable === 'on',
    closedFrom: stringValue(values.closedFrom) || DEFAULT_CLOSED_FROM,
    closedTo: stringValue(values.closedTo) || DEFAULT_CLOSED_TO,
  };
}

function normalizeEmptyStrings<T extends Record<string, unknown>>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === '' ? undefined : value])
  ) as T;
}

function buildQuery(values: Record<string, unknown>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }

  return params.toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

function blankToUndefined(value: unknown) {
  const normalized = stringValue(value);
  return normalized === '' ? undefined : normalized;
}

function stringValue(value: unknown) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const HOURLY_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${hour.toString().padStart(2, '0')}:00`;
  return { value, label: value };
});

const HOURLY_BOUNDARY_OPTIONS = [...HOURLY_OPTIONS, { value: '24:00', label: '24:00' }];
