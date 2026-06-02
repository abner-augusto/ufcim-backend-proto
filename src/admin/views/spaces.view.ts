import { createDb } from '@/db/client';
import { SpaceService } from '@/services/space.service';
import { UserService } from '@/services/user.service';
import { DepartmentService } from '@/services/department.service';
import { IAUD_PINS } from '@/lib/iaud-pins';
import { DEFAULT_CLOSED_FROM, DEFAULT_CLOSED_TO, normalizeClosedHours } from '@/lib/schedule';
import type { AdminContext } from '../context';
import {
  HOURLY_BOUNDARY_OPTIONS,
  HOURLY_OPTIONS,
  escapeAttribute,
  escapeHtml,
  renderAvailabilityStatus,
  renderEmptyState,
  renderInput,
  renderMessage,
  renderSelect,
  stringValue,
  today,
} from '../ui';

export async function renderSpacesView(
  c: AdminContext,
  options?: { message?: string; selectedSpaceId?: string }
) {
  const db = createDb(c.env.DB);
  const spaceService = new SpaceService(db);
  const userService = new UserService(db);
  const depts = await new DepartmentService(db).list();
  const deptOptions = depts.map((d) => ({ value: d.id, label: d.name }));
  const spaces = await spaceService.list({ page: 1, limit: 100 });
  const allUsers = await userService.list(1, 200);
  const selectedSpaceId = options?.selectedSpaceId ?? c.req.query('selectedSpaceId');

  const usedModelIds = new Set(spaces.map((s) => s.modelId).filter(Boolean));
  const availablePins = IAUD_PINS.filter((p) => !usedModelIds.has(p.id));

  let detailHtml = renderEmptyState('Selecione um espaço para inspecionar equipamentos, disponibilidade e editar seus metadados.');
  if (selectedSpaceId) {
    const space = await spaceService.getById(selectedSpaceId);
    const availability = await spaceService.getAvailability(space.id, today());
    const usedByOthers = new Set(spaces.filter((s) => s.id !== space.id).map((s) => s.modelId).filter(Boolean));
    const availablePinsForDetail = IAUD_PINS.filter((p) => !usedByOthers.has(p.id));
    detailHtml = renderSpaceDetail(space, availability, allUsers, availablePinsForDetail, deptOptions);
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
              ${renderSpaceFields(undefined, availablePins, deptOptions)}
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

export function renderSpaceDetail(
  space: Awaited<ReturnType<SpaceService['getById']>>,
  availability: Awaited<ReturnType<SpaceService['getAvailability']>>,
  allUsers: Awaited<ReturnType<UserService['list']>>,
  availablePins?: { id: string; block: string; floor: string }[],
  deptOptions: Array<{ value: string; label: string }> = []
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
          ${renderSpaceFields(space as unknown as Record<string, unknown>, availablePins, deptOptions)}
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

function renderSpaceFields(space?: Record<string, unknown>, availablePins?: { id: string; block: string; floor: string }[], deptOptions: Array<{ value: string; label: string }> = []) {
  const closedHours = normalizeClosedHours(stringValue(space?.closedFrom), stringValue(space?.closedTo));
  const currentModelId = stringValue(space?.modelId);

  // Build pin options: always include the currently assigned pin (for edit forms)
  // followed by available (unassigned) pins.
  let modelIdField = '';
  if (availablePins !== undefined) {
    const currentPin = currentModelId && !availablePins.find((p) => p.id === currentModelId)
      ? [{ id: currentModelId, block: '', floor: '' }]
      : [];
    const pinOptions = [
      { value: '', label: '— Nenhum —' },
      ...currentPin.map((p) => ({ value: p.id, label: p.id })),
      ...availablePins.map((p) => ({ value: p.id, label: `${p.id} · ${p.block} / ${p.floor}` })),
    ];
    modelIdField = renderSelect('modelId', 'Model ID (3D)', pinOptions, currentModelId, true, 'sm:col-span-2');
  } else {
    modelIdField = renderInput('modelId', 'Model ID (3D)', 'text', currentModelId, false, 'sm:col-span-2');
  }

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
    ${renderSelect('department', 'Departamento', deptOptions, stringValue(space?.department), true)}
    ${renderInput('capacity', 'Capacidade', 'number', stringValue(space?.capacity))}
    ${modelIdField}
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
