import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@/types/env';
import { createDb } from '@/db/client';
import { SpaceService } from '@/services/space.service';
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

const reservationFilterSchema = paginationSchema.extend({
  spaceId: z.string().uuid().optional().or(z.literal('')),
  userId: z.string().uuid().optional().or(z.literal('')),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const blockingFilterSchema = paginationSchema.extend({
  spaceId: z.string().uuid().optional().or(z.literal('')),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const logFilterSchema = paginationSchema.extend({
  userId: z.string().uuid().optional().or(z.literal('')),
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
  const space = await spaceService.getById(c.req.param('id'));
  const availability = await spaceService.getAvailability(space.id, today());

  return c.html(renderSpaceDetail(space, availability));
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

adminRoutes.post('/actions/spaces', async (c) => {
  const body = await formDataToObject(c);
  const parsed = createSpaceSchema.safeParse(parseSpaceForm(body));
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new SpaceService(db);
  const space = await service.create(c.get('user').sub, parsed.data);
  return c.html(await renderSpacesView(c, { message: `Space ${space.number} created`, selectedSpaceId: space.id }));
});

adminRoutes.put('/actions/spaces/:id', async (c) => {
  const body = await formDataToObject(c);
  const parsed = updateSpaceSchema.safeParse(parseSpaceForm(body));
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new SpaceService(db);
  const space = await service.update(c.req.param('id'), c.get('user').sub, parsed.data);
  return c.html(await renderSpacesView(c, { message: `Space ${space.number} updated`, selectedSpaceId: space.id }));
});

adminRoutes.patch('/actions/reservations/:id/cancel', async (c) => {
  const filters = reservationFilterSchema.parse(await formDataToObject(c));
  const db = createDb(c.env.DB);
  const service = new ReservationService(db);
  await service.cancel(c.req.param('id'), c.get('user').sub, 'staff');
  return c.html(await renderReservationsView(c, { ...filters, message: 'Reservation canceled' }));
});

adminRoutes.post('/actions/blockings', async (c) => {
  const body = await formDataToObject(c);
  const parsed = createBlockingSchema.safeParse(body);
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new BlockingService(db);
  await service.create(c.get('user').sub, parsed.data);
  return c.html(await renderBlockingsView(c, { message: 'Blocking created' }));
});

adminRoutes.patch('/actions/blockings/:id/remove', async (c) => {
  const filters = blockingFilterSchema.parse(await formDataToObject(c));
  const db = createDb(c.env.DB);
  const service = new BlockingService(db);
  await service.remove(c.req.param('id'), c.get('user').sub);
  return c.html(await renderBlockingsView(c, { ...filters, message: 'Blocking removed' }));
});

adminRoutes.patch('/actions/equipment/:id/status', async (c) => {
  const body = await formDataToObject(c);
  const parsed = equipmentFormSchema.safeParse(body);
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new EquipmentService(db);
  await service.updateStatus(c.req.param('id'), c.get('user').sub, {
    status: parsed.data.status,
    notes: parsed.data.notes,
  });

  return c.html(await renderEquipmentView(c, { message: 'Equipment status updated' }));
});

adminRoutes.post('/actions/equipment', async (c) => {
  const body = await formDataToObject(c);
  const parsed = createEquipmentFormSchema.safeParse(body);
  if (!parsed.success) return c.html(renderValidationErrors(parsed.error.issues));

  const db = createDb(c.env.DB);
  const service = new EquipmentService(db);
  await service.create(c.get('user').sub, parsed.data);

  return c.html(await renderEquipmentView(c, { message: 'Equipment created' }));
});

async function renderSpacesView(
  c: AdminContext,
  options?: { message?: string; selectedSpaceId?: string }
) {
  const db = createDb(c.env.DB);
  const spaceService = new SpaceService(db);
  const spaces = await spaceService.list({ page: 1, limit: 100 });
  const selectedSpaceId = options?.selectedSpaceId ?? c.req.query('selectedSpaceId');

  let detailHtml = renderEmptyState('Select a space to inspect equipment, availability, and edit its metadata.');
  if (selectedSpaceId) {
    const space = await spaceService.getById(selectedSpaceId);
    const availability = await spaceService.getAvailability(space.id, today());
    detailHtml = renderSpaceDetail(space, availability);
  }

  return `
    <section class="space-y-6">
      ${renderMessage(options?.message)}
      <div class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div class="mb-4 flex items-center justify-between">
            <div>
              <h2 class="text-xl font-semibold">Spaces</h2>
              <p class="text-sm text-slate-600">Core inventory of reservable spaces.</p>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">${spaces.length} spaces</span>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr class="text-left text-slate-500">
                  <th class="px-3 py-2 font-medium">Number</th>
                  <th class="px-3 py-2 font-medium">Type</th>
                  <th class="px-3 py-2 font-medium">Block</th>
                  <th class="px-3 py-2 font-medium">Campus</th>
                  <th class="px-3 py-2 font-medium">Capacity</th>
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
                    <td class="px-3 py-3 font-medium">${escapeHtml(space.number)}</td>
                    <td class="px-3 py-3">${escapeHtml(space.type)}</td>
                    <td class="px-3 py-3">${escapeHtml(space.block)}</td>
                    <td class="px-3 py-3">${escapeHtml(space.campus)}</td>
                    <td class="px-3 py-3">${space.capacity}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="space-y-6">
          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 class="text-xl font-semibold">Create Space</h2>
            <p class="mt-1 text-sm text-slate-600">Use the same service layer as the public API.</p>
            <form class="mt-4 grid gap-3 sm:grid-cols-2" hx-post="/admin/actions/spaces" hx-target="#admin-content" hx-swap="innerHTML">
              ${renderSpaceFields()}
              <div class="sm:col-span-2">
                <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Create</button>
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
  availability: Awaited<ReturnType<SpaceService['getAvailability']>>
) {
  const closedHours = normalizeClosedHours(space.closedFrom, space.closedTo);

  return `
    <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-xl font-semibold">${escapeHtml(space.number)}</h3>
          <p class="text-sm text-slate-600">${escapeHtml(space.department)} · ${escapeHtml(space.campus)} campus</p>
        </div>
        <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">${escapeHtml(space.type)}</span>
      </div>

      <dl class="mt-4 grid gap-3 text-sm text-slate-700">
        <div><strong>Block:</strong> ${escapeHtml(space.block)}</div>
        <div><strong>Capacity:</strong> ${space.capacity}</div>
        <div><strong>Closed Hours:</strong> ${escapeHtml(closedHours.closedFrom)}-${escapeHtml(closedHours.closedTo)}</div>
        <div><strong>Furniture:</strong> ${escapeHtml(space.furniture ?? 'Not informed')}</div>
        <div><strong>Lighting:</strong> ${escapeHtml(space.lighting ?? 'Not informed')}</div>
        <div><strong>HVAC:</strong> ${escapeHtml(space.hvac ?? 'Not informed')}</div>
        <div><strong>Multimedia:</strong> ${escapeHtml(space.multimedia ?? 'Not informed')}</div>
      </dl>

      <div class="mt-6">
        <h4 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Today's Availability</h4>
        <div class="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          ${availability.map((slot) => `
            <div class="rounded-xl border border-slate-200 px-3 py-3">
              <div class="text-sm font-medium">${slot.startTime}-${slot.endTime}</div>
              <div class="mt-1 text-sm ${slot.status === 'available' ? 'text-emerald-600' : slot.status === 'blocked' ? 'text-rose-600' : slot.status === 'closed' ? 'text-slate-500' : 'text-amber-600'}">
                ${slot.status}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="mt-6">
        <h4 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Equipment</h4>
        <ul class="mt-3 space-y-2 text-sm text-slate-700">
          ${space.equipment.length > 0
            ? space.equipment.map((item) => `
              <li class="rounded-xl bg-slate-50 px-3 py-3">
                <div class="font-medium">${escapeHtml(item.name)}</div>
                <div class="text-slate-500">${escapeHtml(item.type)} · ${escapeHtml(item.status)}</div>
              </li>
            `).join('')
            : '<li class="rounded-xl bg-slate-50 px-3 py-3 text-slate-500">No equipment registered.</li>'}
        </ul>
      </div>

      <div class="mt-6 border-t border-slate-200 pt-6">
        <h4 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Edit Space</h4>
        <form class="mt-4 grid gap-3 sm:grid-cols-2" hx-put="/admin/actions/spaces/${space.id}" hx-target="#admin-content" hx-swap="innerHTML">
          ${renderSpaceFields(space)}
          <input type="hidden" name="selectedSpaceId" value="${space.id}" />
          <div class="sm:col-span-2">
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Save Changes</button>
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
          <h2 class="text-xl font-semibold">Reservations</h2>
          <p class="text-sm text-slate-600">Filter by date range, space, user, or status. Recurring series are grouped visually.</p>
        </div>
        <form class="grid gap-3 md:grid-cols-5" hx-get="/admin/partials/reservations" hx-target="#admin-content" hx-swap="innerHTML">
          ${renderSelect('spaceId', 'Space', spaces.map((space) => ({ value: space.id, label: space.number })), normalizedFilters.spaceId)}
          ${renderSelect('userId', 'User', users.map((user) => ({ value: user.id, label: user.name })), normalizedFilters.userId)}
          ${renderSelect('status', 'Status', [
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'canceled', label: 'Canceled' },
            { value: 'overridden', label: 'Overridden' },
          ], normalizedFilters.status)}
          ${renderInput('dateFrom', 'Date From', 'date', normalizedFilters.dateFrom)}
          ${renderInput('dateTo', 'Date To', 'date', normalizedFilters.dateTo)}
          <div class="md:col-span-5">
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Apply Filters</button>
          </div>
        </form>
      </div>

      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th class="px-3 py-2 font-medium">Date</th>
                <th class="px-3 py-2 font-medium">Time</th>
                <th class="px-3 py-2 font-medium">Space</th>
                <th class="px-3 py-2 font-medium">User</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Series</th>
                <th class="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${renderReservationRows(reservations.data, normalizedFilters)}
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
          <h2 class="text-xl font-semibold">Create Blocking</h2>
          <p class="mt-1 text-sm text-slate-600">Used for administrative or maintenance overrides.</p>
          <form class="mt-4 grid gap-3" hx-post="/admin/actions/blockings" hx-target="#admin-content" hx-swap="innerHTML">
            ${renderSelect('spaceId', 'Space', spaces.map((space) => ({ value: space.id, label: space.number })))}
            ${renderInput('date', 'Date', 'date', today())}
            ${renderSelect('startTime', 'Start Time', HOURLY_OPTIONS, '08:00', true)}
            ${renderSelect('endTime', 'End Time', HOURLY_BOUNDARY_OPTIONS, '09:00', true)}
            ${renderSelect('blockType', 'Block Type', [
              { value: 'maintenance', label: 'Maintenance' },
              { value: 'administrative', label: 'Administrative' },
            ])}
            ${renderTextarea('reason', 'Reason')}
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Create Blocking</button>
          </form>
        </div>

        <div class="space-y-6">
          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 class="text-xl font-semibold">Active Blockings</h2>
            <form class="mt-4 grid gap-3 md:grid-cols-4" hx-get="/admin/partials/blockings" hx-target="#admin-content" hx-swap="innerHTML">
              ${renderSelect('spaceId', 'Space', spaces.map((space) => ({ value: space.id, label: space.number })), normalizedFilters.spaceId)}
              ${renderInput('dateFrom', 'Date From', 'date', normalizedFilters.dateFrom)}
              ${renderInput('dateTo', 'Date To', 'date', normalizedFilters.dateTo)}
              <div class="flex items-end">
                <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Filter</button>
              </div>
            </form>
          </div>

          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr class="text-left text-slate-500">
                    <th class="px-3 py-2 font-medium">Date</th>
                    <th class="px-3 py-2 font-medium">Slot</th>
                    <th class="px-3 py-2 font-medium">Space</th>
                    <th class="px-3 py-2 font-medium">Type</th>
                    <th class="px-3 py-2 font-medium">Reason</th>
                    <th class="px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${result.data.map((blocking) => `
                    <tr>
                      <td class="px-3 py-3">${blocking.date}</td>
                      <td class="px-3 py-3">${blocking.startTime}-${blocking.endTime}</td>
                      <td class="px-3 py-3 font-medium">${escapeHtml(blocking.space?.number ?? blocking.spaceId)}</td>
                      <td class="px-3 py-3 capitalize">${escapeHtml(blocking.blockType)}</td>
                      <td class="px-3 py-3">${escapeHtml(blocking.reason)}</td>
                      <td class="px-3 py-3">
                        <form hx-patch="/admin/actions/blockings/${blocking.id}/remove" hx-target="#admin-content" hx-swap="innerHTML">
                          ${renderHiddenInputs(normalizedFilters)}
                          <button class="rounded-lg border border-rose-200 px-3 py-1.5 text-rose-700">Remove</button>
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
          <h2 class="text-xl font-semibold">Create Equipment</h2>
          <p class="mt-1 text-sm text-slate-600">Register equipment with its official university asset ID.</p>
          <form class="mt-4 grid gap-3" hx-post="/admin/actions/equipment" hx-target="#admin-content" hx-swap="innerHTML">
            ${renderSelect('spaceId', 'Space', spaces.map((space) => ({ value: space.id, label: `${space.number} · ${space.department}` })))}
            ${renderInput('assetId', 'University Equipment ID', 'text', '', false, '', 'e.g. 2020002658')}
            ${renderInput('name', 'Equipment Name', 'text')}
            ${renderInput('type', 'Type', 'text', '', false, '', 'projector, hvac, display, laptop')}
            ${renderSelect('status', 'Status', [
              { value: 'working', label: 'Working' },
              { value: 'broken', label: 'Broken' },
              { value: 'under_repair', label: 'Under Repair' },
              { value: 'replacement_scheduled', label: 'Replacement Scheduled' },
            ], 'working', true)}
            ${renderInput('notes', 'Notes', 'text')}
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Create Equipment</button>
          </form>
        </div>

        <div class="space-y-6">
          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 class="text-xl font-semibold">Equipment</h2>
            <p class="mt-1 text-sm text-slate-600">Grouped by space. Update statuses inline.</p>
          </div>

          ${groups.map((space) => `
            <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div class="mb-4 flex items-center justify-between">
                <div>
                  <h3 class="text-lg font-semibold">${escapeHtml(space.number)}</h3>
                  <p class="text-sm text-slate-600">${escapeHtml(space.type)} · ${escapeHtml(space.department)}</p>
                </div>
                <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">${space.equipment.length} items</span>
              </div>
              <div class="space-y-3">
                ${space.equipment.length > 0
                  ? space.equipment.map((item) => `
                    <form class="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1.1fr_0.9fr_0.8fr_1fr_auto]" hx-patch="/admin/actions/equipment/${item.id}/status" hx-target="#admin-content" hx-swap="innerHTML">
                      <div>
                        <div class="font-medium">${escapeHtml(item.name)}</div>
                        <div class="text-sm text-slate-500">${escapeHtml(item.type)}</div>
                      </div>
                      <div>
                        <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">Asset ID</div>
                        <div class="mt-1 font-mono text-sm text-slate-700">${escapeHtml(item.assetId)}</div>
                      </div>
                      ${renderSelect('status', 'Status', [
                        { value: 'working', label: 'Working' },
                        { value: 'broken', label: 'Broken' },
                        { value: 'under_repair', label: 'Under Repair' },
                        { value: 'replacement_scheduled', label: 'Replacement Scheduled' },
                      ], item.status, true)}
                      ${renderInput('notes', 'Notes', 'text', item.notes ?? '', true)}
                      <div class="flex items-end">
                        <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Save</button>
                      </div>
                    </form>
                  `).join('')
                  : '<div class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No equipment registered for this space.</div>'}
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
        <h2 class="text-xl font-semibold">Users</h2>
        <p class="mt-1 text-sm text-slate-600">Read-only view. User records are synced from JWT claims.</p>
      </div>
      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th class="px-3 py-2 font-medium">Name</th>
                <th class="px-3 py-2 font-medium">Registration</th>
                <th class="px-3 py-2 font-medium">Email</th>
                <th class="px-3 py-2 font-medium">Department</th>
                <th class="px-3 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${result.data.map((user) => `
                <tr>
                  <td class="px-3 py-3 font-medium">${escapeHtml(user.name)}</td>
                  <td class="px-3 py-3">${escapeHtml(user.registration)}</td>
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
        <h2 class="text-xl font-semibold">Audit Logs</h2>
        <form class="mt-4 grid gap-3 md:grid-cols-5" hx-get="/admin/partials/logs" hx-target="#admin-content" hx-swap="innerHTML">
          ${renderSelect('userId', 'User', users.map((user) => ({ value: user.id, label: user.name })), normalizedFilters.userId)}
          ${renderInput('actionType', 'Action Type', 'text', normalizedFilters.actionType)}
          ${renderInput('dateFrom', 'Date From', 'date', normalizedFilters.dateFrom)}
          ${renderInput('dateTo', 'Date To', 'date', normalizedFilters.dateTo)}
          <div class="flex items-end">
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Filter</button>
          </div>
        </form>
      </div>

      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr class="text-left text-slate-500">
                <th class="px-3 py-2 font-medium">Timestamp</th>
                <th class="px-3 py-2 font-medium">User</th>
                <th class="px-3 py-2 font-medium">Action</th>
                <th class="px-3 py-2 font-medium">Reference</th>
                <th class="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${result.data.map((log) => `
                <tr>
                  <td class="px-3 py-3">${escapeHtml(log.timestamp)}</td>
                  <td class="px-3 py-3 font-medium">${escapeHtml(log.user?.name ?? log.userId)}</td>
                  <td class="px-3 py-3">${escapeHtml(log.actionType)}</td>
                  <td class="px-3 py-3">${escapeHtml(log.referenceType ?? 'n/a')} · ${escapeHtml(log.referenceId ?? 'n/a')}</td>
                  <td class="px-3 py-3">${escapeHtml(log.details ?? 'No details')}</td>
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

function renderDashboard(stats: Awaited<ReturnType<StatsService['getDashboardStats']>>) {
  return `
    <section class="space-y-6" x-data="dashboardStats()" x-init="stats = ${escapeAttribute(JSON.stringify(stats))}; loading = false;">
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${renderStatCard('Total Spaces', 'stats.totalSpaces', 'All registered physical spaces')}
        ${renderStatCard('Reservations Today', 'stats.activeReservationsToday', 'Confirmed reservations for today')}
        ${renderStatCard('Active Blockings', 'stats.activeBlockings', 'Currently active overrides')}
        ${renderStatCard('Total Users', 'stats.totalUsers', 'Users synced from auth claims')}
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Overview</h2>
          <p class="mt-2 text-sm leading-6 text-slate-600">
            This panel is optimized for local development. The same Hono app now serves both the API and a staff-only admin surface, and the dashboard reads summary counts from <code>/api/v1/stats</code>.
          </p>
        </div>
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Quick Links</h2>
          <div class="mt-4 grid gap-3">
            <a href="/admin/spaces" hx-get="/admin/partials/spaces" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/spaces" class="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Manage spaces and inspect availability</a>
            <a href="/admin/reservations" hx-get="/admin/partials/reservations" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/reservations" class="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Review reservations and cancel confirmed slots</a>
            <a href="/admin/blockings" hx-get="/admin/partials/blockings" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/blockings" class="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Create and remove blockings</a>
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
        Recurring series · ${escapeHtml(items[0].recurrence?.description ?? recurrenceId)}
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
    <tr>
      <td class="px-3 py-3">${reservation.date}</td>
      <td class="px-3 py-3">${reservation.startTime}-${reservation.endTime}</td>
      <td class="px-3 py-3 font-medium">${escapeHtml(reservation.space?.number ?? reservation.spaceId)}</td>
      <td class="px-3 py-3">${escapeHtml(reservation.user?.name ?? reservation.userId)}</td>
      <td class="px-3 py-3">${renderStatusPill(reservation.status)}</td>
      <td class="px-3 py-3">${reservation.recurrenceId ? 'Recurring' : 'Single'}</td>
      <td class="px-3 py-3">
        ${reservation.status === 'confirmed'
          ? `
            <form hx-patch="/admin/actions/reservations/${reservation.id}/cancel" hx-target="#admin-content" hx-swap="innerHTML">
              ${renderHiddenInputs(filters)}
              <button class="rounded-lg border border-rose-200 px-3 py-1.5 text-rose-700">Cancel</button>
            </form>
          `
          : '<span class="text-slate-400">No action</span>'}
      </td>
    </tr>
  `;
}

function renderSpaceFields(space?: Record<string, unknown>) {
  const closedHours = normalizeClosedHours(stringValue(space?.closedFrom), stringValue(space?.closedTo));

  return `
    ${renderInput('number', 'Number', 'text', stringValue(space?.number))}
    ${renderSelect('type', 'Type', [
      { value: 'classroom', label: 'Classroom' },
      { value: 'study_room', label: 'Study Room' },
      { value: 'meeting_room', label: 'Meeting Room' },
      { value: 'hall', label: 'Hall' },
    ], stringValue(space?.type))}
    ${renderInput('block', 'Block', 'text', stringValue(space?.block))}
    ${renderInput('campus', 'Campus', 'text', stringValue(space?.campus))}
    ${renderInput('department', 'Department', 'text', stringValue(space?.department))}
    ${renderInput('capacity', 'Capacity', 'number', stringValue(space?.capacity))}
    ${renderInput('furniture', 'Furniture', 'text', stringValue(space?.furniture), false, 'sm:col-span-2')}
    ${renderInput('lighting', 'Lighting', 'text', stringValue(space?.lighting))}
    ${renderInput('hvac', 'HVAC', 'text', stringValue(space?.hvac))}
    ${renderInput('multimedia', 'Multimedia', 'text', stringValue(space?.multimedia), false, 'sm:col-span-2')}
    ${renderSelect('closedFrom', 'Closed From', HOURLY_OPTIONS, closedHours.closedFrom || DEFAULT_CLOSED_FROM, true)}
    ${renderSelect('closedTo', 'Closed To', HOURLY_BOUNDARY_OPTIONS, closedHours.closedTo || DEFAULT_CLOSED_TO, true)}
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

function renderTextarea(name: string, label: string, value = '') {
  return `
    <label class="grid gap-1 text-sm">
      <span class="font-medium text-slate-700">${label}</span>
      <textarea
        class="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none ring-0 focus:border-slate-900"
        name="${name}"
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
        ${compact ? '' : '<option value="">All</option>'}
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
      <span class="text-slate-600">Page ${pagination.page} of ${pagination.totalPages}</span>
      <div class="flex gap-2">
        ${pagination.page > 1 ? `
          <button
            hx-get="${basePath}?${buildQuery({ ...filters, page: pagination.page - 1 })}"
            hx-target="#admin-content"
            hx-swap="innerHTML"
            class="rounded-lg border border-slate-300 px-3 py-2"
          >
            Previous
          </button>
        ` : ''}
        ${pagination.page < pagination.totalPages ? `
          <button
            hx-get="${basePath}?${buildQuery({ ...filters, page: pagination.page + 1 })}"
            hx-target="#admin-content"
            hx-swap="innerHTML"
            class="rounded-lg border border-slate-300 px-3 py-2"
          >
            Next
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
      <div class="font-medium">Validation failed</div>
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

  return `<span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classMap[status] ?? 'bg-slate-100 text-slate-600'}">${escapeHtml(status)}</span>`;
}

function renderRoleBadge(role: string) {
  const classMap: Record<string, string> = {
    student: 'bg-sky-100 text-sky-700',
    professor: 'bg-violet-100 text-violet-700',
    staff: 'bg-emerald-100 text-emerald-700',
    maintenance: 'bg-amber-100 text-amber-700',
  };

  return `<span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classMap[role] ?? 'bg-slate-100 text-slate-700'}">${escapeHtml(role)}</span>`;
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
