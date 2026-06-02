import { createDb } from '@/db/client';
import { InvitationService } from '@/services/invitation.service';
import { DepartmentService } from '@/services/department.service';
import type { AdminContext } from '../context';
import { escapeAttribute, escapeHtml, renderInput, renderMessage, renderRoleBadge, renderSelect } from '../ui';

export async function renderInvitationsView(
  c: AdminContext,
  options?: { message?: string; highlightUrl?: string; highlightInvitationId?: string }
) {
  const statusFilter = (c.req.query('status') ?? 'all') as 'pending' | 'accepted' | 'expired' | 'revoked' | 'all';
  const db = createDb(c.env.DB);
  const service = new InvitationService(db, c.env);
  const [result, depts] = await Promise.all([
    service.list({ status: statusFilter, page: 1, limit: 50 }),
    new DepartmentService(db).list(),
  ]);
  const deptOptions = depts.map((d) => ({ value: d.id, label: d.name }));

  const now = new Date().toISOString();

  const highlightCallout = options?.highlightUrl && options?.highlightInvitationId
    ? `
      <div class="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <p class="text-sm font-semibold uppercase tracking-wide text-emerald-700">Convite criado — copie e envie via WhatsApp</p>
            <p class="mt-2 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-slate-800 ring-1 ring-emerald-200" id="invite-url-${options.highlightInvitationId}">${escapeHtml(options.highlightUrl)}</p>
            <p class="mt-2 text-xs text-emerald-700">Este link aparece apenas uma vez. Após sair desta tela, gere um novo via "Reenviar".</p>
          </div>
          <button
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            onclick="navigator.clipboard.writeText('${escapeAttribute(options.highlightUrl)}'); this.textContent='Copiado ✓'; setTimeout(() => this.textContent='Copiar', 2000)"
          >Copiar</button>
        </div>
      </div>
    `
    : '';

  const statusOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'pending', label: 'Pendente' },
    { value: 'accepted', label: 'Aceito' },
    { value: 'expired', label: 'Expirado' },
    { value: 'revoked', label: 'Revogado' },
  ];

  const invitationStatusLabel = (inv: typeof result.data[number]) => {
    if (inv.acceptedAt) return '<span class="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Aceito</span>';
    if (inv.revokedAt) return '<span class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Revogado</span>';
    if (inv.expiresAt < now) return '<span class="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">Expirado</span>';
    return '<span class="inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700">Pendente</span>';
  };

  const isPending = (inv: typeof result.data[number]) =>
    inv.acceptedAt == null && inv.revokedAt == null && inv.expiresAt >= now;

  return `
    <section class="space-y-6">
      ${renderMessage(options?.message)}
      ${highlightCallout}
      <div class="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Criar Convite</h2>
          <p class="mt-1 text-sm text-slate-600">O link gerado é exibido apenas uma vez. Envie via WhatsApp ou e-mail.</p>
          <form class="mt-4 grid gap-3" hx-post="/admin/actions/invitations" hx-target="#admin-content" hx-swap="innerHTML">
            ${renderInput('email', 'E-mail', 'email')}
            ${renderInput('name', 'Nome', 'text')}
            ${renderInput('registration', 'Matrícula (opcional)', 'text', '', false, '', 'Deixe em branco se o usuário não possui matrícula UFC')}
            ${renderSelect('department', 'Departamento', deptOptions, '', true)}
            ${renderSelect('role', 'Papel', [
              { value: 'student', label: 'Estudante' },
              { value: 'professor', label: 'Professor(a)' },
              { value: 'staff', label: 'Funcionário' },
              { value: 'maintenance', label: 'Manutenção' },
            ], '', true)}
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Criar Convite</button>
          </form>
        </div>

        <div class="space-y-4">
          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div class="flex items-center justify-between gap-4">
              <h2 class="text-xl font-semibold">Convites</h2>
              <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">${result.pagination.total} total</span>
            </div>
            <form class="mt-4" hx-get="/admin/partials/invitations" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="true">
              ${renderSelect('status', 'Filtrar por status', statusOptions, statusFilter, true)}
              <div class="mt-3">
                <button type="submit" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Filtrar</button>
              </div>
            </form>
          </div>

          <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr class="text-left text-slate-500">
                    <th class="px-3 py-2 font-medium">Email</th>
                    <th class="px-3 py-2 font-medium">Nome</th>
                    <th class="px-3 py-2 font-medium">Papel</th>
                    <th class="px-3 py-2 font-medium">Status</th>
                    <th class="px-3 py-2 font-medium">Criado em</th>
                    <th class="px-3 py-2 font-medium">Expira em</th>
                    <th class="px-3 py-2 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${result.data.length === 0
                    ? `<tr><td colspan="7" class="px-3 py-6 text-center text-slate-400">Nenhum convite encontrado.</td></tr>`
                    : result.data.map((inv) => {
                        const pending = isPending(inv);
                        const dimmed = inv.revokedAt || (inv.expiresAt < now && !inv.acceptedAt);
                        return `
                          <tr class="${dimmed ? 'opacity-50' : ''}">
                            <td class="px-3 py-3">${escapeHtml(inv.email)}</td>
                            <td class="px-3 py-3 font-medium">${escapeHtml(inv.name)}</td>
                            <td class="px-3 py-3">${renderRoleBadge(inv.role)}</td>
                            <td class="px-3 py-3">${invitationStatusLabel(inv)}</td>
                            <td class="px-3 py-3 tabular-nums">${inv.createdAt.slice(0, 10)}</td>
                            <td class="px-3 py-3 tabular-nums">${inv.expiresAt.slice(0, 10)}</td>
                            <td class="px-3 py-3">
                              <div class="flex flex-wrap gap-2">
                                ${pending
                                  ? `
                                    <form hx-post="/admin/actions/invitations/${inv.id}/resend" hx-target="#admin-content" hx-swap="innerHTML">
                                      <button type="submit" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Reenviar</button>
                                    </form>
                                    <form
                                      hx-delete="/admin/actions/invitations/${inv.id}"
                                      hx-target="#admin-content"
                                      hx-swap="innerHTML"
                                      hx-confirm="Revogar convite para ${escapeAttribute(inv.email)}?"
                                    >
                                      <button type="submit" class="rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50">Revogar</button>
                                    </form>
                                  `
                                  : '<span class="text-xs text-slate-400">—</span>'
                                }
                              </div>
                            </td>
                          </tr>
                        `;
                      }).join('')
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
