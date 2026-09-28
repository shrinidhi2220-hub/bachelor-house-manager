import admin from 'firebase-admin';

let initialized = false;
let enabled = false;
let initError = '';

function cleanPrivateKey(v) {
  return String(v || '').replace(/\\n/g, '\n');
}

export function fcmStatus() {
  return {
    enabled,
    configured: initialized && enabled,
    provider: 'Firebase Cloud Messaging',
    error: initError || null
  };
}

function init() {
  if (initialized) return;
  initialized = true;
  enabled = String(process.env.FCM_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) return;
  const projectId = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = cleanPrivateKey(process.env.FCM_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) {
    initError = 'FCM is enabled but service-account credentials are incomplete.';
    enabled = false;
    return;
  }
  try {
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
    }
  } catch (e) {
    enabled = false;
    initError = e?.message || 'Failed to initialize Firebase Admin.';
  }
}

init();

export async function sendPush({ tokens, title, body, data = {} }) {
  init();
  const targetTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!enabled || !admin.apps.length) return { sent: false, skipped: true, reason: initError || 'FCM is not configured.' };
  if (!targetTokens.length) return { sent: false, skipped: true, reason: 'No active device tokens.' };
  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens: targetTokens,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [String(k), String(v ?? '')]))
    });
    return {
      sent: response.successCount > 0,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses.map(r => ({ success: r.success, messageId: r.messageId || '', error: r.error?.message || '' }))
    };
  } catch (e) {
    return { sent: false, reason: e?.message || 'FCM send failed.' };
  }
}
