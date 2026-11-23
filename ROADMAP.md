# Brújula — roadmap

Covers all three projects: `back` (API), `front` (web), `mobile` (Expo app).
Effort: S = under a day, M = 1–3 days, L = a week or more.

## Done

- Landing page, plans, Transfermovil payments, company teams, freelancer posts, admin metrics.
- Mobile polish pass: inputs, permissions, translations, keyboard handling, dead code removed.
- **Step 1 (safety net):** mobile committed; `npm audit fix` on the API (17 → 4 production vulnerabilities; the rest is `minio`, no safe upgrade); startup config check (`src/lib/checkEnv.ts`).
- **Step 2 (lists):** jobs listed newest first with stable paging; "load more" / infinite scroll on every list in web and mobile (jobs, workers, freelancer posts); uploads verified by file content, not the declared type.

## Still open from the audit

| # | Item | Effort |
|---|------|--------|
| 1 | Create a remote for `front` (it has none, so it only exists on one machine) and push all three repos | S |
| 2 | Job page SEO: server-render `/jobs/[id]` with per-job title/description, `sitemap`, `robots`, share image | M |
| 3 | Web lint: run `biome check --write` (69 formatting/import-order errors), fix 7 accessibility errors, move 20 `<img>` to `next/image` | S |
| 4 | Tests for the modules with none: payments, companies, notifications, savedJobs, plans, tags, workExperience | M |
| 5 | Sentry on API, web, mobile; replace the 33 `console.*` calls with a logger | M |
| 6 | Legal pages (terms, privacy), account-deletion page for the stores | S |
| 7 | `minio` advisory: revisit when a non-downgrade fix ships | S |
| 8 | Mobile: https app links for emailed links; EAS placeholders in `eas.json`; store listings | M |
| 9 | Staging deploy + smoke test; decide web hosting | M |

## Ideas, in the order I'd build them

Chosen for how people in Cuba actually use the internet: WhatsApp-first, expensive and slow data, many people without a CV, scams as the main fear.

### Growth and reach
1. **Share on WhatsApp (S).** A share button on jobs, companies and freelancer posts with a clean link preview (needs item 2 above). Likely the cheapest growth lever.
2. **Apply or contact by WhatsApp (S).** Employers who don't read email get a "contact on WhatsApp" option; the freelancer posts already store a WhatsApp contact.
3. **Referrals (M).** "Invite a friend" link; a free week of a paid plan when they finish onboarding.
4. **Public profile link (S).** A shareable `/u/name` page for workers and freelancers (opt-in).

### Trust and safety
5. **Report button + admin queue (M).** On jobs, posts and profiles; needed before the platform is public.
6. **Verified badges (M).** Verified company (admin checks), verified identity, and verified email already exists. Shows on cards.
7. **Scam guardrails (S).** Warn when a posting asks for payment up front; rate limit new accounts that post many jobs.

### Hiring flow
8. **Applicant pipeline (M).** Stages (new → interview → hired / rejected) with a push notification and email at each step.
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

1. Remote + push, then the SEO item and web lint (finish the audit).
2. WhatsApp sharing and contact (ideas 1–2): small and high impact.
3. Sentry + tests for payments (items 4–5): before real money moves.
4. Report button and verified companies (ideas 5–6): before opening to the public.
5. Applicant pipeline and job alerts (ideas 8, 10): what makes people come back.
6. Staging deploy, store submission, then the rest by demand.
