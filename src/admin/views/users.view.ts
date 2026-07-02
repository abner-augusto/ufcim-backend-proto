import { createDb } from '@/db/client';
import { UserService } from '@/services/user.service';
import { paginationSchema } from '@/validators/common.schema';
import { ROLE_LABELS_TITLE } from '@/lib/role-labels';
import { getActingUserId, type AdminContext } from '../context';
import { escapeAttribute, escapeHtml, renderMessage, renderPagination, renderRoleBadge } from '../ui';

export async function renderUsersView(
  c: AdminContext,
  options?: { message?: string; highlightUrl?: string; highlightUserId?: string }
) {
  const rawQuery = c.req.query();
  const filters = paginationSchema.parse(rawQuery);
  const includeDeleted = rawQuery.includeDeleted === 'true';
  const db = createDb(c.env.DB);
  const userService = new UserService(db);
  const [result, actingUser] = await Promise.all([
    userService.listForAdmin(filters.page, filters.limit, includeDeleted),
    userService.getById(getActingUserId(c)),
  ]);
  const actingIsMaster = actingUser.isMasterAdmin;

  const resetCallout = options?.highlightUrl && options?.highlightUserId
    ? `
      <div class="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <p class="text-sm font-semibold uppercase tracking-wide text-emerald-700">Link de redefinição de senha — copie e envie</p>
            <p class="mt-2 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-slate-800 ring-1 ring-emerald-200">${escapeHtml(options.highlightUrl)}</p>
            <p class="mt-2 text-xs text-emerald-700">Este link aparece apenas uma vez. Após sair desta tela, gere um novo via "Resetar senha".</p>
          </div>
          <button
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            onclick="navigator.clipboard.writeText('${escapeAttribute(options.highlightUrl)}'); this.textContent='Copiado ✓'; setTimeout(() => this.textContent='Copiar', 2000)"
          >Copiar</button>
        </div>
      </div>
    `
    : '';

  return `
    <section class="space-y-6">
      ${renderMessage(options?.message)}
      ${resetCallout}
      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 flex items-center justify-between gap-4">
        <div>
          <h2 class="text-xl font-semibold">Usuários</h2>
          <p class="mt-1 text-sm text-slate-600">Gerencie papéis, status e sessões dos usuários.</p>
        </div>
        <form hx-get="/admin/partials/users" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="true">
          <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input type="checkbox" name="includeDeleted" value="true" onchange="this.form.requestSubmit()" ${includeDeleted ? 'checked' : ''} class="rounded border-slate-300" />
            Mostrar excluídos
          </label>
        </form>
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
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${result.data.map((user) => {
                const isMaster = user.isMasterAdmin;
                const isDeleted = user.deletedAt != null;
                const isDisabled = user.disabledAt != null;
                return `
                  <tr class="${isDeleted ? 'opacity-40 line-through' : isDisabled ? 'opacity-60' : ''}">
                    <td class="px-3 py-3 font-medium">
                      ${escapeHtml(user.name)}
                      ${isMaster ? '<span class="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">Master Admin</span>' : ''}
                      ${isDeleted ? '<span class="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500 no-underline" style="text-decoration:none">Excluído</span>' : ''}
                    </td>
                    <td class="px-3 py-3">${escapeHtml(user.registration ?? '—')}</td>
                    <td class="px-3 py-3">${escapeHtml(user.email)}</td>
                    <td class="px-3 py-3">${escapeHtml(user.department)}</td>
                    <td class="px-3 py-3">
                      ${isMaster || isDeleted
                        ? renderRoleBadge(user.role)
                        : `<form hx-patch="/admin/actions/users/${user.id}/role" hx-target="#admin-content" hx-swap="innerHTML">
                            <select
                              name="role"
                              onchange="this.form.requestSubmit()"
                              class="rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-slate-900 focus:outline-none"
                            >
                              ${['student', 'professor', 'staff', 'maintenance'].map((r) => `
                                <option value="${r}" ${r === user.role ? 'selected' : ''}>${ROLE_LABELS_TITLE[r as keyof typeof ROLE_LABELS_TITLE] ?? r}</option>
                              `).join('')}
                            </select>
                          </form>`
                      }
                    </td>
                    <td class="px-3 py-3">
                      ${isDeleted
                        ? '<span class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Excluído</span>'
                        : isDisabled
                          ? '<span class="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700">Desativado</span>'
                          : '<span class="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Ativo</span>'}
                    </td>
                    <td class="px-3 py-3">
                      <div class="flex flex-wrap gap-2">
                        ${isMaster || isDeleted
                          ? '<span class="text-xs text-slate-400">—</span>'
                          : `
                            <form hx-patch="/admin/actions/users/${user.id}/disable" hx-target="#admin-content" hx-swap="innerHTML">
                              <input type="hidden" name="disabled" value="${isDisabled ? 'false' : 'true'}" />
                              <button type="submit" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                                ${isDisabled ? 'Ativar' : 'Desativar'}
                              </button>
                            </form>
                            <form hx-post="/admin/actions/users/${user.id}/reset-password" hx-target="#admin-content" hx-swap="innerHTML">
                              <button type="submit" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Resetar senha</button>
                            </form>
                            <form
                              hx-delete="/admin/actions/users/${user.id}/sessions"
                              hx-target="#admin-content"
                              hx-swap="innerHTML"
                              hx-confirm="Encerrar todas as sessões de ${escapeAttribute(user.name)}?"
                            >
                              <button type="submit" class="rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50">Encerrar sessões</button>
                            </form>
                            ${actingIsMaster
                              ? `<form
                                  hx-delete="/admin/actions/users/${user.id}"
                                  hx-target="#admin-content"
                                  hx-swap="innerHTML"
                                  hx-confirm="Excluir permanentemente ${escapeAttribute(user.name)}? Esta ação não pode ser desfeita."
                                >
                                  <button type="submit" class="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:bg-red-100">Excluir</button>
                                </form>`
                              : ''
                            }
                          `
                        }
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${renderPagination('/admin/partials/users', result.pagination, filters)}
      </div>
    </section>
  `;
}
