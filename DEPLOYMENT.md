# Production deployment

Recommended topology:

```text
                    Public HTTPS
                         |
                 Vercel / CDN
                         |
                React SPA (frontend)
                         |
             +-----------+-----------+
             |                       |
        API instance 1         API instance 2+
             |                       |
             +-----------+-----------+
                         |
                  MongoDB Atlas
                         |
             +-----------+-----------+
             |                           |
       Worker instance(s)          Daily Cron Job
             |
         Twilio WhatsApp
```

## Render

Create a Web Service from `/backend`, then manually scale it to 2 instances to start. Render load-balances incoming traffic across running instances and supports manual scaling up to 100 instances.

Create a Background Worker using `/backend` with command `npm run worker`.

Create a Cron Job using `/backend` with command `npm run cron-daily` and schedule `30 0 * * *` for 06:00 Asia/Kolkata (Render cron schedules are UTC).

Do not use a persistent disk for the horizontally scaled web service.

## Vercel

Deploy `/frontend` as a Vite app and set:

`VITE_API_URL=https://YOUR-BACKEND-DOMAIN.onrender.com/api`

## MongoDB Atlas

Use a dedicated or appropriately sized production cluster, a least-privilege database user, and strict network access rules. Configure Resend for email verification (`RESEND_API_KEY`, `MAIL_FROM`) and keep Twilio/DB/JWT secrets only in the host secret store. Add indexes defined in the models and monitor slow queries.

## Secrets

Never commit `.env`, Twilio credentials, or database passwords. Set secrets in the hosting provider's environment variables.
