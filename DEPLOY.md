# Deploying to AWS

This guide walks through deploying the API to AWS using **App Runner** (a managed container service — it handles HTTPS, load balancing, and scaling for you, so you don't need to hand-build a VPC/ALB/ECS setup). It assumes no prior AWS experience beyond having an account.

## Architecture

```
                        ┌─────────────────────┐
  Mobile app  ───────▶  │  App Runner: api     │  ───────▶  RDS Postgres
                        │  (this repo's image) │            (app_db + supertokens_db)
                        └──────────┬───────────┘  ───────▶  ElastiCache Redis
                                   │                ───────▶  S3 (public + private buckets)
                                   ▼
                        ┌──────────────────────┐
                        │ App Runner:           │
                        │ supertokens-core       │
                        └──────────┬────────────┘
                                   ▼
                              (same RDS instance,
                               supertokens_db)
```

Both App Runner services connect to RDS/ElastiCache through a **VPC connector** (App Runner runs outside any VPC by default; the connector gives it access to resources inside one).

**Simplification for this MVP stage**: RDS and ElastiCache are placed in your account's **default VPC**, with security groups restricting inbound access to only the App Runner VPC connector's security group — rather than building a dedicated VPC with public/private subnets. This is a reasonable MVP tradeoff (fewer moving parts to get wrong on a first deploy); revisit with a dedicated VPC if/when this needs to be hardened further.

## Prerequisites

- An AWS account, and the [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed and configured (`aws configure`) with credentials that can create RDS/ElastiCache/S3/ECR/App Runner/IAM/Secrets Manager resources.
- Docker installed locally (to build and push the image).
- Your Resend API key and a `SUPERTOKENS_API_KEY` value (any long random string — must match between the two App Runner services).

## 1. RDS Postgres

Create a small Postgres instance (`db.t4g.micro` is plenty for MVP scale) in the default VPC. Note the endpoint, port (5432), master username/password once created.

Once it's reachable, connect (e.g. via `psql` from your machine, or an EC2 bastion if the security group doesn't allow your IP) and create the two databases:

```sql
CREATE DATABASE app_db;
CREATE DATABASE supertokens_db;
```

Security group: allow inbound Postgres (5432) **only** from the App Runner VPC connector's security group (created in step 7) — not from `0.0.0.0/0`.

## 2. ElastiCache Redis

Create a small Redis instance (`cache.t4g.micro`) in the default VPC, same security-group pattern (inbound only from the App Runner VPC connector's security group). Note the primary endpoint.

## 3. S3 (file storage)

Create two buckets (names must be globally unique, e.g. `cuban-jobs-public-<your-suffix>` / `cuban-jobs-private-<your-suffix>`):

```
aws s3api create-bucket --bucket cuban-jobs-public-<suffix> --region <your-region>
aws s3api create-bucket --bucket cuban-jobs-private-<suffix> --region <your-region>
```

The **public** bucket needs "Block Public Access" disabled (the app sets a public-read bucket policy on startup via `ensureBucket()` in `src/lib/minio.ts`, which will otherwise fail):

```
aws s3api put-public-access-block --bucket cuban-jobs-public-<suffix> \
  --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false
```

Leave the **private** bucket's Block Public Access settings on (the default) — nothing in the app tries to make it public.

Create an IAM user (`cuban-jobs-api`) with an access key, scoped to just these two buckets:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::cuban-jobs-public-<suffix>",
        "arn:aws:s3:::cuban-jobs-public-<suffix>/*",
        "arn:aws:s3:::cuban-jobs-private-<suffix>",
        "arn:aws:s3:::cuban-jobs-private-<suffix>/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutBucketPolicy", "s3:GetBucketPolicy"],
      "Resource": "arn:aws:s3:::cuban-jobs-public-<suffix>"
    }
  ]
}
```

The second statement is only needed because `ensureBucket()` sets the public-read policy itself on startup — if you'd rather not grant that, set the bucket policy manually once via the console and drop this statement.

## 4. ECR (container registry) + build/push the image

```
aws ecr create-repository --repository-name cuban-jobs-api

# From the back/ directory:
aws ecr get-login-password --region <your-region> | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<your-region>.amazonaws.com
docker build -t cuban-jobs-api .
docker tag cuban-jobs-api:latest <account-id>.dkr.ecr.<your-region>.amazonaws.com/cuban-jobs-api:latest
docker push <account-id>.dkr.ecr.<your-region>.amazonaws.com/cuban-jobs-api:latest
```

The SuperTokens core doesn't need a custom image — App Runner can pull `registry.supertokens.io/supertokens/supertokens-postgresql:latest` directly (same image `docker-compose.yml` uses locally).

## 5. Secrets Manager

Store the sensitive values as secrets (App Runner references these by ARN rather than plain env vars):

```
aws secretsmanager create-secret --name cuban-jobs/database-url --secret-string "postgresql://<user>:<password>@<rds-endpoint>:5432/app_db"
aws secretsmanager create-secret --name cuban-jobs/supertokens-api-key --secret-string "<your-random-string>"
aws secretsmanager create-secret --name cuban-jobs/resend-api-key --secret-string "<your-resend-key>"
aws secretsmanager create-secret --name cuban-jobs/s3-access-key --secret-string "<iam-user-access-key-id>"
aws secretsmanager create-secret --name cuban-jobs/s3-secret-key --secret-string "<iam-user-secret-access-key>"
```

## 6. VPC connector

Console: **App Runner → VPC connectors → Create**. Select the default VPC and the security group you set up in steps 1–2 (the one RDS/ElastiCache allow inbound from).

## 7. App Runner: SuperTokens core

Console: **App Runner → Create service → Container registry → Amazon ECR public** (or search for `supertokens/supertokens-postgresql`). Configure:
- Port: `3567`
- Environment variables:
  - `POSTGRESQL_CONNECTION_URI` = `postgresql://<user>:<password>@<rds-endpoint>:5432/supertokens_db`
  - `API_KEYS` = the same value as the `cuban-jobs/supertokens-api-key` secret above
- Networking: attach the VPC connector from step 6.

Once deployed, note this service's App Runner URL — the API needs it as `SUPERTOKENS_URL`.

## 8. App Runner: the API

Console: **App Runner → Create service → Container registry → Amazon ECR** → select the `cuban-jobs-api` repository pushed in step 4.
- Port: `5000`
- Networking: attach the same VPC connector.
- Environment variables (plain):
  - `PORT=5000`
  - `DATABASE_SSL=true`
  - `SUPERTOKENS_URL` = the SuperTokens core App Runner URL from step 7
  - `API_DOMAIN` = this service's own App Runner URL (you'll know it after the first deploy — update and redeploy once you do)
  - `WEBSITE_DOMAIN` / `APP_DOMAIN` = your actual frontend origins (the mobile app's scheme/dev URL, and any web frontend)
  - `MINIO_ENDPOINT=s3.<your-region>.amazonaws.com`, `MINIO_PORT=443`, `MINIO_USE_SSL=true`, `MINIO_REGION=<your-region>`
  - `MINIO_PUBLIC_BUCKET=cuban-jobs-public-<suffix>`, `MINIO_PRIVATE_BUCKET=cuban-jobs-private-<suffix>`
  - `MINIO_PUBLIC_URL=https://cuban-jobs-public-<suffix>.s3.<your-region>.amazonaws.com`
  - `REDIS_URL` = `redis://<elasticache-endpoint>:6379` (or `rediss://` if you enabled in-transit encryption). Also holds the rate-limit counters, so every API instance shares them
  - `STRIPE_ENABLED=false` (Stripe is hidden; see the Stripe section below)
- Environment variables (from Secrets Manager — reference each secret's ARN):
  - `DATABASE_URL` ← `cuban-jobs/database-url`
  - `SUPERTOKENS_API_KEY` ← `cuban-jobs/supertokens-api-key`
  - `RESEND_API_KEY` ← `cuban-jobs/resend-api-key`
  - `EMAIL_FROM` = your verified Resend sender
  - `MINIO_ACCESS_KEY` ← `cuban-jobs/s3-access-key`
  - `MINIO_SECRET_KEY` ← `cuban-jobs/s3-secret-key`
- Health check path: `/health`.

## 9. Run migrations

Migrations aren't automated yet (see the roadmap's Stage 6 for CI/CD). Run them once against the RDS instance from your machine (or any host that can reach it) using the same image:

```
docker run --rm \
  -e DATABASE_URL="postgresql://<user>:<password>@<rds-endpoint>:5432/app_db" \
  -e DATABASE_SSL=true \
  <account-id>.dkr.ecr.<your-region>.amazonaws.com/cuban-jobs-api:latest \
  npm run db:migrate
```

Run this again after every deploy that includes a new migration.

Then load the skills catalog (English names plus their Spanish names) once, with the same image and variables but the command `npm run db:seed-skills`. It is safe to repeat and also refreshes the Spanish names after an update.

## 10. Web app (Next.js)

The web app lives in the `front` repo and runs on either target. Both need the same four values:

| Variable | When | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | **build** | The API's public URL, e.g. `https://api.example.com`. Baked into the browser bundle, so changing it means rebuilding. |
| `NEXT_PUBLIC_SITE_URL` | **build** | The web app's own public URL. |
| `SUPERTOKENS_CORE_URL` | runtime | The SuperTokens core URL from step 7. Used by the server-side route guard (`proxy.ts`), never sent to the browser. |
| `SUPERTOKENS_API_KEY` | runtime | Same value as the core's `API_KEYS`. Keep it in a secret store. |

Optional: `NEXT_PUBLIC_STRIPE_ENABLED` (build-time, default `false`) shows Stripe checkout and the billing portal. Leave it off while Stripe is hidden, and keep `STRIPE_ENABLED` off on the API too.

**Option A: AWS App Runner (same as the API).** Build and push the image, passing the build-time values:

```
docker build -t brujula-web \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_SITE_URL=https://example.com \
  front
```

Push it to ECR (as in step 4), create an App Runner service for it with port `3000`, health check path `/`, and the two runtime variables above. It does **not** need the VPC connector; it only talks to the public API and to the SuperTokens core URL.

**Option B: Vercel.** Import the `front` repository, set all four variables in the project settings (the first two are used at build time), and deploy. No Dockerfile is used.

Whichever you choose, set the API's `WEBSITE_DOMAIN` to the web app's public origin so CORS and emailed links point at it. Keep the web app and the API on subdomains of the same registrable domain (for example `app.example.com` and `api.example.com`). SuperTokens then issues same-site cookies. On unrelated domains it has to fall back to `SameSite=None`, which needs HTTPS and is increasingly blocked by browsers (Safari in particular), so sessions become unreliable.

## 11. Mobile app (Expo / EAS)

Identity: bundle ID and Android package `com.luisidrm.brujula`, URL scheme `brujula`.

1. `eas build:configure` once, then set the API URL for each build profile in `mobile/eas.json` (`EXPO_PUBLIC_API_URL`). Release builds **refuse to start** if it is missing, still a `REPLACE_WITH_...` placeholder, or points at localhost, so a wrong value fails loudly instead of shipping an app that talks to nothing.
2. `eas build --platform android --profile production` (AAB for Google Play) and `--platform ios --profile production`. Use `--profile preview` for an installable APK to test with.
3. `eas submit` uses the `submit` section of `eas.json`. Fill in the Play service-account key path and the App Store Connect app ID first.
4. The EAS project is still registered under the slug `mobile`. Changing the slug in `app.json` requires renaming the project on expo.dev first, otherwise EAS refuses to build.

**Emailed links (password reset, email verification).** For the mobile app the API builds these from `APP_DOMAIN`. A custom scheme such as `brujula://` is not clickable in Gmail and most mail apps, so before launch use an `https://` link that opens the app (Android App Links and iOS Universal Links), or send mobile users through a web page that redirects to `brujula://`. This is not set up yet.

## Stripe

Stripe is hidden for now. The checkout and portal endpoints answer `404` unless `STRIPE_ENABLED=true`; the web and mobile screens hide the Stripe buttons unless their own flags are on. Payments go through Transfermóvil approved by an admin. To bring Stripe back, turn on all three flags together and configure the `STRIPE_*` keys and webhook.

## Updating a deployment

1. Rebuild and push a new image tag (repeat step 4).
2. Run migrations if the change includes any (step 9).
3. In App Runner, trigger a new deployment of the `cuban-jobs-api` service (or enable auto-deploy on image push).

## Env var reference

All variables the app reads, and whether local `.env.example` documents a value for local dev — see [.env.example](./.env.example) for the full list with local defaults. In production, `DATABASE_SSL`, `MINIO_ENDPOINT`/`MINIO_PORT`/`MINIO_USE_SSL`/`MINIO_REGION`, and the domain/API-key values above all need production values as described in step 8.
