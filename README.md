# ShelfSense

ShelfSense turns grocery receipts into a smart pantry: it extracts purchased items, estimates expiration windows, and suggests meals or "use soon" ideas to reduce food waste and make meal planning easier.

Full build plan: [PLAN.md](PLAN.md) · Agent instructions: [CLAUDE.md](CLAUDE.md)

## Stack

- **Next.js 14** (App Router, TypeScript strict) on Vercel Hobby
- **Supabase** (Postgres + Auth + Storage) with RLS on every table
- **Groq** `llama-3.1-8b-instant` for receipt parsing and meal suggestions (JSON mode)
- **Tesseract.js** for client-side OCR
- **Tailwind v4** + **shadcn/ui** (Base UI primitives, `sonner` toasts)
- **Zod** for validating every LLM output and form boundary

## Getting started

```bash
npm install
cp .env.example .env    # then fill in the values
npm run dev             # http://localhost:3000
```

Required env vars (see [.env.example](.env.example)):

| Var | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | public | Canonical origin for magic-link callbacks. Required in production; must be on the Supabase Auth redirect allow-list |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon key, RLS-scoped |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | never import from a client component |
| `GROQ_API_KEY` | **server-only** | used by `/api` route handlers |

### Supabase auth configuration

The app uses passwordless magic-link auth. Before the first login works end-to-end:

1. In the Supabase dashboard, go to **Authentication → URL Configuration**.
2. Set **Site URL** to match `NEXT_PUBLIC_SITE_URL`.
3. Add `http://localhost:3000/auth/callback` and your production `…/auth/callback` to the **Redirect URLs** allow-list.
4. Make sure **Enable email signups** is on (Authentication → Providers → Email).

## Database setup

SQL lives in [supabase/migrations/](supabase/migrations/). Three migrations ship the initial schema:

- `0001_init.sql` — tables (`profiles`, `receipts`, `pantry_items`, `meal_suggestions`, `shelf_life_rules`), `pantry_status` enum, RLS on every user-owned table, indexes, and a `handle_new_user` trigger that auto-creates a profile row on signup.
- `0002_shelf_life_seed.sql` — seeds `shelf_life_rules` with 20 common food categories. Idempotent.
- `0003_storage_policies.sql` — owner-scoped RLS on the `receipts` storage bucket for all four CRUD ops.

Apply them to your linked Supabase project:

```bash
npx supabase link --project-ref <your-project-ref>  # one-time, find the ref in the dashboard URL
npx supabase db push
```

Local iteration (requires Docker):

```bash
npx supabase start           # boot local Postgres + Studio
npx supabase db reset        # reapply all migrations from scratch
npx supabase db lint         # schema sanity check
npx supabase stop            # tear down when done
```

The `receipts` storage bucket must exist and be **private**; create it in the dashboard before running the app. The object-level RLS policies in `0003` assume it exists.

## Scripts

```bash
npm run dev        # local dev server
npm run build      # production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run format     # prettier --write .
```

## Project layout

```
src/
  app/
    (auth)/          # login, signup, shared magic-link server actions
    (app)/           # protected routes: dashboard, pantry, receipts, meals
    auth/callback/   # PKCE code-exchange route handler
    api/             # route handlers (Groq calls live here)
  lib/
    supabase/        # server + client + middleware helpers
    groq/            # Groq client + prompt functions
    ocr/             # Tesseract wrapper
    shelfLife/       # deterministic date math
    validation/      # Zod schemas
  components/
    ui/              # shadcn/ui primitives
    common/          # shared layout (Nav)
    pantry/          # pantry list + item cards
    receipts/        # receipt uploader
    meals/           # meal cards
  middleware.ts      # Supabase session refresh + route gate
supabase/
  migrations/        # SQL migrations
```

## Phase progress

- **Phase 0.1 – tooling**: Next.js 14 + Tailwind v4 + shadcn/ui + Base UI primitives.
- **Phase 0.3 – database schema**: three migrations under [supabase/migrations/](supabase/migrations/). Apply with `npx supabase db push`.
- **Phase 0.4 – app skeleton**: route groups `(auth)` and `(app)`, protected shell layout with `Nav`, stub API handlers for `/api/receipts/parse` and `/api/meals/suggest` (return `501` until wired), and lazy Supabase/Groq client helpers.
- **Phase 0.5 – auth wiring**: passwordless magic-link sign-in via `@supabase/ssr`. Middleware redirects unauthed traffic from `(app)/*` to `/login?redirectTo=…` and bounces authed users off `/login` + `/signup`; fails closed when Supabase env vars are missing. `/auth/callback` handles the PKCE code exchange. `Nav` shows the signed-in email and a sign-out server action. Profile rows are created automatically by the `handle_new_user` trigger in `0001_init.sql`.
- **Phase 0.6 – deploy**: live on Vercel Hobby with `production` as the tracked branch. Only pushes to `production` trigger a build (`vercel.json` blocks `main`, project-level `commandForIgnoringBuildStep` skips every other branch). Supabase migrations are applied to the linked remote project and the Auth dashboard is configured (Site URL, redirect allow-list, email signups). All five env vars are set in Vercel Production scope only. See [Deployment](#deployment) for the wiring.

## Deployment

Production runs on Vercel Hobby with a **production-only** git strategy — only pushes to a branch literally named `production` trigger a build. `main` and any feature branch are dropped before the build step.

Two layers enforce this:

1. `vercel.json` sets `git.deploymentEnabled.main = false` — Vercel will not create a deployment for pushes to `main`.
2. The project's **Ignored Build Step** is set to `if [ "$VERCEL_GIT_COMMIT_REF" = "production" ]; then exit 1; else exit 0; fi` via `PATCH /v9/projects/{id}` on `commandForIgnoringBuildStep`. Exit code semantics are inverted (exit 1 = build, exit 0 = skip), so any branch other than `production` is hard-skipped even if someone edits `vercel.json` out of spec.

The project's **Production Branch** was flipped from the default `main` to `production` via the undocumented `PATCH /v9/projects/{id}/branch` endpoint — the Vercel CLI does not currently expose this setting.

Environment variables live in **Vercel → Project Settings → Environment Variables, Production scope only**. Since `NEXT_PUBLIC_*` vars are inlined at build time, any change in Vercel needs a new build — push an empty commit to `production` to rebuild:

```bash
git commit --allow-empty -m "chore: rebuild with env vars"
git push origin production
```

The `NEXT_PUBLIC_SITE_URL` value must match the Supabase Auth **Site URL** and appear on the Supabase Auth **Redirect URLs** allow-list (as `https://<host>/auth/callback`), otherwise magic-link emails will 404 on click.

## Hard constraints

- Vercel Hobby: serverless functions capped at 60s (`vercel.json`). Keep heavy work off the server — OCR runs in the browser.
- Supabase Free: 500 MB DB, 1 GB storage, 50 MB max upload. RLS is mandatory.
- Groq Free: 30 RPM, 6K TPM. Small prompts only, no history replay, no retry loops.
- Groq model is text-only — OCR must complete before any Groq call.
- Date math is deterministic, never delegated to the LLM.
