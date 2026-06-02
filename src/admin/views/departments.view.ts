import { createDb } from '@/db/client';
import { DepartmentService } from '@/services/department.service';
import type { AdminContext } from '../context';
import { escapeAttribute, escapeHtml, renderInput, renderMessage } from '../ui';

export async function renderDepartmentsView(
  c: AdminContext,
  options?: { message?: string }
) {
  const db = createDb(c.env.DB);
  const depts = await new DepartmentService(db).list();

  return `
    <section class="space-y-6">
      ${renderMessage(options?.message)}
      <div class="grid gap-6 lg:grid-cols-2">
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-xl font-semibold">Departamentos</h2>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">${depts.length} cadastrados</span>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr class="text-left text-slate-500">
                  <th class="px-3 py-2 font-medium">ID (slug)</th>
                  <th class="px-3 py-2 font-medium">Nome</th>
                  <th class="px-3 py-2 font-medium">Campus</th>
                  <th class="px-3 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${depts.length === 0
                  ? `<tr><td colspan="4" class="px-3 py-6 text-center text-slate-400">Nenhum departamento cadastrado.</td></tr>`
                  : depts.map((d) => `
                    <tr>
                      <td class="px-3 py-3 font-mono text-xs text-slate-500">${escapeHtml(d.id)}</td>
                      <td class="px-3 py-3 font-medium">${escapeHtml(d.name)}</td>
                      <td class="px-3 py-3">${escapeHtml(d.campus)}</td>
                      <td class="px-3 py-3">
                        <form class="inline-flex gap-2 items-end"
                          hx-patch="/admin/actions/departments/${escapeAttribute(d.id)}"
                          hx-target="#admin-content" hx-swap="innerHTML">
                          <input class="rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-900 w-48"
                            type="text" name="name" value="${escapeAttribute(d.name)}" required />
                          <input class="rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-900 w-28"
                            type="text" name="campus" value="${escapeAttribute(d.campus)}" required />
                          <button type="submit"
                            class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                            Salvar
                          </button>
                        </form>
                      </td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Novo Departamento</h2>
          <p class="mt-1 text-sm text-slate-600">O ID (slug) deve ser único, em minúsculas, sem espaços. Ex.: <code>iaud</code>, <code>cc</code>.</p>
          <form class="mt-4 grid gap-3"
            hx-post="/admin/actions/departments"
            hx-target="#admin-content" hx-swap="innerHTML">
            ${renderInput('id', 'ID (slug)', 'text', '', false, '', 'ex.: iaud')}
            ${renderInput('name', 'Nome completo', 'text', '', false, '', 'ex.: Instituto de Arquitetura, Urbanismo e Design (IAUD)')}
            ${renderInput('campus', 'Campus', 'text', '', false, '', 'ex.: Benfica')}
            <button class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Criar</button>
          </form>
        </div>
      </div>
    </section>
  `;
}
