import { createDb } from '@/db/client';
import { UserService } from '@/services/user.service';
import { AuditLogService } from '@/services/audit-log.service';
import type { AdminContext } from '../context';
import { logFilterSchema } from '../filters';
import { escapeHtml, normalizeEmptyStrings, renderInput, renderPagination, renderSelect } from '../ui';

export async function renderLogsView(c: AdminContext) {
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
