import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};
const enabled = String(import.meta.env.VITE_FCM_ENABLED || 'false').toLowerCase() === 'true';
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
export const PUSH_TOKEN_KEY = 'bhm_fcm_token_v6';

export function fcmConfigured() {
  return enabled && Boolean(config.apiKey && config.projectId && config.messagingSenderId && config.appId && vapidKey);
}

async function messagingSupported() {
  try { return await isSupported(); } catch { return false; }
}

export async function registerForPush() {
  if (!fcmConfigured() || !('Notification' in window) || !(await messagingSupported())) return { enabled: false, reason: 'Push notifications are not configured or supported on this browser.' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { enabled: false, reason: 'Notification permission was not granted.' };
  const app = getApps().length ? getApps()[0] : initializeApp(config);
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  try { localStorage.setItem(PUSH_TOKEN_KEY, token); } catch {}
  return { enabled: true, token, permission };
}

export async function listenForForegroundPush(handler) {
  if (!fcmConfigured() || !(await messagingSupported())) return () => {};
  const app = getApps().length ? getApps()[0] : initializeApp(config);
  const messaging = getMessaging(app);
  return onMessage(messaging, handler);
}
