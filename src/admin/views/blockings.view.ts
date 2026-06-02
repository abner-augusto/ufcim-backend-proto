import type { z } from 'zod';
import { createDb } from '@/db/client';
import { BlockingService } from '@/services/blocking.service';
import { SpaceService } from '@/services/space.service';
import type { AdminContext } from '../context';
import { blockingFilterSchema } from '../filters';
import {
  HOURLY_BOUNDARY_OPTIONS,
  HOURLY_OPTIONS,
  escapeAttribute,
  escapeHtml,
  normalizeEmptyStrings,
  renderHiddenInputs,
  renderInput,
  renderMessage,
  renderPagination,
  renderSelect,
  renderTextarea,
  today,
} from '../ui';

export async function renderBlockingsView(
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
                    <th class="px-3 py-2 font-medium">Emitido por</th>
                    <th class="px-3 py-2 font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${result.data.length === 0
                    ? `<tr><td colspan="7" class="px-3 py-6 text-center text-slate-400">Nenhum bloqueio ativo encontrado.</td></tr>`
                    : result.data.map((blocking) => `
                      <tr class="hover:bg-slate-50">
                        <td class="px-3 py-3">${blocking.date}</td>
                        <td class="px-3 py-3 tabular-nums">${blocking.startTime}–${blocking.endTime}</td>
                        <td class="px-3 py-3 font-medium">${escapeHtml(blocking.space?.number ?? blocking.spaceId)}</td>
                        <td class="px-3 py-3">${escapeHtml(renderBlockingType(blocking.blockType))}</td>
                        <td class="px-3 py-3 max-w-xs truncate" title="${escapeAttribute(blocking.reason)}">${escapeHtml(blocking.reason)}</td>
                        <td class="px-3 py-3 text-slate-600" title="${escapeAttribute(blocking.creator?.email ?? '')}">${escapeHtml(blocking.creator?.name ?? '—')}</td>
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

function renderBlockingType(blockType: string) {
  const labels: Record<string, string> = {
    maintenance: 'Manutenção',
    administrative: 'Administrativo',
  };

  return labels[blockType] ?? blockType;
}
