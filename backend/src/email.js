function configured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export function emailStatus() {
  return { configured: configured(), from: process.env.MAIL_FROM || '', provider: 'resend' };
}

export async function sendVerificationEmail({ to, name, verifyUrl }) {
  if (!configured()) {
    console.warn(`[email] RESEND_API_KEY/MAIL_FROM is not configured. Verification URL for ${to}: ${verifyUrl}`);
    return { sent: false, previewUrl: process.env.NODE_ENV === 'production' ? undefined : verifyUrl, reason: 'Email provider is not configured.' };
  }
  const subject = 'Verify your Bachelor House Manager email';
  const text = `Hi ${name},\n\nVerify your email address for Bachelor House Manager:\n${verifyUrl}\n\nThis link expires in ${process.env.EMAIL_VERIFICATION_TTL_HOURS || 24} hours.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Bachelor House Manager</h2><p>Hi ${name},</p><p>Verify your email address to secure your account.</p><p><a href="${verifyUrl}" style="display:inline-block;padding:11px 18px;background:#5b61ef;color:#fff;text-decoration:none;border-radius:8px">Verify email</a></p><p style="color:#667">This link expires in ${process.env.EMAIL_VERIFICATION_TTL_HOURS || 24} hours.</p></div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to:[to], subject, text, html })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Email provider returned ${response.status}`);
  return { sent: true, messageId: body.id || '' };
}
