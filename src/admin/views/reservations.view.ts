import type { z } from 'zod';
import { createDb } from '@/db/client';
import { ReservationService } from '@/services/reservation.service';
import { SpaceService } from '@/services/space.service';
import { UserService } from '@/services/user.service';
import type { AdminContext } from '../context';
import { reservationFilterSchema } from '../filters';
import {
  escapeHtml,
  normalizeEmptyStrings,
  renderHiddenInputs,
  renderInput,
  renderMessage,
  renderPagination,
  renderSelect,
  renderStatusPill,
} from '../ui';

export async function renderReservationsView(
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
            ${reservations.data.length === 0
              ? `<tbody><tr><td colspan="7" class="px-3 py-6 text-center text-slate-400">Nenhuma reserva encontrada com os filtros atuais.</td></tr></tbody>`
              : renderReservationRows(reservations.data, normalizedFilters)}
          </table>
        </div>
        ${renderPagination('/admin/partials/reservations', reservations.pagination, normalizedFilters)}
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
    <tbody x-data="{ open: true }">
      <tr class="bg-slate-50 cursor-pointer select-none" @click="open = !open">
        <td colspan="7" class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div class="flex items-center gap-2">
              <svg :class="open ? 'rotate-90' : 'rotate-0'" class="h-3.5 w-3.5 shrink-0 transition-transform duration-150 text-slate-400" style="width:14px;height:14px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
              <div class="space-y-1">
                <div>Série recorrente · ${escapeHtml(items[0].recurrence?.description ?? recurrenceId)}</div>
                <div class="normal-case tracking-normal text-slate-600">${escapeHtml(describeRecurringSeries(items))}</div>
              </div>
            </div>
            <div @click.stop>
              ${items.some((item) => item.status === 'confirmed')
                ? `
                  <form hx-patch="/admin/actions/reservations/series/${recurrenceId}/cancel" hx-target="#admin-content" hx-swap="innerHTML" class="flex items-center gap-2">
                    ${renderHiddenInputs(filters)}
                    <input
                      type="text"
                      name="cancelReason"
                      placeholder="Motivo do cancelamento (opcional)"
                      class="rounded-lg border border-slate-300 px-2 py-1.5 text-xs shadow-sm outline-none focus:border-slate-900 w-56"
                    />
                    <button type="submit" class="rounded-lg border border-rose-200 px-3 py-1.5 text-rose-700 hover:bg-rose-50 whitespace-nowrap">Cancelar série</button>
                  </form>
                `
                : '<span class="normal-case tracking-normal text-slate-400">Sem ações em lote</span>'}
            </div>
          </div>
        </td>
      </tr>
      ${items.map((reservation) => `<tr x-show="open" class="hover:bg-slate-50">${renderReservationRow(reservation, filters)}</tr>`).join('')}
    </tbody>
  `).join('');

  const singlesRows = singles.length === 0 ? '' : `
    <tbody class="divide-y divide-slate-100">
      ${singles.map((reservation) => `<tr class="hover:bg-slate-50">${renderReservationRow(reservation, filters)}</tr>`).join('')}
    </tbody>
  `;
  return `${groupedRows}${singlesRows}`;
}

function renderReservationRow(
  reservation: Awaited<ReturnType<ReservationService['listForAdmin']>>['data'][number],
  filters: Record<string, unknown>
) {
  return `
      <td class="px-3 py-3">${reservation.date}</td>
      <td class="px-3 py-3 tabular-nums">${reservation.startTime}–${reservation.endTime}</td>
      <td class="px-3 py-3 font-medium">${escapeHtml(reservation.space?.number ?? reservation.spaceId)}</td>
      <td class="px-3 py-3">${escapeHtml(reservation.user?.name ?? reservation.userId)}</td>
      <td class="px-3 py-3">
        ${renderStatusPill(reservation.status)}
        ${reservation.cancelReason ? `<div class="mt-1 text-xs text-slate-500">Motivo: ${escapeHtml(reservation.cancelReason)}</div>` : ''}
      </td>
      <td class="px-3 py-3">${reservation.recurrenceId ? 'Recorrente' : 'Simples'}</td>
      <td class="px-3 py-3">
        ${reservation.status === 'confirmed'
          ? `
            <form hx-patch="/admin/actions/reservations/${reservation.id}/cancel" hx-target="#admin-content" hx-swap="innerHTML" class="flex flex-col gap-1.5">
              ${renderHiddenInputs(filters)}
              <input
                type="text"
                name="cancelReason"
                placeholder="Motivo (opcional)"
                class="rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-900 w-36"
              />
              <button type="submit" class="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">Cancelar</button>
            </form>
          `
          : '<span class="text-slate-400 text-sm">—</span>'}
      </td>
  `;
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
