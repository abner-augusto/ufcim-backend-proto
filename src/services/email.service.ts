import type { Env } from '@/types/env';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'UFCIM <noreply@ufcim.integrarte.arq.br>';

/** Outcome of an e-mail send attempt. Never throws — callers treat e-mail as best-effort. */
export type EmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: string };

/**
 * Thin Resend HTTP client. Cloudflare Workers have no SMTP, so we POST to the
 * Resend API. Sending is best-effort: if RESEND_API_KEY is unset or the call
 * fails, we return { sent: false } instead of throwing, so the invitation flow
 * (which always returns a copyable link) keeps working.
 */
export class EmailService {
  constructor(private env: Env) {}

  get isConfigured(): boolean {
    return Boolean(this.env.RESEND_API_KEY);
  }

  private get from(): string {
    return this.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
  }

  async send(input: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<EmailResult> {
    if (!this.env.RESEND_API_KEY) {
      return { sent: false, reason: 'RESEND_API_KEY não configurado' };
    }

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          ...(input.text ? { text: input.text } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { sent: false, reason: `Resend respondeu ${res.status}: ${body}` };
      }

      const data = (await res.json()) as { id: string };
      return { sent: true, id: data.id };
    } catch (err) {
      return { sent: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Sends the invitation / password-reset e-mail carrying the one-time link. */
  async sendInvitation(input: {
    to: string;
    name: string;
    url: string;
    purpose: 'invite' | 'reset';
  }): Promise<EmailResult> {
    const isReset = input.purpose === 'reset';
    const subject = isReset
      ? 'Redefinição de senha — UFCIM'
      : 'Convite de acesso — UFCIM';
    return this.send({
      to: input.to,
      subject,
      html: renderInvitationHtml(input),
      text: renderInvitationText(input),
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInvitationHtml(input: { name: string; url: string; purpose: 'invite' | 'reset' }): string {
  const isReset = input.purpose === 'reset';
  const name = escapeHtml(input.name);
  const url = escapeHtml(input.url);
  const heading = isReset ? 'Redefinição de senha' : 'Você recebeu um convite';
  const lead = isReset
    ? 'Recebemos um pedido para redefinir a senha da sua conta no UFCIM. Clique no botão abaixo para escolher uma nova senha.'
    : 'Você foi convidado para criar sua conta no UFCIM, o sistema de reservas de espaços. Clique no botão abaixo para definir sua senha e ativar o acesso.';
  const cta = isReset ? 'Redefinir senha' : 'Ativar conta';

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#0f172a;padding:20px 32px;color:#ffffff;font-size:18px;font-weight:bold;">UFCIM</td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;">${heading}</h1>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Olá, ${name}.</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">${lead}</p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:6px;background:#2563eb;">
                      <a href="${url}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${cta}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 8px;font-size:13px;color:#52525b;line-height:1.5;">Se o botão não funcionar, copie e cole este link no navegador:</p>
                <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${url}" style="color:#2563eb;">${url}</a></p>
                <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5;">O link expira em algumas horas. Se você não esperava este e-mail, pode ignorá-lo.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderInvitationText(input: { name: string; url: string; purpose: 'invite' | 'reset' }): string {
  const isReset = input.purpose === 'reset';
  const lead = isReset
    ? 'Recebemos um pedido para redefinir a senha da sua conta no UFCIM.'
    : 'Você foi convidado para criar sua conta no UFCIM, o sistema de reservas de espaços.';
  return [
    `Olá, ${input.name}.`,
    '',
    lead,
    'Use o link abaixo para continuar:',
    input.url,
    '',
    'O link expira em algumas horas. Se você não esperava este e-mail, pode ignorá-lo.',
  ].join('\n');
}
