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
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project API URL — `https://<project-ref>.supabase.co`. **Not** the dashboard URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon key, RLS-scoped |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | never import from a client component. Also used by the dev auto-login route below |
| `GROQ_API_KEY` | **server-only** | used by `/api` route handlers |
| `AUTH_BYPASS` | **dev-only** | Set to `1` to skip the magic-link flow and auto-sign-in as a seeded dev user — see [Dev auth bypass](#dev-auth-bypass). Force-disabled in production |

### Supabase auth configuration

The app uses passwordless magic-link auth. Before the first login works end-to-end:

1. In the Supabase dashboard, go to **Authentication → URL Configuration**.
2. Set **Site URL** to match `NEXT_PUBLIC_SITE_URL`.
3. Add `http://localhost:3000/auth/callback` and your production `…/auth/callback` to the **Redirect URLs** allow-list.
4. Make sure **Enable email signups** is on (Authentication → Providers → Email).

### Dev auth bypass

Iterating on `(app)/*` pages while waiting for magic-link emails is slow. For local dev only, set `AUTH_BYPASS=1` in `.env` and restart `npm run dev`. When the flag is on:

- `/login` and `/signup` both redirect to `/dashboard`, and the Nav hides the sign-out form and shows a small `auth bypass` chip instead.
- The first request to any protected route bounces through [`/api/dev/session`](src/app/api/dev/session/route.ts), which uses `SUPABASE_SERVICE_ROLE_KEY` to create (or fetch) a fixed user `dev@shelfsense.local` via the admin API, then calls `signInWithPassword` so a real Supabase session cookie is set on your browser. Every subsequent request carries that cookie like a normal login.
- The receipt uploader page hydrates its browser Supabase client from the server-side session using `supabase.auth.setSession(...)`, so storage uploads and DB writes go through RLS with a real bearer token (no ad-hoc service-role usage on the client).
- The dev user's password is a hardcoded non-secret string in [src/lib/auth/devUser.ts](src/lib/auth/devUser.ts). It's only usable while `AUTH_BYPASS=1` and `NODE_ENV !== 'production'`.

To turn it off, delete the `AUTH_BYPASS` line (or set it to anything other than `1`) and restart. The dev user remains in your Supabase project until you delete it from the dashboard — harmless.

The bypass is force-disabled in production by [`isAuthBypassed()`](src/lib/auth/bypass.ts): it checks `NODE_ENV !== 'production'` before honouring the flag, so leaking `AUTH_BYPASS=1` into Vercel has no effect. Still, don't set it on Vercel — signal intent.

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
- **Phase 0.4 – app skeleton**: route groups `(auth)` and `(app)`, protected shell layout with `Nav`, stub API handlers for `/api/receipts/parse` and `/api/meals/suggest` (both returned `501` on landing — `/api/receipts/parse` is now wired in Phase 1.3, `/api/meals/suggest` stays stubbed until Phase 3), and lazy Supabase/Groq client helpers.
- **Phase 0.5 – auth wiring**: passwordless magic-link sign-in via `@supabase/ssr`. Middleware redirects unauthed traffic from `(app)/*` to `/login?redirectTo=…` and bounces authed users off `/login` + `/signup`; fails closed when Supabase env vars are missing. `/auth/callback` handles the PKCE code exchange. `Nav` shows the signed-in email and a sign-out server action. Profile rows are created automatically by the `handle_new_user` trigger in `0001_init.sql`.
- **Phase 0.6 – deploy**: live on Vercel Hobby with `production` as the tracked branch. Only pushes to `production` trigger a build (`vercel.json` blocks `main`, project-level `commandForIgnoringBuildStep` skips every other branch). Supabase migrations are applied to the linked remote project and the Auth dashboard is configured (Site URL, redirect allow-list, email signups). All five env vars are set in Vercel Production scope only. See [Deployment](#deployment) for the wiring.
- **Phase 0.7 – dev auth bypass** *(local only)*: `AUTH_BYPASS=1` env flag + `/api/dev/session` admin-API auto-login + a fixed dev user (`dev@shelfsense.local`). Production-safe: gated by `isAuthBypassed()` which also checks `NODE_ENV !== 'production'`. See [Dev auth bypass](#dev-auth-bypass) for usage.
- **Phase 1.1 – receipt upload flow**: `ReceiptUploader.tsx` is a real dropzone (`react-dropzone`, 8 MB limit, PNG/JPG/WEBP/PDF). The `/receipts/upload` page is a server component that reads the user + session and passes them as props; the client hydrates its browser Supabase client via `setSession(...)` on mount so storage + DB writes carry a real bearer token through RLS. Pipeline: browser-client upload to `receipts/{user_id}/{uuid}.{ext}` → insert `receipts` row (`status='pending'`) → `runOcr(file)` → patch to `ocr_done` → `POST /api/receipts/parse` → `parsed`. Rejection paths (too large, wrong MIME) surface via `sonner` toasts.
- **Phase 1.2 – client-side OCR**: [src/lib/ocr/runOcr.ts](src/lib/ocr/runOcr.ts) is a real **compress → deskew → Tesseract → clean** pipeline. Images go through `browser-image-compression` (max 1500 px, 1.5 MB, WebWorker), load into an `<img>`, and hand off to `jscanify.extractPaper` for document-edge deskew (jscanify depends on OpenCV.js loaded lazily from `docs.opencv.org/4.10.0/opencv.js` — pinned, cached, reset on rejection so a single CDN hiccup doesn't brick the session). PDFs go through `pdfjs-dist` (worker pinned on `cdnjs.cloudflare.com`), page 1 rendered at 2× into a canvas, same deskew + Tesseract path. `tesseract.js` recognizes English only, with a no-op logger. Deskew failures (no quad detected, OpenCV blocked) fall back to the raw image — the pipeline never blocks. Text is lowercased, whitespace-collapsed per line, 3-char minimum, and capped at 8000 chars before handoff. `next.config.mjs` now aliases `canvas: false` on client builds so pdfjs doesn't trip on its Node-only dep. All three OCR libs are dynamically imported so the initial bundle for `/receipts/upload` is ~201 kB first-load JS.
- **Phase 1.3 – Groq receipt parser**: [src/lib/groq/parseReceipt.ts](src/lib/groq/parseReceipt.ts) calls `llama-3.1-8b-instant` in JSON mode with a short system prompt + a hand-authored JSON schema (zod-to-json-schema doesn't yet support Zod v4). Output is Zod-validated against `parsedReceiptSchema`; failures log and rethrow with no retry loop. Categories are then fuzzy-resolved through `fuse.js` against the `shelf_life_rules` keys (`normalized_name` first, then the LLM's `category` guess, then `'other'`) — so the DB never sees a free-form category string. [src/app/api/receipts/parse/route.ts](src/app/api/receipts/parse/route.ts) auth-gates on `supabase.auth.getUser()` before any DB or Groq call, loads the receipt row under RLS, calls `parseReceipt`, inserts `pantry_items` with `user_id` pulled from the session (not the body), `purchased_at = receipt.uploaded_at::date`, and `estimated_expiration_at=null` / `status='fresh'` (Phase 2 fills the expiration fields). Success flips the receipt to `status='parsed'`; Groq/Zod failure and insert failure both flip to `status='failed'` and return a single-shot error. End-to-end upload → pantry works for fresh uploads; `ocr_done` rows left behind by 1.2 testing won't auto-advance — re-upload to see parsed results.

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

## Gotchas

- **Webpack dev cache in memory.** [next.config.mjs](next.config.mjs) overrides `config.cache` to `{ type: 'memory' }` in dev only. Next.js 14's default filesystem pack cache races with file watchers and leaves half-renamed `.pack.gz_` files behind, producing `ENOENT` `unhandledRejection`s that can destabilize the dev server. Memory cache costs a few seconds on cold `npm run dev` startup but has zero disk IO. Production builds are unchanged.
- **Router cache can serve stale redirects.** If you edit a `(app)/*` page so it starts or stops calling `redirect()`, the Next.js client router may still follow the old cached payload on navigation. Hard-refresh (Cmd/Ctrl+Shift+R) or close-and-reopen the tab to flush it. For routes like `/receipts/upload` whose session logic changes between phases, the safe pattern is `export const dynamic = 'force-dynamic'` + `revalidate = 0` plus `prefetch={false}` (or a plain `<a>`) on any inbound `Link`.
- **Test fixtures stay local.** `photo_test_*.*` and `*.local.{jpg,jpeg,png,pdf}` are excluded via `.gitignore`. Drop your local receipts in those filenames and they'll never accidentally ride along in a commit.
