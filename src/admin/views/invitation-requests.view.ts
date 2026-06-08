import { createDb } from '@/db/client';
import { InvitationRequestService } from '@/services/invitation-request.service';
import { DepartmentService } from '@/services/department.service';
import type { AdminContext } from '../context';
import { escapeAttribute, escapeHtml, renderMessage, renderSelect } from '../ui';

export async function renderInvitationRequestsView(
  c: AdminContext,
  options?: { message?: string; highlightUrl?: string; highlightRequestId?: string }
) {
  const statusFilter = (c.req.query('status') ?? 'pending') as 'pending' | 'approved' | 'rejected' | 'all';
  const db = createDb(c.env.DB);
  const service = new InvitationRequestService(db, c.env);
  const [requests, depts] = await Promise.all([
    service.list(statusFilter),
    new DepartmentService(db).list(),
  ]);
  const deptOptions = depts.map((d) => ({ value: d.id, label: d.name }));
  const roleOptions = [
    { value: 'student', label: 'Estudante' },
    { value: 'professor', label: 'Professor(a)' },
    { value: 'staff', label: 'Funcionário' },
    { value: 'maintenance', label: 'Manutenção' },
  ];

  const statusOptions = [
    { value: 'pending', label: 'Pendentes' },
    { value: 'approved', label: 'Aprovadas' },
    { value: 'rejected', label: 'Rejeitadas' },
    { value: 'all', label: 'Todas' },
  ];

  const statusLabel = (status: string) => {
    if (status === 'approved') return '<span class="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Aprovada</span>';
    if (status === 'rejected') return '<span class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Rejeitada</span>';
    return '<span class="inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700">Pendente</span>';
  };

  const highlightCallout = options?.highlightUrl && options?.highlightRequestId
    ? `
      <div class="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <p class="text-sm font-semibold uppercase tracking-wide text-emerald-700">Solicitação aprovada — convite criado</p>
            <p class="mt-2 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-slate-800 ring-1 ring-emerald-200">${escapeHtml(options.highlightUrl)}</p>
            <p class="mt-2 text-xs text-emerald-700">O link também foi enviado por e-mail (se o envio estiver configurado). Ele aparece aqui apenas uma vez.</p>
          </div>
          <button
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            onclick="navigator.clipboard.writeText('${escapeAttribute(options.highlightUrl)}'); this.textContent='Copiado ✓'; setTimeout(() => this.textContent='Copiar', 2000)"
          >Copiar</button>
        </div>
      </div>
    `
    : '';

  const rows = requests.length === 0
    ? `<tr><td colspan="4" class="px-3 py-6 text-center text-slate-400">Nenhuma solicitação ${statusFilter === 'pending' ? 'pendente' : ''} encontrada.</td></tr>`
    : requests.map((req) => {
        const actions = req.status === 'pending'
          ? `
            <form class="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end" hx-post="/admin/actions/invitation-requests/${req.id}/approve" hx-target="#admin-content" hx-swap="innerHTML">
              ${renderSelect('department', 'Departamento', deptOptions, '', true)}
              ${renderSelect('role', 'Papel', roleOptions, '', true)}
              <button type="submit" class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700">Aprovar</button>
            </form>
            <form class="mt-2" hx-post="/admin/actions/invitation-requests/${req.id}/reject" hx-target="#admin-content" hx-swap="innerHTML" hx-confirm="Rejeitar a solicitação de ${escapeAttribute(req.email)}?">
              <button type="submit" class="rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50">Rejeitar</button>
            </form>
          `
          : '<span class="text-xs text-slate-400">—</span>';
        return `
          <tr class="${req.status !== 'pending' ? 'opacity-60' : ''}">
            <td class="px-3 py-3 font-medium align-top">${escapeHtml(req.name)}<div class="text-xs font-normal text-slate-500">${escapeHtml(req.email)}</div></td>
            <td class="px-3 py-3 tabular-nums align-top">${req.createdAt.slice(0, 10)}</td>
            <td class="px-3 py-3 align-top">${statusLabel(req.status)}</td>
            <td class="px-3 py-3 align-top">${actions}</td>
          </tr>
        `;
      }).join('');

  return `
    <section class="space-y-6">
      ${renderMessage(options?.message)}
      ${highlightCallout}
      <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold">Solicitações de Convite</h2>
            <p class="mt-1 text-sm text-slate-600">Pedidos de acesso enviados pelo site. Aprove escolhendo papel e departamento — o convite é criado e enviado por e-mail.</p>
          </div>
          <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">${requests.length}</span>
        </div>
        <form class="mt-4" hx-get="/admin/partials/invitation-requests" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="true">
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
                <th class="px-3 py-2 font-medium">Solicitante</th>
                <th class="px-3 py-2 font-medium">Recebida em</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}
