import { Resend } from 'resend';

export async function sendEmailAlert(subject: string, html: string) {
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const from = process.env.ALERTS_FROM_EMAIL || 'onboarding@resend.dev';
  const to = process.env.ALERTS_TO_EMAIL || process.env.ALERTS_TO || '';
  if (!to) return;
  await resend.emails.send({ from, to, subject, html });
}

export async function sendSlackAlert(text: string, webhookOverride?: string) {
  const url = webhookOverride || process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
}
