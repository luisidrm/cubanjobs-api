# Cuban Jobs — Backend

Node.js ESM + TypeScript + Express 5 API for the Cuban Jobs platform. Postgres via Drizzle ORM, self-hosted SuperTokens for auth, MinIO (S3-compatible) for file storage, Redis + BullMQ for background notification delivery.

## Local development

1. Copy `.env.example` to `.env` and fill in the values (the Docker-related ones — `POSTGRES_PASSWORD`, `SUPERTOKENS_API_KEY`, `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` — just need to be *some* value, they're not shared with anyone outside your machine).
2. Start the support services (Postgres, SuperTokens core, Redis, MinIO):
   ```
   docker compose up -d
   ```
3. Install dependencies and run migrations:
   ```
   npm install
   npm run db:migrate
   ```
4. Start the API:
   ```
   npm run dev
   ```
   The server listens on `PORT` (default `5000`). `GET /health` should return `200`.
5. (Optional) Seed sample data: `npm run seed`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Runs the API with hot reload (`tsx watch`). |
| `npm start` | Runs the API as production would (no reload) — used by the Docker image. |
| `npm run build` | Typechecks and emits compiled output to `dist/` (not used at runtime — `start` runs TypeScript directly via `tsx`). |
| `npm run db:generate` | Generates a new Drizzle migration from schema changes in `db/schema/`. |
| `npm run db:migrate` | Applies pending migrations. |
| `npm run seed` | Populates the database with sample users/jobs for local testing. |

## Deploying

See [DEPLOY.md](./DEPLOY.md) for the AWS deployment guide.

## Plans and Transfermóvil payments

Employees pay to apply to jobs; employers pay for Basic or Pro. Payment is a Transfermóvil transfer that the user reports and an admin approves (Stripe still works for companies). Prices, limits and the payment destination are database rows, not code.

| Endpoint | Who | What |
|---|---|---|
| `GET /api/v1/plans?audience=` | public | Active plans with their per-duration prices (CUP) |
| `GET /api/v1/plans/payment-destination` | signed in | Card/phone/holder and instructions to show on the pay screen |
| `POST /api/v1/payments` | employee, employer | `multipart/form-data`: `planCode`, `months`, `transferNumber` (required), `companyId` (employers), `screenshot` (optional image) |
| `GET /api/v1/payments/mine` | signed in | The user's payment history and statuses |
| `GET /api/v1/admin/payments?status=` | admin | Review queue (pending is oldest first); `meta.pending` is the count |
| `GET /api/v1/admin/payments/:id` | admin | Detail with a 10-minute signed screenshot URL and the account's current plan |
| `POST /api/v1/admin/payments/:id/approve` · `/reject` (`{ reason }`) | admin | Grants the plan (months stack on the current expiry) or refuses it; the user is notified by app, push and email |
| `GET /api/v1/admin/accounts/search?q=` · `/accounts/expiring?days=` | admin | Find an account; list plans ending soon |
| `PUT /api/v1/admin/accounts/user/:id/plan` · `/company/:id/plan` | admin | Set a plan by hand (`expiresAt` null = no expiry); logged |
| `GET /api/v1/admin/accounts/user/:id/history` · `/company/:id/history` | admin | Plan change log |
| `GET /api/v1/admin/plans`, `PATCH /plans/:id`, `PUT /plans/:id/prices/:months` | admin | Edit plans, limits and prices |
| `GET/PUT /api/v1/admin/payment-settings` | admin | Transfermóvil destination, instructions, reminder lead time |

Rules: applying to a job answers `402` with `details.code = "PLAN_REQUIRED"` until the employee has an active paid plan. A daily job (09:00 America/Havana) warns accounts N days before expiry (setting `reminder_days_before`, default 3) and moves lapsed Transfermóvil/manual plans to Free. Stripe-managed plans are left to Stripe's webhooks. Resend must have a verified sending domain (`EMAIL_FROM`) for emails to reach users.

## Company teams, directory and job images

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/v1/companies` | public | Directory: `q`, `industry`, `location`, `limit`, `offset`; most open jobs first |
| GET | `/api/v1/companies/:id` | public | Public profile + `openJobs`. Billing/Stripe fields are not exposed |
| GET | `/api/v1/companies/my` | employer | Your companies with `memberRole`; renewal dates only for the owner |
| GET | `/api/v1/companies/:id/team` | member | Members, seats used / limit, live invite code (owner only) |
| POST | `/api/v1/companies/:id/invite` | owner | New join code (7 days); replaces the previous one |
| DELETE | `/api/v1/companies/:id/invite` | owner | Revoke the live code |
| POST | `/api/v1/companies/join` | employer (verified) | `{ code }`. 404 invalid/expired, 409 already member, 403 `SEAT_LIMIT_REACHED` |
| DELETE | `/api/v1/companies/:id/team/:userId` | owner, or yourself | Remove a member / leave. The owner can't be removed |
| POST / DELETE | `/api/v1/uploads/job-image/:jobId` | member | Optional cover image (jpeg/png/webp, 5 MB) |
| GET | `/api/v1/jobs?companyId=` | public | Open jobs of one company |

Seat limits (owner included) live in `plans.seat_limit`: Free 1 (code constant), Basic 3, Pro unlimited. Members share the company's plan; only the owner can manage team, billing/payments and delete the company. Migration `0010_company_teams.sql`.

## Freelancer posts

Paying employees can publish up to 3 freelance offers (title, description, optional link, at least one contact method, up to 5 photos). They are visible to paying employees, members of a Basic/Pro company and admins. The only metric is the number of distinct viewers (the author never counts). Migration `0011_freelancer_posts.sql`.

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/api/v1/freelancer-posts?q=&limit=&offset=` | paid employee, paid company member, admin | Cards without contact details; posts whose author's plan lapsed are hidden. 402 `PLAN_REQUIRED` otherwise |
| GET | `/api/v1/freelancer-posts/:id` | same, or the author | Full post with contact details; counts one view per viewer |
| GET | `/api/v1/freelancer-posts/mine` | employee | Your posts |
| POST | `/api/v1/freelancer-posts` | paid employee | 402 without a plan, 409 `POST_LIMIT_REACHED` at 3 posts |
| PATCH / DELETE | `/api/v1/freelancer-posts/:id` | author (admins may moderate) | Someone else's post answers 404 |
| POST | `/api/v1/freelancer-posts/:id/images` | author | `multipart/form-data` `file` (jpeg/png/webp, 5 MB); 409 `IMAGE_LIMIT_REACHED` at 5 |
| DELETE | `/api/v1/freelancer-posts/:id/images?url=` | author | Removes one photo |

