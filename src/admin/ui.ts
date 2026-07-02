import { AppError } from '@/middleware/error-handler';
import { DEFAULT_CLOSED_FROM, DEFAULT_CLOSED_TO } from '@/lib/schedule';
import { ROLE_LABELS_TITLE } from '@/lib/role-labels';
import type { AdminContext } from './context';

// ── HTML escaping ─────────────────────────────────────────────────────────────
export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttribute(value: string) {
  return escapeHtml(value);
}

// ── Form-data helpers ─────────────────────────────────────────────────────────
export async function formDataToObject(c: AdminContext) {
  const formData = await c.req.formData();
  return Object.fromEntries(formData.entries());
}

export function parseSpaceForm(values: Record<string, unknown>) {
  return {
    name: stringValue(values.name),
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
    reservable: values.reservable === 'on',
    closedFrom: stringValue(values.closedFrom) || DEFAULT_CLOSED_FROM,
    closedTo: stringValue(values.closedTo) || DEFAULT_CLOSED_TO,
  };
}

export function normalizeEmptyStrings<T extends Record<string, unknown>>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === '' ? undefined : value])
  ) as T;
}

export function buildQuery(values: Record<string, unknown>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }

  return params.toString();
}

export function blankToUndefined(value: unknown) {
  const normalized = stringValue(value);
  return normalized === '' ? undefined : normalized;
}

export function stringValue(value: unknown) {
  if (value === undefined || value === null) return '';
  return String(value);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export const HOURLY_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${hour.toString().padStart(2, '0')}:00`;
  return { value, label: value };
});

export const HOURLY_BOUNDARY_OPTIONS = [...HOURLY_OPTIONS, { value: '24:00', label: '24:00' }];

// ── Form field components ─────────────────────────────────────────────────────
export function renderInput(
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

export function renderTextarea(
  name: string,
  label: string,
  value = '',
  required = false,
  placeholder = ''
) {
  return `
    <label class="grid gap-1 text-sm">
      <span class="font-medium text-slate-700">${label}</span>
      <textarea
        class="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none ring-0 focus:border-slate-900"
        name="${name}"
        placeholder="${escapeAttribute(placeholder)}"
        ${required ? 'required' : ''}
      >${escapeHtml(value)}</textarea>
    </label>
  `;
}

export function renderSelect(
  name: string,
  label: string,
  options: Array<{ value: string; label: string }>,
  selectedValue = '',
  compact = false,
  wrapperClass = ''
) {
  return `
    <label class="grid gap-1 text-sm ${wrapperClass}">
      <span class="font-medium text-slate-700">${label}</span>
      <select
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none ring-0 focus:border-slate-900"
        name="${name}"
      >
        ${compact ? '' : '<option value="">Todos</option>'}
        ${options.map((option) => `
          <option value="${escapeAttribute(option.value)}" ${option.value === selectedValue ? 'selected' : ''}>
            ${escapeHtml(option.label)}
          </option>
        `).join('')}
      </select>
    </label>
  `;
}

export function renderPagination(basePath: string, pagination: { page: number; totalPages: number }, filters: Record<string, unknown>) {
  if (pagination.totalPages <= 1) return '';

  return `
    <div class="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 text-sm">
      <span class="text-slate-600">Página ${pagination.page} de ${pagination.totalPages}</span>
      <div class="flex gap-2">
        ${pagination.page > 1 ? `
          <button
            hx-get="${basePath}?${buildQuery({ ...filters, page: pagination.page - 1 })}"
            hx-target="#admin-content"
            hx-swap="innerHTML"
            class="rounded-lg border border-slate-300 px-3 py-2"
          >
            Anterior
          </button>
        ` : ''}
        ${pagination.page < pagination.totalPages ? `
          <button
            hx-get="${basePath}?${buildQuery({ ...filters, page: pagination.page + 1 })}"
            hx-target="#admin-content"
            hx-swap="innerHTML"
            class="rounded-lg border border-slate-300 px-3 py-2"
          >
            Próxima
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

export function renderHiddenInputs(values: Record<string, unknown>) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `<input type="hidden" name="${escapeAttribute(key)}" value="${escapeAttribute(String(value))}" />`)
    .join('');
}

// ── Banners ───────────────────────────────────────────────────────────────────
export function renderMessage(message?: string) {
  if (!message) return '';

  return `
    <div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      ${escapeHtml(message)}
    </div>
  `;
}

export function renderValidationErrors(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return `
    <div class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <div class="font-medium">Validação falhou</div>
      <ul class="mt-2 list-disc pl-5">
        ${issues.map((issue) => `<li>${escapeHtml(issue.path.join('.') || 'form')}: ${escapeHtml(issue.message)}</li>`).join('')}
      </ul>
    </div>
  `;
}

/**
 * Verbose error panel for the admin HTMX flow. Shows the human message, the
 * status + code classification, the originating endpoint (method + path), and —
 * outside production — the error name and a collapsible stack trace. Includes a
 * button to reload the section the user was on (derived from HX-Current-URL).
 */
export function renderActionError(c: AdminContext, err: unknown) {
  const isProd = c.env.ENVIRONMENT === 'production';
  const isApp = err instanceof AppError;
  const status = isApp ? err.statusCode : 500;
  const code = isApp ? (err.code ?? 'ERROR') : 'INTERNAL_ERROR';
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : 'Error';
  const stack = err instanceof Error ? err.stack : undefined;
  const origin = `${c.req.method} ${c.req.path}`;

  let reloadPartial = '/admin/partials/dashboard';
  const currentUrl = c.req.header('HX-Current-URL');
  if (currentUrl) {
    try {
      const path = new URL(currentUrl).pathname.replace(/\/$/, '');
      reloadPartial = path === '' || path === '/admin'
        ? '/admin/partials/dashboard'
        : `/admin/partials${path.slice('/admin'.length)}`;
    } catch {
      // malformed header — keep the dashboard default
    }
  }

  return `
    <div class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-800">
      <div class="flex items-center justify-between gap-3">
        <div class="font-semibold">Erro ${status} · ${escapeHtml(code)}</div>
        <button
          hx-get="${escapeAttribute(reloadPartial)}"
          hx-target="#admin-content"
          hx-swap="innerHTML"
          class="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
        >
          Recarregar seção
        </button>
      </div>
      <p class="mt-2 leading-6">${escapeHtml(message)}</p>
      <p class="mt-2 text-xs text-rose-600">Origem: <code>${escapeHtml(origin)}</code>${isProd ? '' : ` · ${escapeHtml(name)}`}</p>
      ${!isProd && stack
        ? `<details class="mt-2">
            <summary class="cursor-pointer text-xs text-rose-600">Stack trace</summary>
            <pre class="mt-2 overflow-auto rounded-lg bg-rose-100/60 p-3 text-xs leading-5 text-rose-900">${escapeHtml(stack)}</pre>
          </details>`
        : ''}
    </div>
  `;
}

export function renderEmptyState(message: string) {
  return `
    <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
      ${escapeHtml(message)}
    </div>
  `;
}

export function renderStatCard(title: string, expression: string, detail: string) {
  return `
    <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div class="text-sm font-medium uppercase tracking-wide text-slate-500">${title}</div>
      <div class="mt-3 text-4xl font-semibold tracking-tight" x-text="${expression}"></div>
      <div class="mt-2 text-sm text-slate-600">${detail}</div>
    </div>
  `;
}

// ── Status / role pills ────────────────────────────────────────────────────────
export function renderStatusPill(status: string) {
  const classMap: Record<string, string> = {
    confirmed: 'bg-emerald-100 text-emerald-700',
    canceled: 'bg-slate-100 text-slate-600',
    overridden: 'bg-amber-100 text-amber-700',
    active: 'bg-rose-100 text-rose-700',
    removed: 'bg-slate-100 text-slate-600',
  };

  const labelMap: Record<string, string> = {
    confirmed: 'Confirmada',
    canceled: 'Cancelada',
    overridden: 'Sobrescrita',
    active: 'Ativo',
    removed: 'Removido',
  };

  return `<span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classMap[status] ?? 'bg-slate-100 text-slate-600'}">${escapeHtml(labelMap[status] ?? status)}</span>`;
}

export function renderAvailabilityStatus(status: string) {
  const labels: Record<string, string> = {
    available: 'Disponível',
    blocked: 'Bloqueado',
    reserved: 'Reservado',
    closed: 'Fechado',
    not_reservable: 'Não reservável',
  };

  return escapeHtml(labels[status] ?? status);
}

export function renderRoleBadge(role: string) {
  const classMap: Record<string, string> = {
    student: 'bg-sky-100 text-sky-700',
    professor: 'bg-violet-100 text-violet-700',
    staff: 'bg-emerald-100 text-emerald-700',
    maintenance: 'bg-amber-100 text-amber-700',
  };

  return `<span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classMap[role] ?? 'bg-slate-100 text-slate-700'}">${escapeHtml(ROLE_LABELS_TITLE[role as keyof typeof ROLE_LABELS_TITLE] ?? role)}</span>`;
}
