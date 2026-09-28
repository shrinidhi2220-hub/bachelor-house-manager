import twilio from 'twilio';

let client = null;
function configured(contentSid) { return Boolean(process.env.WHATSAPP_ENABLED === 'true' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM && (contentSid || process.env.TWILIO_TASK_CONTENT_SID)); }
function getClient() { if (!client) client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN); return client; }

export function whatsappStatus() {
  return { enabled: process.env.WHATSAPP_ENABLED === 'true', configured: configured(process.env.TWILIO_TASK_CONTENT_SID), accountConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN), senderConfigured: Boolean(process.env.TWILIO_WHATSAPP_FROM), templateConfigured: Boolean(process.env.TWILIO_TASK_CONTENT_SID), testTemplateConfigured: Boolean(process.env.TWILIO_TEST_CONTENT_SID) };
}

export async function sendTemplate({ to, contentSid, variables }) {
  if (!to) return { sent:false, reason:'Member has no mobile/WhatsApp number.', phone:'' };
  const sidToUse = contentSid || process.env.TWILIO_TASK_CONTENT_SID || process.env.TWILIO_TEST_CONTENT_SID;
  if (!configured(sidToUse)) return { sent:false, reason:'WhatsApp is not configured. Add Twilio credentials, sender, and an approved template.', phone:to };
  if (!sidToUse) return { sent:false, reason:'No WhatsApp Content SID is configured.', phone:to };
  try {
    const message = await getClient().messages.create({ from: process.env.TWILIO_WHATSAPP_FROM, to:`whatsapp:${to}`, contentSid:sidToUse, contentVariables: JSON.stringify(variables || {}) });
    return { sent:true, sid:message.sid, phone:to };
  } catch (error) {
    return { sent:false, reason:error?.message || 'Twilio send failed.', phone:to };
  }
}
