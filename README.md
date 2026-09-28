# Bachelor House Manager — Public SaaS v5.0.3

A multi-tenant household management platform designed for real public use.

## Product model

Every account is independent. A user can either create a house (becoming ADMIN/owner) or join a house using an invite code. Every house is isolated by `houseId` at the API and database layer.

The default household capacity is 5, but the creator can configure a larger capacity (up to 20 in this MVP).

## Included

- Public registration/login
- Create House / Join House
- Invite links + invite codes
- Per-member WhatsApp/mobile number routing
- Backend-only role enforcement
- FairChore scheduling engine
- 7-day rotation stored in MongoDB
- Idempotent daily generation
- MongoDB-backed outbox/message jobs
- WhatsApp delivery logs
- In-app notifications
- Expenses, groceries, meals, announcements, maintenance, inventory, leave
- Swap requests and admin replacements
- Fairness analytics
- Audit logs
- Health/readiness endpoints
- Rate limiting, Helmet, compression, CORS controls
- Stateless API suitable for multiple backend instances behind a load balancer

## Local setup

### Backend

```powershell
cd E:\House\bachelor-house-manager\backend
npm install
copy .env.example .env
npm run dev
```

### Frontend

```powershell
cd E:\House\bachelor-house-manager\frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## MongoDB

Set `MONGODB_URI` to a MongoDB Atlas connection string for production. Local MongoDB is also supported.

## Admin

There is no global hardcoded public admin anymore. The person who creates a house becomes that house's ADMIN. For the existing SHREESHANT house, create the account using the same username and password you want, then create the house. You can optionally bootstrap an admin with the backend bootstrap script.

## Production scaling

The API is stateless. Run 2+ web instances behind the platform load balancer. Do not attach a persistent disk to the horizontally scaled web service. MongoDB is the durable source of truth.

Use a separate worker service for message jobs and a scheduled cron job for daily schedule generation. Multiple workers are safe because message jobs are atomically claimed.

Render can load-balance traffic across multiple instances and supports up to 100 instances per scaled service. MongoDB Atlas provides dedicated tiers for higher-throughput production deployments. See `DEPLOYMENT.md` for the recommended topology.


## Public SaaS rules

There is no platform-wide Admin role. Any new user can create a house and becomes Admin of that house. Users joining someone else's house are Members. SHREESHANT is an Admin only when using the SHREESHANT account to create/manage his own house; other creators get the same Admin capabilities for their own houses.

## Backend schema fix (v5.0.1)
If you previously saw `Invalid schema configuration: true is not a valid type at path createdAt`, update to v5.0.1 and run:

```powershell
cd backend
npm install
npm run check-schema
npm run indexes
npm run dev
```

Mongoose timestamps are configured with the schema option `{ timestamps: true }`.

## Member sidebar and profiles (v5.0.3)

Normal Members can access: Today's House, My Tasks, Expenses, Groceries, Meal Planner, Availability & Leave, House Board, Maintenance, House Inventory, Fairness Analytics, and My Profile.

Members do not get navigation for: 7-Day Rotation, WhatsApp & Notifications, Members, or Settings. The sensitive actions remain backend-protected with Admin middleware.

Every authenticated house member can open House Profiles and view other members. A member can edit only their own profile: name, WhatsApp/mobile number, email, profile photo, availability, preferred/avoided chores, and password. Changing email clears the verified state and starts a new verification flow.

Email verification uses the Resend HTTP API when `RESEND_API_KEY` and `MAIL_FROM` are configured. Without those settings in local development, the server logs a verification URL so the flow can still be tested locally.

The Admin Invite button opens an active invitation modal with the live invite code, join URL, copy controls, and share controls.

## v5.0.5 — Final UX additions

### Profile photo crop
Members can choose a photo, open the crop editor, drag/reposition the image, adjust zoom, and save a square cropped image. The cropped result is compressed and persisted through the backend profile endpoint.

### Monthly expenses
House expenses are separated by calendar month. The current month is the active ledger; completed previous months are stored in `ExpenseArchive`. The previous month is archived automatically by the daily job, and Admin can manually archive a completed previous month. New months start with a clean current-month total while old months remain available in the archive.


## v6.0 security + push notifications

The v6 build adds Firebase Cloud Messaging (FCM) as the primary push channel, a Security page, device-token registration, session revocation, request IDs, Helmet, CORS allowlisting, compression, authentication rate limiting and configurable API rate limiting. FCM is disabled until the Firebase web keys and backend service-account credentials are configured.

### Firebase setup
1. Create a Firebase project and a Web App.
2. Enable Cloud Messaging and generate a Web Push certificate/VAPID key.
3. Put the public web config and VAPID key in `frontend/.env`.
4. Put the Firebase service-account project ID, client email and private key in the backend/worker/cron environment.
5. Run `npm run prepare-fcm` or use `npm run dev` / `npm run build`, which generates the service worker automatically.

Example frontend values:

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

Example backend values:

```env
FCM_ENABLED=true
FCM_PROJECT_ID=...
FCM_CLIENT_EMAIL=...
FCM_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
API_RATE_LIMIT=1200
API_RATE_WINDOW_MS=60000
AUTH_RATE_LIMIT=15
AUTH_RATE_WINDOW_MS=900000
```

### Scaling
The Render Blueprint keeps the API at 2 web instances behind Render's load balancer. The API is stateless and MongoDB is the source of truth; the worker and cron services handle background work. Render documents that scaled incoming-traffic services are load balanced across instances and can be manually scaled up to 100 instances.

### Capacity note
The included `ops/load-test.mjs` can send 1,000 health requests with configurable concurrency. A successful 1,000-request smoke test is not a guarantee of 1,000 sustained authenticated users; actual capacity depends on instance resources, database workload, network latency and request mix.

## v6.2 realistic cinematic startup

The app now opens with a short cinematic sequence built from individual household activity scenes rather than a static collage. Five scenes crossfade automatically, each with a slow camera/zoom move, subtle haze, film grain and particles. The user can tap scene indicators or Start to enter authentication.

The startup sequence is implemented locally in React/CSS and requires no video library. It respects `prefers-reduced-motion`.
