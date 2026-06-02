import { createDb } from '@/db/client';
import { EquipmentService } from '@/services/equipment.service';
import { SpaceService } from '@/services/space.service';
import type { AdminContext } from '../context';
import { escapeHtml, renderInput, renderMessage, renderSelect } from '../ui';

export async function renderEquipmentView(
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
