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
