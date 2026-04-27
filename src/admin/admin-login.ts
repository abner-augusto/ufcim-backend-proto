export function renderAdminLogin(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>UFCIM Admin · Login</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="min-h-screen bg-slate-100 grid place-items-center">
    <div class="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
      <h1 class="text-2xl font-semibold">UFCIM · Admin</h1>
      <p class="mt-2 text-sm text-slate-600">Acesso restrito ao Administrador Principal.</p>
      <form id="login-form" class="mt-6 grid gap-3">
        <label class="grid gap-1 text-sm">
          <span class="font-medium text-slate-700">Email</span>
          <input name="email" type="email" required class="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label class="grid gap-1 text-sm">
          <span class="font-medium text-slate-700">Senha</span>
          <input name="password" type="password" required class="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <button type="submit" id="submit-btn" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Entrar</button>
        <p id="error" class="hidden text-sm text-rose-600"></p>
      </form>
    </div>
    <script>
      const form = document.getElementById('login-form');
      const err = document.getElementById('error');
      const btn = document.getElementById('submit-btn');

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.classList.add('hidden');
        btn.disabled = true;
        btn.textContent = 'Entrando…';

        const data = Object.fromEntries(new FormData(form).entries());
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          err.textContent = body.error || 'Erro ao entrar.';
          err.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Entrar';
          return;
        }

        const { accessToken, refreshToken, user } = await res.json();
        if (!user.isMasterAdmin) {
          err.textContent = 'Acesso restrito ao Administrador Principal.';
          err.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Entrar';
          return;
        }

        sessionStorage.setItem('ufcim_admin_token', accessToken);
        sessionStorage.setItem('ufcim_admin_refresh', refreshToken);
        window.location.href = '/admin';
      });
    </script>
  </body>
</html>`;
}
