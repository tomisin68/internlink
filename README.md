# InternLink

Recruiter & intern talent marketplace. Monorepo covering the web app (PWA), the
core API, and the shared contracts between them.

Built against `docs/srs/InternLink_SRS_v1_1.md`. Where this codebase departs
from the SRS, the reason is written down — either in this file or in a comment
at the point of departure.

---

## What exists today

| Area | State |
|---|---|
| Design system (Violet Aurora tokens, light + dark) | Done |
| Shared contracts (Zod schemas → TS types) | Done |
| Onboarding carousel → auth → role selection → profile wizards | Done |
| PWA: manifest, service worker, offline shell, update prompt | Done |
| API: auth, role switching, profiles, companies, uploads | Done |
| **Match algorithm (FR-204)** — scoring + explainability, 28 tests | Done |
| **Feed ranking (FR-1007)** — affinity × engagement × decay, 19 tests | Done |
| **Scam auto-flagging (FR-1101)** — 25 tests | Done |
| **Messaging (FR-501–509)** — threads, requests, mute, block | API + UI |
| **Connections & follows (FR-1006)**, blocks, reports (FR-702) | API only |
| **Posts, reactions, comments** | API + feed UI |
| Notification event emission (FR-601/604) | Emits; no consumer yet |
| Daily outreach quotas (FR-1102) | Done, Firestore-backed |
| App shell: bottom nav (mobile) + rail (desktop) | Done |
| Feed screen, matches screen, inbox, thread view | Done |
| Roles: browse + filters, detail, one-tap apply (FR-203/401) | Done |
| Applications tracker (intern) + pipeline board (recruiter) | Done |
| Role composer with the FR-302 publish gate | Done |
| Network: connections, requests, follows | Done |
| Profile view/edit + theme settings | Done |
| Realtime messaging via Firestore listeners | Done |
| Firestore rules + composite indexes (deployed) | Done |
| Notifications service, ads engine, admin console, Flutter app | Not started |

**72 tests pass** (`npm test -w @internlink/api`). They cover the ranking and
moderation logic only — everything there is pure, with an injected clock and no
Firestore. Route and service layers have no tests yet.

---

## Getting it running

```bash
npm install

# API
cp apps/backend/api/.env.example apps/backend/api/.env
# fill in FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY

# Web
cp apps/web/.env.example apps/web/.env.local
# fill in the VITE_FIREBASE_* values from the same Firebase project

npm run dev          # API on :4000, web on :5173
```

`npm run dev` builds the shared packages first — `@internlink/api` and
`@internlink/web` both import `@internlink/shared-types` from its build output,
so a cold clone must compile it before either app can resolve the import.

Without Firebase credentials the API still boots and serves `/v1/health`
(reporting `degraded`), and the web app renders with a banner explaining what is
missing. That is deliberate: a fresh clone should show you something.

### Other commands

```bash
npm run build            # everything, in dependency order
npm run typecheck        # all workspaces
npm run icons -w @internlink/web   # regenerate PWA icons from the SVG mark
```

---

## Deployment

Three pieces, three places:

| Piece | Host | Trigger |
|---|---|---|
| Web app (PWA) | Firebase Hosting | `npm run deploy:hosting`, or push to `main` |
| Firestore rules + indexes | Firebase | `npm run deploy:rules` (manual, on purpose) |
| API | Render (`render.yaml`) | push to `main` — `autoDeploy: true` |

**Live:** https://intern-project-38829.web.app · project `intern-project-38829`

Firestore rules and indexes are deployed and the database is created. Rules
deploy is kept off the automatic path deliberately: a bad ruleset locks every
user out the instant it lands, and that is not something a routine push should
be able to do. The GitHub workflow only ships rules on a manual
`workflow_dispatch` with the box ticked.

### GitHub Actions Firebase secret

The deploy workflow needs a Firebase service-account JSON in GitHub Actions.
Run this locally once:

```bash
firebase init hosting:github
```

Choose project `intern-project-38829` and let the Firebase CLI create the
GitHub secret. The expected secret name is
`FIREBASE_SERVICE_ACCOUNT_INTERN_PROJECT_38829`. If you create it manually
instead, add a repository secret with that name under GitHub → Settings →
Secrets and variables → Actions → Secrets, and paste the full service-account
JSON.

### Finishing the API deploy

The API is not live yet — three steps, and the middle one is the easy one to
forget:

1. **Render** → New → Blueprint → point at this repo. `render.yaml` defines the
   service. Fill in the `sync: false` secrets in the dashboard: the Firebase
   service-account email and private key, Cloudinary, Resend.
   The private key goes in as a single line with literal `\n` escapes — a key
   with real line breaks will not parse.

2. **Point the web app at it.** In GitHub → Settings → Secrets and variables →
   Actions → Variables, set `VITE_API_BASE_URL` to
   `https://<your-service>.onrender.com/v1`, plus the `VITE_FIREBASE_*` values.
   Until this is set, the deployed app signs in (Firebase Auth is client-side)
   and then stalls at the session exchange, because it is still calling
   `/api/v1` on the Hosting domain where nothing answers.

3. **Let the API accept it.** Add both Hosting domains to `CORS_ORIGINS` on
   Render — `https://intern-project-38829.web.app` and
   `https://intern-project-38829.firebaseapp.com`. No trailing slashes; the
   check is an exact string match.

Then push to `main`: Render rebuilds the API, and the deploy workflow rebuilds
and ships the web app with the right API URL baked in.

### Firebase Storage is not set up

Deliberate. Media goes to Cloudinary (§7.1), so Storage has never been
provisioned — and leaving the block in `firebase.json` makes a plain
`firebase deploy` fail. `storage.rules` stays in the repo so that if Storage is
ever switched on it starts closed rather than open; re-enabling it means
clicking Get Started in the console and restoring the `storage` key.

---

## Layout

```
internlink/
├── apps/
│   ├── web/                 Vite + React 19 + Tailwind v4, PWA
│   └── backend/api/         Express 5 + Firebase Admin + Zod
├── packages/
│   ├── shared-types/        Zod schemas — the single contract
│   └── design-tokens/       Colour, type, spacing, motion
└── docs/srs/                The SRS this is built against
```

`apps/admin` and `apps/backend/notifications` are in the SRS layout but not yet
created — there is nothing to put in them.

---

## Decisions that differ from the SRS

**Palette.** The SRS specifies indigo / acid-lime `#AFFF00` / dark ink. That was
replaced at the client's request with **Violet Aurora** — violet `#6c4cf1`,
coral accent, violet-tinted neutrals. Acid lime on white is roughly 1.6:1, which
cannot legally carry text under WCAG AA; the replacement palette has every pair
measured and recorded in `packages/design-tokens/src/index.ts`.

**Typeface.** Raleway → **Outfit** (display) + **Inter** (body/UI). Raleway is a
display face; at 14px in a dense form its narrow apertures hurt. Inter is drawn
for exactly this job.

**Express, not NestJS.** §3.3 recommends NestJS. Express with a module-per-domain
layout was chosen for speed of movement at this stage. The module boundaries are
the same ones NestJS would impose, so the migration path stays open.

**No password hashing in our code.** §6 lists `password_hash` on the Account
entity. Firebase Authentication owns credentials, so the API never sees one.
§5.2's requirement is met by delegation rather than by implementation.

**Rate limiting is per-instance.** §3.3 rules out Redis, so
`express-rate-limit` uses in-memory counters. With N instances the effective
ceiling is N × the limit. Fine for credential stuffing and bulk outreach; not
fine for exact quotas — so FR-1102's daily caps must be counted in Firestore
instead. See `middleware/rate-limit.ts`.

**Listing search is in-process.** Firestore has no full-text search, so the `q`
filter is applied over the fetched page. This will not hold §5.1's sub-1s target
past a few thousand active listings and needs a search index before then.
Flagged in `listings.routes.ts`.

**Feed and matches are fan-out-on-read.** Both rank a candidate pool per
request rather than maintaining a materialised feed. That is correct at launch —
fan-out-on-write costs a write per follower on every post, which is absurd
before there are followers. Matching scores every active listing against one
profile, which is fine in the low thousands and hopeless at §5.1's 50,000. Both
constants are named at the top of `feed.service.ts` with the switch signal
written down.

**Skill rarity weights are hand-built.** `matching.ts` approximates inverse
document frequency with a static list, because there is no corpus to compute
real frequencies from yet. A nightly job over `listings.skills` replaces it.

**Scam detection never blocks.** FR-1101 is implemented as triage, not a filter:
it raises a moderation flag and lets the message through. A false positive that
silently swallows a legitimate recruiter's message is worse than a false
negative a moderator catches an hour later. The one exception is a `critical`
hit on a *post*, which hides it pending review — public permanent content earns
a stricter default than a private message.

**Verification gates publishing, not sign-up.** FR-302 says a company must be
verified before a listing goes live. It is enforced on the publish transition,
not on account creation — blocking sign-up on a CAC number would strand every
recruiter whose registration is still in progress.

---

## Things worth knowing before changing code

**Semantic colours only.** Components use `bg-surface`, `text-fg-muted`. Reaching
for a raw ramp like `bg-violet-600` bypasses dark mode and will look broken.

**`nextStep` is computed server-side.** `computeNextStep` in `auth.service.ts`
decides where a user belongs. The client just follows it. Two implementations of
that rule drifting apart is how onboarding loops happen.

**Role switching needs a token refresh.** `active_role` is a Firebase custom
claim, and claims only appear on a freshly minted token. Every role mutation on
the client calls `getIdToken(true)` afterwards.

**Internal notes must never reach a candidate.** FR-404. `stripInternal()` in
`applications.routes.ts` is the guard; the recruiter pipeline view is the single
place that intentionally skips it.

**Ranking logic stays pure.** `matching.ts` and `ranking.ts` take an injected
`now` and touch no I/O. That is what makes 47 tests possible and lets a scoring
change be evaluated against fixtures before it reaches anyone. Do not reach for
Firestore from inside them — fetch in `feed.service.ts` and pass the data in.

**Ranking weights live in `RANKING_CONFIG`** (`shared-types/src/feed.ts`), not
scattered through the scorers. Match weights must sum to 1;
`assertWeightsSumToOne()` has a test guarding it, because a weight edit that
silently rescales every score is very hard to notice.

**Not-found beats forbidden for anything social.** Confirming that a thread
exists, or that someone has blocked you, is itself a leak. Blocked users and
non-participants get 404 throughout messaging and connections.

**Clients read Firestore, the API writes it.** `firestore.rules` denies every
client write outright — that is the design, not an oversight. Reimplementing
validation, rate limiting and moderation in a rules file with no tests is how
divergences become security holes. Reads are granted, scoped, so messaging can
use `onSnapshot` (`features/messaging/use-realtime.ts`) instead of polling. The
60s query intervals that remain are a fallback for when a subscription cannot
start, not the primary path.

**Indexes must ship before the code that needs them.** A missing composite
index is a hard runtime failure, not a slow query. If you add a query with an
equality filter plus an `orderBy` on another field, add the index to
`firestore.indexes.json` in the same commit.

**Vendor chunking is matched by path, not by specifier.** Listing
`'firebase/app'` in `manualChunks` silently missed `firebase/firestore` when it
was added later, and the entry chunk went from 110kB to 193kB gzipped before
anyone noticed. `vite.config.ts` now matches on module path so it cannot drift.
