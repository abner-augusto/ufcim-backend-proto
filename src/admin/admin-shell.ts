function navLink(currentPath: string, href: string, label: string) {
  const isActive = currentPath === href;
  const classes = isActive
    ? 'bg-slate-900 text-white shadow-sm'
    : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900';

  return `
    <a
      href="${href}"
      data-admin-nav-link="true"
      data-admin-nav-href="${href}"
      hx-get="/admin/partials${href === '/admin' ? '/dashboard' : href.slice('/admin'.length)}"
      hx-target="#admin-content"
      hx-swap="innerHTML"
      hx-push-url="${href}"
      class="rounded-lg px-3 py-2 text-sm font-medium transition ${classes}"
      aria-current="${isActive ? 'page' : 'false'}"
    >
      ${label}
    </a>
  `;
}

export function renderAdminShell(currentPath: string) {
  const normalizedPath = currentPath === '/admin/' ? '/admin' : currentPath;
  const partialPath = normalizedPath === '/admin'
    ? '/admin/partials/dashboard'
    : `/admin/partials${normalizedPath.slice('/admin'.length)}`;

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Painel Admin UFCIM</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/htmx.org@1.9.12"></script>
    <script defer src="https://unpkg.com/alpinejs@3.14.8/dist/cdn.min.js"></script>
  </head>
  <body class="min-h-screen bg-slate-100 text-slate-900">
    <div class="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <header class="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">UFCIM</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight">Painel de Administração</h1>
            <p class="mt-2 text-sm text-slate-600">
              Painel interno de operações servido a partir do mesmo aplicativo Hono e backado por um D1 local durante o desenvolvimento.
            </p>
          </div>
          <div class="flex flex-col items-end gap-3">
            <div
              id="user-switcher"
              hx-get="/admin/partials/user-switcher"
              hx-trigger="load"
              hx-swap="outerHTML"
            ></div>
            <div class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
              No ambiente local, a autenticação ignora as restrições de cargo de equipe (staff-role) de forma protegida, mas apenas se o ambiente estiver configurado como <code>ENVIRONMENT=development</code>.
            </div>
          </div>
        </div>
        <nav class="mt-6 flex flex-wrap gap-2">
          ${navLink(normalizedPath, '/admin', 'Painel Principal')}
          ${navLink(normalizedPath, '/admin/spaces', 'Espaços')}
          ${navLink(normalizedPath, '/admin/reservations', 'Reservas')}
          ${navLink(normalizedPath, '/admin/blockings', 'Bloqueios')}
          ${navLink(normalizedPath, '/admin/equipment', 'Equipamentos')}
          ${navLink(normalizedPath, '/admin/users', 'Usuários')}
          ${navLink(normalizedPath, '/admin/logs', 'Logs de Auditoria')}
        </nav>
      </header>

      <main
        id="admin-content"
        class="flex-1"
        hx-get="${partialPath}"
        hx-trigger="load"
        hx-swap="innerHTML"
      ></main>
    </div>

    <script>
      window.applyAdminNavState = function applyAdminNavState(activePath) {
        const navLinks = document.querySelectorAll('[data-admin-nav-link="true"]');

        for (const link of navLinks) {
          const href = link.getAttribute('data-admin-nav-href');
          const isActive = href === activePath;

          link.classList.toggle('bg-slate-900', isActive);
          link.classList.toggle('text-white', isActive);
          link.classList.toggle('shadow-sm', isActive);
          link.classList.toggle('text-slate-600', !isActive);
          link.classList.toggle('hover:bg-slate-200', !isActive);
          link.classList.toggle('hover:text-slate-900', !isActive);
          link.setAttribute('aria-current', isActive ? 'page' : 'false');
        }
      };

      window.syncAdminNav = function syncAdminNav() {
        const currentPath = window.location.pathname === '/admin/' ? '/admin' : window.location.pathname;
        window.applyAdminNavState(currentPath);
      };

      window.dashboardStats = function dashboardStats() {
        return {
          loading: true,
          error: null,
          stats: {
            totalSpaces: 0,
            activeReservationsToday: 0,
            activeBlockings: 0,
            totalUsers: 0,
          },
          async load() {
            this.loading = true;
            this.error = null;

            try {
              const response = await fetch('/api/v1/stats');
              if (!response.ok) {
                throw new Error('Falha ao carregar estatísticas do painel');
              }

              this.stats = await response.json();
            } catch (error) {
              this.error = error instanceof Error ? error.message : 'Erro desconhecido';
            } finally {
              this.loading = false;
            }
          },
        };
      };

      window.syncAdminNav();
      document.body.addEventListener('htmx:afterSwap', function (event) {
        if (event.target && event.target.id === 'admin-content') {
          window.syncAdminNav();
        }
      });
      window.addEventListener('popstate', window.syncAdminNav);
    </script>
  </body>
</html>`;
}
