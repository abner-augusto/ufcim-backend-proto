import type { Env } from '@/types/env';

const API_BASE = 'https://api.telegram.org';

/** Outcome of a Telegram send attempt. Never throws — callers treat it as best-effort. */
export type TelegramResult =
  | { sent: true }
  | { sent: false; reason: string };

/**
 * Thin Telegram Bot API client. Sending is best-effort: if the token / chat id
 * are unset or the call fails, we return { sent: false } instead of throwing, so
 * the invitation-request flow keeps working even when notifications are down.
 *
 * Configure in deployed workers via Secrets (Workers & Pages → worker → Settings
 * → Variables and Secrets): TELEGRAM_BOT_TOKEN (from @BotFather) and
 * TELEGRAM_CHAT_ID (the chat/group that should receive the alerts).
 */
export class TelegramService {
  constructor(private env: Env) {}

  get isConfigured(): boolean {
    return Boolean(this.env.TELEGRAM_BOT_TOKEN && this.env.TELEGRAM_CHAT_ID);
  }

  /** Sends an HTML message to the configured chat. */
  async send(html: string): Promise<TelegramResult> {
    if (!this.env.TELEGRAM_BOT_TOKEN || !this.env.TELEGRAM_CHAT_ID) {
      return { sent: false, reason: 'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID não configurados' };
    }

    try {
      const res = await fetch(`${API_BASE}/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.env.TELEGRAM_CHAT_ID,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { sent: false, reason: `Telegram respondeu ${res.status}: ${body}` };
      }

      return { sent: true };
    } catch (err) {
      return { sent: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Notifies the admin chat that a new access request is awaiting review. */
  async notifyInvitationRequest(input: { name: string; email: string }): Promise<TelegramResult> {
    const name = escapeHtml(input.name);
    const email = escapeHtml(input.email);
    const html = [
      '🔔 <b>Nova solicitação de convite</b>',
      '',
      `<b>Nome:</b> ${name}`,
      `<b>E-mail:</b> ${email}`,
      '',
      'Acesse o painel administrativo para aprovar ou rejeitar.',
    ].join('\n');
    return this.send(html);
  }
}

/** Escapes the characters Telegram's HTML parse mode treats as markup. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
