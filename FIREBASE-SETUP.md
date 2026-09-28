# Firebase Cloud Messaging setup

Bachelor House Manager v6 uses Firebase Cloud Messaging (FCM) as the primary push-notification channel. Firebase lists Cloud Messaging as no-cost, subject to its platform limits and normal device/browser requirements.

## Frontend (Vercel / local)

Create a Firebase Web App and copy its web config values into `frontend/.env`:

```env
VITE_FCM_ENABLED=true
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_VAPID_KEY=...
```

The project automatically generates `public/firebase-messaging-sw.js` when you run `npm run dev` or `npm run build`.

## Backend / Worker / Cron (Render)

Create a Firebase service account with only the permissions required to send Firebase Cloud Messaging messages. Supply:

```env
FCM_ENABLED=true
FCM_PROJECT_ID=...
FCM_CLIENT_EMAIL=...
FCM_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n
```

Use Render secret environment variables for the private key and service-account values. Never commit them to GitHub.

## App flow

1. A logged-in user opens Security.
2. They click Enable push notifications.
3. The browser grants notification permission.
4. The FCM registration token is sent to `/api/notifications/device`.
5. The backend stores the device token against the authenticated user and house.
6. Any in-app Notification can create a deduplicated PushJob.
7. The background worker sends the push to that user's active devices.
8. Invalid device tokens are disabled automatically.

WhatsApp remains an optional channel. Push notifications do not depend on Twilio.
