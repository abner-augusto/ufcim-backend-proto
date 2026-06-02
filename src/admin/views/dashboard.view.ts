import type { StatsService } from '@/services/stats.service';
import { escapeAttribute, renderStatCard } from '../ui';

export function renderDashboard(stats: Awaited<ReturnType<StatsService['getDashboardStats']>>) {
  return `
    <section class="space-y-6" x-data="dashboardStats()" x-init="stats = ${escapeAttribute(JSON.stringify(stats))}; loading = false;">
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${renderStatCard('Total de Espaços', 'stats.totalSpaces', 'Todos os espaços físicos registrados')}
        ${renderStatCard('Reservas Hoje', 'stats.activeReservationsToday', 'Reservas confirmadas para hoje')}
        ${renderStatCard('Bloqueios Ativos', 'stats.activeBlockings', 'Substituições ativas')}
        ${renderStatCard('Total de Usuários', 'stats.totalUsers', 'Usuários sincronizados a partir das reivindicações de autenticação')}
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Visão Geral</h2>
          <p class="mt-2 text-sm leading-6 text-slate-600">
            Este painel reúne as operações internas do UFCIM. O mesmo aplicativo Hono atende tanto à API quanto a esta interface administrativa exclusiva para funcionários, e o painel lê contagens resumidas de <code>/api/v1/stats</code>.
          </p>
        </div>
        <div class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-xl font-semibold">Links Rápidos</h2>
          <div class="mt-4 grid gap-3">
            <a href="/admin/spaces" hx-get="/admin/partials/spaces" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/spaces" class="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Gerenciar espaços e inspecionar disponibilidade</a>
            <a href="/admin/reservations" hx-get="/admin/partials/reservations" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/reservations" class="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Revisar reservas e cancelar slots confirmados</a>
            <a href="/admin/blockings" hx-get="/admin/partials/blockings" hx-target="#admin-content" hx-swap="innerHTML" hx-push-url="/admin/blockings" class="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Criar e remover bloqueios</a>
          </div>
        </div>
      </div>
    </section>
  `;
}
