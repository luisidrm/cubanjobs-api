# Brújula — roadmap

Covers all three projects: `back` (API), `front` (web), `mobile` (Expo app).
Effort: S = under a day, M = 1–3 days, L = a week or more.

## Done

- Landing page, plans, Transfermovil payments, company teams, freelancer posts, admin metrics.
- Mobile polish pass: inputs, permissions, translations, keyboard handling, dead code removed.
- **Safety net:** mobile work committed; `npm audit fix` on the API and web (API 17 → 4 production vulnerabilities, the rest is `minio` with no safe upgrade); startup config check (`src/lib/checkEnv.ts`).
- **Lists:** jobs newest first with stable paging; real offset paging ("load more" / infinite scroll) on every list in web and mobile; uploads verified by file content.
- **SEO and web polish:** per-job title, description, canonical, share tags and schema.org JobPosting data; `sitemap.xml`, `robots.txt`, default share image; web lint at 0 errors.
- **Confidence:** structured logger replaces every `console` call in the API; tests for saved jobs, notifications, work experience, uploads, job ordering, logger (138 API tests); fixed saving a job twice returning a 500.
- **WhatsApp:** share button on jobs and companies (web + mobile); employers can add a WhatsApp number to a job with a "Contact on WhatsApp" button; one link helper adds Cuba's 53 to local numbers.
- **Repos and Sentry projects:** all three repos are on GitHub (`cubanjobs-api`, `cubanjobs-front`, `cubanjobs-mobile`) with `main` up to date; Sentry projects `cubanjobs-api`, `cubanjobs-web`, `cubanjobs-mobile` exist and API and web test errors were confirmed. DSNs live in each repo's local `.env` only.
- **Sentry (code ready, off until a DSN is set):** API (`SENTRY_DSN`), web (`NEXT_PUBLIC_SENTRY_DSN`), mobile (`EXPO_PUBLIC_SENTRY_DSN`). Cookies, headers and request bodies are stripped before sending.
- **Trust and safety:** report button on jobs, companies and freelancer posts with an admin queue; verified-company badge on job cards and detail; postings that ask for money up front are warned and auto-filed for review; unverified companies can create at most 5 jobs per day.
- **Mobile on Expo SDK 58** (React Native 0.88). Needs Node 22.13+; not yet tried on a device.

## Still open

| # | Item | Effort |
|---|------|--------|
| 1 | Sentry: add the `@sentry/react-native` plugin to `app.json` and an auth token (`SENTRY_AUTH_TOKEN`, never committed) so production stack traces from web and mobile are readable (source maps); set the three DSNs in the production environment and a lower `SENTRY_TRACES_SAMPLE_RATE` | S |
| 3 | Legal pages (terms, privacy), account-deletion page for the stores | S |
| 4 | Tests for `companies` (ownership rules), `plans`, `tags`, and HTTP-level route tests (auth and roles) | M |
| 5 | Web `<img>` to `next/image` (27 lint warnings): needs the image host (MinIO / CDN) configured in `next.config.ts` once the deploy host is chosen | S |
| 6 | Mobile: patch-version alignment (`npx expo install --fix`, six packages behind), https app links for emailed links, EAS placeholders in `eas.json`, store listings | M |
| 7 | `minio` advisory: revisit when a non-downgrade fix ships | S |
| 8 | Set `EXPO_PUBLIC_WEB_URL` in the mobile build profiles so shared links point at the real website | S |
| 9 | Staging deploy + smoke test; decide web hosting | M |

## Ideas, in the order I'd build them

Chosen for how people in Cuba actually use the internet: WhatsApp-first, expensive and slow data, many people without a CV, scams as the main fear.

### Growth and reach
1. ~~**Share on WhatsApp (S).**~~ Done. A share button on jobs, companies and freelancer posts with a clean link preview (needs item 2 above). Likely the cheapest growth lever.
2. ~~**Apply or contact by WhatsApp (S).**~~ Done for jobs. Employers who don't read email get a "contact on WhatsApp" option; the freelancer posts already store a WhatsApp contact.
3. **Referrals (M).** "Invite a friend" link; a free week of a paid plan when they finish onboarding.
4. **Public profile link (S).** A shareable `/u/name` page for workers and freelancers (opt-in).

### Trust and safety
5. ~~**Report button + admin queue (M).**~~ Done for jobs, freelancer posts and companies (not user profiles).
6. ~~**Verified company badge (M).**~~ Done. Verified identity for people is still open.
7. ~~**Scam guardrails (S).**~~ Done. The upfront-payment check is simple text matching (Spanish and English); tune it from what shows up in the queue.

### Hiring flow
8. ~~**Applicant pipeline (M).**~~ Done: pending, reviewed, interview, accepted or rejected, with per-stage filters and a notification, email and push at each step. Original note: Stages (new → interview → hired / rejected) with a push notification and email at each step.
9. **Skill match score (M).** "You match 4 of 6 skills" on a job; ranked applicants for employers. Skills are already stored.
10. **Job alerts (M).** Save a search; push and email when a new job matches. The notification queue already exists.
11. **Interview scheduling (M).** Employer proposes times; worker confirms; reminder push.
12. **Quick apply (S).** One tap apply with the saved profile and CV; optional short note.

### Workers and freelancers
13. **CV builder (M).** Generate a PDF CV from the profile for people without one.
14. **Portfolio and ratings for freelancers (L).** Images already exist; add short reviews from companies that hired them.
15. **Featured post / boosted job (M).** A paid extra within a plan; fits the existing plans and payments model.

### Money
16. **More payment methods (M).** EnZona and a manual USD option for diaspora employers, next to Transfermovil.
17. **Plan expiry reminders (S).** Already partly built in `planMaintenance`; add an in-app banner.

### Quality of experience
18. **Low-data mode (M).** Smaller images, text-first lists, last-seen list cached for offline reading, an offline banner.
19. **Employer analytics (M).** Views, applications and conversion per job from the view counters already tracked.
20. **In-app chat (L).** Only after the pipeline exists; start with templated messages.

## Suggested order

1. Applicant pipeline and job alerts (ideas 8, 10): what makes people come back.
2. Legal pages, staging deploy, store submission.
3. Source maps and production DSNs for Sentry, then the rest by demand.
