import 'server-only';

/**
 * Outbound email, for the one notification this application sends: a new
 * registration waiting for approval.
 *
 * Deliberately a thin port over an HTTP API rather than an SMTP dependency.
 * The only adapter is Resend, chosen because it needs nothing but `fetch`.
 *
 * When it is not configured, nothing is sent and the function says so. It does
 * not throw and it does not pretend: registration must still succeed when the
 * mail provider is down or unset, and an admin who believes a mail went out
 * when it did not is worse off than one who knows it did not. The pending list
 * on the admin screen is the durable channel; email is the convenience.
 */

export type EmailResult =
  | { sent: true }
  | { sent: false; reason: 'not-configured' | 'failed'; detail?: string };

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain text; this application sends no marketing and needs no HTML. */
  text: string;
};

function config(): { apiKey: string; from: string; to: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM;
  const to = process.env.NOTIFY_EMAIL_TO;

  if (!apiKey || !from || !to) return null;
  return { apiKey, from, to };
}

/** True when the deployment can actually deliver mail. */
export function emailIsConfigured(): boolean {
  return config() !== null;
}

/** The address notifications go to, for showing on screen. */
export function notifyAddress(): string | null {
  return config()?.to ?? null;
}

export async function sendAdminEmail(
  message: Omit<EmailMessage, 'to'>,
): Promise<EmailResult> {
  const settings = config();
  if (!settings) return { sent: false, reason: 'not-configured' };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: settings.from,
        to: [settings.to],
        subject: message.subject,
        text: message.text,
      }),
      // A slow mail provider must not hold up a registration.
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return { sent: false, reason: 'failed', detail: `HTTP ${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: 'failed',
      detail: error instanceof Error ? error.message : 'Tidak dikenal',
    };
  }
}
