# ShelfSense — Implementation Plan

## Reusable Prompts

**Plan mode:**
> Plan {{PHASE/STEP}}. Follow PLAN.md for instructions. Include a thorough verification section that covers the happy path, every failure/rejection branch, auth/RLS gating, and any downstream stubs that will block full end-to-end success — spell out exact manual steps, expected UI states, expected DB/storage state, and how to confirm each one.

**Edit automatically:**
> Update .env.example, README.md, PLAN.md, and .gitignore so everything is current.

---

ShelfSense turns grocery receipts into a smart pantry. Users upload a receipt, OCR extracts text, Groq's `llama-3.1-8b-instant` parses items into structured data, the app estimates expiration windows, and suggests meals to reduce food waste.

This document is the full step-by-step build plan, organized into phases. Each phase has a goal, deliverables, concrete steps, file-level scaffolding, and exit criteria.

---

## Tech Stack (Locked Decisions)

| Layer | Choice | Notes |
|---|---|---|
| Frontend + API | Next.js 14 (App Router) on Vercel Hobby | Server Actions / Route Handlers for backend logic. Keep functions <60s. |
| Database | Supabase Postgres (Free) | 500 MB DB, RLS for auth-scoped queries. |
| Auth | Supabase Auth | Email + OAuth (Google) optional. |
| File storage | Supabase Storage | 1 GB free, 50 MB max file size. Receipts bucket. |
| AI | Groq `llama-3.1-8b-instant` | Text-only, JSON mode, 30 RPM / 14.4K RPD free. |
| OCR | Tesseract.js (client-side) primary; fallback to a server route | Client OCR keeps Groq-bound serverless functions short. |
| Styling | Tailwind v4 + shadcn/ui (Base UI primitives, `sonner` toasts) | Fast, polished UI components. |
| Validation | Zod | Validate Groq JSON outputs and form input. |
| State | React Server Components + minimal client state | Avoid heavy client stores. |
| Deployment | Vercel (frontend/API), Supabase (DB/storage/auth) | Render is **not** used. |

**Hard constraints to design around:**
- Vercel Hobby function duration: default 10s, max 60s → keep OCR off the server when possible.
- Supabase Free: 500 MB DB, 1 GB storage, 50 MB max upload.
- Groq Free: 30 RPM, 6K TPM → batch nothing, send small prompts only.
- Groq model is text-only → OCR **must** run before Groq.

---

## Phase 0 — Project Setup & Foundations

**Goal:** A running Next.js app connected to Supabase and Groq, deployable to Vercel, with auth and base routing in place.

### 0.1 Repository & tooling
1. Initialize Next.js 14 with TypeScript, App Router, Tailwind, ESLint. The directory name must be lowercase (npm package name rule), so scaffold in a temp folder and move the files into the repo root:
   ```bash
   npx create-next-app@14 shelfsense --typescript --tailwind --app --eslint --src-dir --import-alias "@/*" --use-npm
   ```
2. Install core dependencies:
   ```bash
   npm i @supabase/supabase-js @supabase/ssr groq-sdk zod tesseract.js date-fns lucide-react
   npm i -D @types/node prettier
   ```
3. Add shadcn/ui. `shadcn@latest` (v4) targets Tailwind v4 + Base UI and uses `sonner` in place of the removed `toast` component, so upgrade Tailwind in the same step:
   ```bash
   npx shadcn@latest init -y -d
   npx shadcn@latest add button card input label dialog dropdown-menu badge skeleton sonner -y
   npm uninstall tailwindcss
   npm i -D tailwindcss@^4 @tailwindcss/postcss@^4
   ```
   Then delete the scaffolded `tailwind.config.ts` (v4 is CSS-based via `@theme`), point `postcss.config.mjs` at `@tailwindcss/postcss`, and rewrite `src/app/globals.css` with `@import "tailwindcss"` plus a `@theme inline` block that maps the shadcn CSS variables (`--color-border: var(--border)`, etc.) so classes like `border-border` resolve.
4. Set up `.env` with placeholder keys:
   ```
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   GROQ_API_KEY=
   ```
5. Add `.env.example` mirroring the above (committed). Extend `.gitignore` to ignore `.env` in addition to `.env*.local` — the Next.js default only covers the latter.
6. Add `prettier.config.js`, ensure `next.config.mjs` allows Supabase image domains via `images.remotePatterns`.
7. Configure `vercel.json` for max function duration:
   ```json
   { "functions": { "src/app/api/**/route.ts": { "maxDuration": 60 } } }
   ```
8. Add `typecheck` and `format` scripts to `package.json` (`tsc --noEmit` and `prettier --write .`).

### 0.2 Supabase project
1. Create a Supabase project (use one of the 2 free slots).
2. Enable Email auth; optionally enable Google OAuth.
3. Create a public bucket named `receipts` with RLS, **owner-only read/write**.
4. Save URL, anon key, and service-role key to `.env` and Vercel project env.

### 0.3 Database schema (SQL migration)

> **Status: shipped.** Implemented in [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql), [0002_shelf_life_seed.sql](supabase/migrations/0002_shelf_life_seed.sql), and [0003_storage_policies.sql](supabase/migrations/0003_storage_policies.sql). Verified locally with `supabase db reset` + a functional RLS cross-user test (11/11). Applied to the linked remote Supabase project during Phase 0.6; `npx supabase db push` reports "Remote database is up to date."
>
> **Decisions made beyond the bare spec below:**
> - Added a `handle_new_user` trigger (`security definer`, `set search_path = public`) so signup auto-populates `public.profiles` without needing a server-action post-signup hook.
> - Added indexes on the hot query paths: `pantry_items(user_id, status)`, `pantry_items(user_id, estimated_expiration_at)`, `pantry_items(receipt_id)`, `receipts(user_id, uploaded_at desc)`, `meal_suggestions(user_id, created_at desc)`.
> - `shelf_life_rules` has RLS enabled with a `using (true)` select policy and no write policies, so only the service role can seed/modify it.
> - Storage RLS moved into a third migration [0003_storage_policies.sql](supabase/migrations/0003_storage_policies.sql) covering SELECT/INSERT/UPDATE/DELETE on the `receipts` bucket. The UPDATE policy uses `with check` to block path-rename escapes into another user's folder. The bucket itself is created in the Supabase dashboard (Phase 0.2), not in SQL.
> - **Tracked gap:** `pantry_items.receipt_id` is not cross-checked against the row owner of the referenced receipt. A malicious client could insert their own row linked to another user's receipt id; no data leak (RLS on `receipts` still blocks reads), but worth revisiting if the threat model tightens.

Create `supabase/migrations/0001_init.sql`:

```sql
-- USERS: handled by auth.users; we mirror minimal profile if needed
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_path text not null,
  ocr_text text,
  uploaded_at timestamptz default now(),
  status text default 'pending' check (status in ('pending','ocr_done','parsed','failed'))
);

create type pantry_status as enum ('fresh','use_soon','likely_expired','consumed');

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_id uuid references public.receipts(id) on delete set null,
  name text not null,
  normalized_name text,
  category text,
  quantity numeric,
  unit text,
  purchased_at date not null default current_date,
  estimated_expiration_at date,
  status pantry_status default 'fresh',
  created_at timestamptz default now()
);

create table public.meal_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  ingredients_used jsonb not null,
  missing_ingredients jsonb,
  reason text,
  created_at timestamptz default now()
);

-- Shelf-life rules table seeded with category defaults
create table public.shelf_life_rules (
  id serial primary key,
  category text unique not null,
  default_days int not null,
  storage text -- 'pantry' | 'fridge' | 'freezer'
);

-- RLS
alter table public.profiles enable row level security;
alter table public.receipts enable row level security;
alter table public.pantry_items enable row level security;
alter table public.meal_suggestions enable row level security;

create policy "own profile" on public.profiles for all using (auth.uid() = id);
create policy "own receipts" on public.receipts for all using (auth.uid() = user_id);
create policy "own pantry" on public.pantry_items for all using (auth.uid() = user_id);
create policy "own meals" on public.meal_suggestions for all using (auth.uid() = user_id);
```

Seed `shelf_life_rules` with ~20 common categories: `dairy`, `eggs`, `raw_poultry`, `raw_red_meat`, `fish`, `leafy_greens`, `fruit`, `root_vegetable`, `bread`, `pasta_dry`, `rice_dry`, `canned`, `frozen`, `condiment`, `cheese_hard`, `cheese_soft`, `deli_meat`, `juice`, `tofu`, `eggs_boiled`, etc.

### 0.4 App skeleton

> **Status: shipped.** All files below exist as compiling stubs. `npm run typecheck`, `npm run lint`, and `npm run build` are all clean (14 routes generated). A dev-server smoke test returned 200 on every page route and 501 on both API stubs.
>
> **Decisions made beyond the bare spec below:**
> - `middleware.ts` calls `updateSession` from [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts), which falls through to `NextResponse.next()` when `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing. This keeps the 0.4 skeleton bootable without a Supabase project, and the actual route-gating redirect lands in 0.5.
> - Supabase + Groq clients are **lazy**: they read env vars inside factory functions (`createClient`, `getGroqClient`) rather than at module load, so importing them at build time doesn't crash the generator.
> - Lib stubs (`parseReceipt`, `suggestMeals`, `runOcr`, `estimateExpiration`) throw `Error('… not implemented (Phase X.Y)')`. Unused `_`-prefixed params required an ESLint rule — added `argsIgnorePattern: "^_"` to [.eslintrc.json](.eslintrc.json).
> - `src/lib/validation/schemas.ts` ships **real** Zod schemas for Phase 1/3 payloads (`parsedReceiptItemSchema`, `mealSuggestionSchema`, etc.) since components already import the inferred types.
> - The shadcn `Button` in this template is a Base UI wrapper with **no `asChild` prop**, so the receipts page uses `<Link className={buttonVariants()}>` instead of `<Button asChild>`. Apply the same pattern anywhere you need a link styled as a button.
> - API stubs at [src/app/api/receipts/parse/route.ts](src/app/api/receipts/parse/route.ts) and [src/app/api/meals/suggest/route.ts](src/app/api/meals/suggest/route.ts) return `{ ok: false, error: 'not_implemented' }` with HTTP 501 until Phases 1.3 and 3.1 wire them up.
> - **Tracked gap:** middleware currently refreshes the Supabase session on every request but does **not** redirect unauthenticated users — that's intentional, it lands in 0.5 alongside the login form.

Folder layout:
```
src/
  app/
    (auth)/login/page.tsx
    (auth)/signup/page.tsx
    (app)/layout.tsx          # protected shell
    (app)/dashboard/page.tsx
    (app)/pantry/page.tsx
    (app)/receipts/page.tsx
    (app)/receipts/upload/page.tsx
    (app)/meals/page.tsx
    api/
      receipts/parse/route.ts # Groq parsing endpoint
      meals/suggest/route.ts  # Groq meal endpoint
  lib/
    supabase/server.ts
    supabase/client.ts
    supabase/middleware.ts
    groq/client.ts
    groq/parseReceipt.ts
    groq/suggestMeals.ts
    ocr/runOcr.ts
    shelfLife/estimate.ts
    validation/schemas.ts
  components/
    pantry/PantryList.tsx
    pantry/PantryItemCard.tsx
    receipts/ReceiptUploader.tsx
    meals/MealCard.tsx
    common/Nav.tsx
  middleware.ts               # auth gate
```

### 0.5 Auth wiring — complete

Passwordless magic-link auth via `@supabase/ssr`. Shipped in these files:

- [src/lib/supabase/server.ts](src/lib/supabase/server.ts), [src/lib/supabase/client.ts](src/lib/supabase/client.ts), [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts) — anon-key server/client/middleware helpers (no service-role on the client).
- [src/middleware.ts](src/middleware.ts) + `updateSession` — refreshes the Supabase session on every request, redirects unauthed users from `/dashboard`, `/pantry`, `/receipts`, `/meals` (and nested paths) to `/login?redirectTo=…`, and bounces authed users off `/login` + `/signup`. Fails closed: missing Supabase env vars redirect protected routes to `/login` instead of silently passing through.
- [src/app/(auth)/actions.ts](src/app/(auth)/actions.ts) — `sendMagicLink` (calls `signInWithOtp`) and `signOut` server actions. Origin is derived from `NEXT_PUBLIC_SITE_URL` (not trusted forwarded headers) to block host-header injection. `redirectTo` and `returnPath` are validated to `/`-prefixed internal paths only.
- [src/app/(auth)/login/page.tsx](src/app/(auth)/login/page.tsx), [src/app/(auth)/signup/page.tsx](src/app/(auth)/signup/page.tsx) — shadcn-styled forms with error / sent states, `aria-describedby`, and a `useFormStatus`-driven pending button at [src/app/(auth)/SubmitButton.tsx](src/app/(auth)/SubmitButton.tsx).
- [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts) — PKCE `exchangeCodeForSession` handler. Rejects absent codes, sanitizes Supabase errors to a generic string, and restricts `next` to internal paths.
- [src/components/common/Nav.tsx](src/components/common/Nav.tsx) — async server component showing the signed-in email plus a sign-out form action. Link list hides on mobile to prevent overflow.
- **Profile row on signup**: already handled by the `handle_new_user` trigger in [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) — no extra server action needed.
- [.env.example](.env.example) documents the new `NEXT_PUBLIC_SITE_URL` var.

**Required Supabase dashboard setup** (otherwise magic links 404):
1. Authentication → URL Configuration → Site URL = `NEXT_PUBLIC_SITE_URL`.
2. Add `http://localhost:3000/auth/callback` and the production callback to the Redirect URLs allow-list.
3. Authentication → Providers → Email → enable signups.

**Audits run**: `rls-security-auditor` and `ui-polish-reviewer`. All HIGH/MEDIUM findings fixed before merge (host-header injection, fail-closed middleware, sanitized callback errors, validated `returnPath`, dark-mode-safe semantic tokens, mobile nav overflow).

### 0.6 Exit criteria for Phase 0 — complete

> **Status: shipped.** Live on Vercel Hobby at `https://shelfsense-pi.vercel.app`. All four exit criteria satisfied:
> - ✅ App builds and deploys to Vercel — deployment `dpl_EF4cUU4UmvwJ3f3bdwWXnBu1g8nG` on sha `3429787` is READY.
> - ✅ Sign up / log in / empty `/pantry` wiring verified end-to-end. Protected routes 307 to `/login?redirectTo=…` (no longer the fail-closed `?error=Auth%20is%20not%20configured` path), `/auth/callback` handles PKCE, Supabase Auth dashboard is configured (Site URL, redirect allow-list, email signups).
> - ✅ DB tables + RLS applied to the remote Supabase project (see 0.3 status note).
> - ✅ All five env vars set in Vercel Production scope only.
>
> **Decisions made beyond the bare spec above:**
> - **Production-only git strategy.** The Vercel project tracks a branch literally named `production`. `main` is retained as an integration branch but never deploys.
> - **Two layers of branch gating:**
>   1. [vercel.json](vercel.json) sets `git.deploymentEnabled.main = false` so Vercel never creates a deployment for `main` pushes.
>   2. The project's `commandForIgnoringBuildStep` was set via `PATCH /v9/projects/{id}` to `if [ "$VERCEL_GIT_COMMIT_REF" = "production" ]; then exit 1; else exit 0; fi` — any branch other than `production` is hard-skipped before build, closing the "future feature branch" gap that `vercel.json` alone cannot cover.
> - **Production branch flipped via undocumented API.** Vercel's CLI does not expose the production-branch setting. It was changed from `main` → `production` via `PATCH /v9/projects/{id}/branch` with `{"branch":"production"}` — the same endpoint the Vercel dashboard uses internally.
> - **No preview or development env vars.** All five env vars are scoped to Production only. Preview and Development are intentionally empty because those branches never deploy anyway.
> - **Rebuild ritual.** `NEXT_PUBLIC_*` vars are inlined at build time, so changes in Vercel require a new build. Push an empty commit to `production` (`git commit --allow-empty -m … && git push origin production`) — the initial deployment was rebuilt this way after env vars landed.
> - **Tracked gap:** the production URL `shelfsense-pi.vercel.app` is a Vercel-generated alias. If a custom domain is added later, update `NEXT_PUBLIC_SITE_URL` in Vercel, the Supabase Auth Site URL, and the Supabase redirect allow-list in lockstep.

### 0.7 Dev auth bypass (local only, not a production path)

> **Status: shipped (dev-only).** Iterating on `(app)/*` pages while waiting for magic-link emails was making every change take a minute. `AUTH_BYPASS=1` in `.env` now short-circuits the magic-link flow with a seeded dev user.
>
> **Mechanics:**
> - [src/lib/auth/bypass.ts](src/lib/auth/bypass.ts) exposes `isAuthBypassed()` which returns `true` iff `process.env.AUTH_BYPASS === '1' && process.env.NODE_ENV !== 'production'`. Every code path that respects the flag routes through this helper — **the production gate is the `NODE_ENV` check**, so leaking `AUTH_BYPASS=1` into Vercel has no effect.
> - [src/lib/auth/devUser.ts](src/lib/auth/devUser.ts) holds the fixed dev credentials (`dev@shelfsense.local` + a non-secret constant password). Only referenced by the dev-only route below.
> - [src/app/api/dev/session/route.ts](src/app/api/dev/session/route.ts) is a Node-runtime GET handler that (1) refuses to run unless `isAuthBypassed()`, (2) uses `SUPABASE_SERVICE_ROLE_KEY` + `@supabase/supabase-js` admin API to `createUser({ email_confirm: true })` — idempotent, `already exists` errors are ignored — (3) creates an `@supabase/ssr` server client and calls `signInWithPassword` so real auth cookies land on the Next cookie store, and (4) redirects to `safeNext(request.nextUrl.searchParams.get('next'))`.
> - [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts) in bypass mode always lets `/api/dev/session` through, redirects `/login` + `/signup` to `/dashboard`, and for any protected prefix with no `sb-*-auth-token` cookie (including chunked `-auth-token.N` variants) redirects to `/api/dev/session?next=<pathname>`. First request self-heals; subsequent requests just pass through.
> - [src/components/common/Nav.tsx](src/components/common/Nav.tsx) shows a small `auth bypass` chip in the top-right instead of the sign-out form when the flag is on. [src/app/page.tsx](src/app/page.tsx), [src/app/(auth)/login/page.tsx](src/app/(auth)/login/page.tsx), and [src/app/(auth)/signup/page.tsx](src/app/(auth)/signup/page.tsx) each short-circuit to `/dashboard` when `isAuthBypassed()` is true, so even direct-URL access can't reach the magic-link UI in dev.
>
> **How Phase 1.1 picks it up:** the `/receipts/upload` server component reads the user + session via `supabase.auth.getUser()` + `supabase.auth.getSession()`, then passes `userId`, `accessToken`, `refreshToken` down as props. The client `ReceiptUploader` calls `supabase.auth.setSession(...)` in a `useEffect` to force-hydrate the browser Supabase client's in-memory session. This sidesteps any client-side cookie-decode round-trip and guarantees storage uploads + DB writes carry a valid bearer token through RLS — without the uploader ever calling `auth.getUser()` on the client.
>
> **Rules of engagement:**
> - **Never** set `AUTH_BYPASS` on Vercel. Force-disabled by `NODE_ENV` but leave it unset anyway for clarity.
> - `SUPABASE_SERVICE_ROLE_KEY` has exactly one import site ([src/app/api/dev/session/route.ts](src/app/api/dev/session/route.ts)) and that route is gated by `isAuthBypassed()` before any admin call. `rls-security-auditor` should re-verify this invariant after any future auth-adjacent edit.
> - When you want to test the real magic-link flow locally, delete `AUTH_BYPASS` from `.env` and restart dev. The dev user row stays in `auth.users` — harmless, delete from the Supabase dashboard if it bothers you.

---

## Phase 1 — Foundation MVP (Receipt → Pantry)

**Goal:** A user uploads one receipt and sees parsed items appear on the pantry page.

**New deps this phase:**
```bash
npm i react-dropzone browser-image-compression jscanify pdfjs-dist zod-to-json-schema fuse.js
```
(`tesseract.js`, `zod`, `groq-sdk`, `date-fns` are already in the Phase 0 install.)

### 1.1 Receipt upload flow

> **Status: shipped.** Only `react-dropzone` was installed for this sub-step (the other Phase-1 deps belong to 1.2 / 1.3 and are deferred). The pipeline is wired in `onDrop`: browser-client upload to `receipts/{user_id}/{uuid}.{ext}` → insert `receipts` row (`status='pending'`) → `runOcr(file)` → patch `ocr_text` + `status='ocr_done'` → `POST /api/receipts/parse` → `status='parsed'`. Progress states are `idle → uploading → ocr → parsing → done | error`; rejections (size, MIME) toast via `sonner`. The `/receipts/upload` page is now a server component that reads `auth.getUser()` + `auth.getSession()` and passes `userId`, `accessToken`, `refreshToken` as props to the client; the client calls `supabase.auth.setSession(...)` once in a `useEffect` to force-hydrate the in-memory session so the browser supabase client carries a real bearer token through RLS (no more client-side `getUser()` call). The "Upload receipt" link on `/receipts` is a plain `<a>` tag, not a `<Link>`, to bypass the Next App Router cache after we saw a stale redirect cached from an earlier iteration. `/receipts/upload` is marked `dynamic = 'force-dynamic'` + `revalidate = 0` so it never gets cached as a client prefetch.
>
> **End-to-end right now (as of 1.1 only):** upload → storage → DB row → `runOcr` throws (Phase 1.2 stub) → row flipped to `status='failed'` → UI shows `"OCR failed. Please try a clearer photo."`. This is the expected exit state of 1.1 in isolation and it's verified: photo lands in `receipts/{dev-user-uid}/<uuid>.jpeg`, a `failed` row appears in `public.receipts`. When 1.2 lands, this same uploader reaches `ocr_done` without further edits; when 1.3 lands it reaches `parsed` without further edits.
>
> **Notes for 1.2 handoff (`ocr-pipeline-specialist`):** the contract is unchanged — `runOcr(file: File): Promise<string>` in [src/lib/ocr/runOcr.ts](src/lib/ocr/runOcr.ts), currently throwing. The uploader doesn't care how the OCR works internally. For 1.2 you need to `npm i browser-image-compression jscanify pdfjs-dist` (deferred from 1.1 on purpose) and replace the stub body.

**File:** [src/components/receipts/ReceiptUploader.tsx](src/components/receipts/ReceiptUploader.tsx)

**Library: [`react-dropzone`](https://react-dropzone.js.org/)** — handles the file input, drag-and-drop, MIME filtering, and size validation in one hook. Saves reinventing the drop target + validation logic.
- Install: `npm i react-dropzone`
- Input: `useDropzone({ accept: { 'image/*': ['.png','.jpg','.jpeg','.webp'], 'application/pdf': ['.pdf'] }, maxSize: 8 * 1024 * 1024, multiple: false, onDrop })`
- Output: `onDrop(acceptedFiles: File[], fileRejections: FileRejection[])` — rejections carry the reason (`file-too-large`, `file-invalid-type`) so you can toast the error straight from the hook.

Steps:
1. Render the dropzone via `react-dropzone`. Spread `getRootProps()` / `getInputProps()` onto a shadcn `Card`.
2. Size + MIME validation is handled by the hook config above — no manual checks needed.
3. On accepted drop:
   - Upload file to Supabase Storage at `receipts/{user_id}/{uuid}.{ext}`.
   - Insert a row in `receipts` with `status='pending'`.
   - Trigger client-side OCR (see 1.2).
   - On OCR success, PATCH the receipt with `ocr_text` and `status='ocr_done'`.
   - Call `/api/receipts/parse` with `{ receiptId }`.
4. Show progress states: uploading → OCR → parsing → done.

### 1.2 OCR (client-side primary)

> **Status: shipped.** [src/lib/ocr/runOcr.ts](src/lib/ocr/runOcr.ts) now implements the full **compress → deskew → Tesseract → clean** pipeline behind the same `runOcr(file: File): Promise<string>` contract 1.1 handed over. The uploader, parse route, and migrations were not touched. `npm run typecheck`, `npm run lint`, and `npm run build` are all clean. End-to-end behavior: a successful upload now lands the receipt row at `status='ocr_done'` with real text in `ocr_text`, and the flow then stops at the 501 parse stub (`"Could not parse receipt."` error card) — that's the intended exit state until 1.3 lands.
>
> **Decisions made beyond the bare spec below:**
> - **Storage still holds the original file**, not the compressed one. 1.1 uploads the raw `File` to `receipts/{user_id}/{uuid}.{ext}` before `runOcr` is called, and I deliberately kept that path untouched to keep 1.2 to a single file of product code. Compression happens inside `runOcr` only and is discarded after the OCR call. The "use the compressed file for both upload and OCR" suggestion in the library notes above is not currently wired — revisit in Phase 4 polish if Supabase storage usage becomes a concern.
> - **All three new libraries are dynamically imported** (`await import(...)`) inside `runOcr` rather than statically imported at the top of the file. This defers the ~2–3 MB payload until the first upload attempt and keeps the `/receipts/upload` initial bundle small (first-load JS for that route is 201 kB per `next build` output).
> - **jscanify is imported from the `jscanify/client` subpath**, not the package root. The root entry uses a Node-style CJS wrapper that drags in dependencies that break in the browser bundle; `jscanify/client` is the browser-only UMD entry that jscanify ships for exactly this case. A tiny ambient shim at [src/types/jscanify.d.ts](src/types/jscanify.d.ts) declares the class shape since jscanify ships no types.
> - **OpenCV.js is loaded from `https://docs.opencv.org/4.10.0/opencv.js`**, not the `4.x` floating alias. Pinning a concrete version blocks the "vendor silently updates the alias" risk surfaced by the security audit.
> - **OpenCV load failures don't permanently disable deskew.** The `opencvPromise` module-level cache is **cleared on rejection** so a single CDN hiccup doesn't brick the feature for the rest of the session — the next upload retries the script load. A successful resolution is cached forever per the usual pattern.
> - **pdfjs worker is loaded from `cdnjs.cloudflare.com/.../pdf.js/5.6.205/pdf.worker.min.mjs`**, not the `?url` bundler path. The `?url` path wasn't attempted because pdfjs v5's ESM worker resolution through Next.js 14's webpack config is fragile and the CDN URL is simpler to reason about. The worker URL is pinned to the exact installed version and is set once per session via a module-level guard (`pdfjsWorkerSet`).
> - **`next.config.mjs` now aliases `canvas: false` on client builds** so `pdfjs-dist` doesn't try to resolve the Node-only `canvas` dependency at webpack time. Server builds are unaffected (guarded by `!isServer`).
> - **`page.render` passes both `canvas` and `canvasContext`** — pdfjs v5 accepts either and there's a small API churn in v5 around which is required. Passing both is belt-and-braces and is what the current typedefs tolerate.
> - **`cleanOcrText` is exported** (not just used internally) so future callers (tests, server-side cleanup scripts) can hit the same normalizer without importing the whole browser pipeline. It does: `\r\n → \n`, lowercase, collapse whitespace per line, drop lines shorter than 3 chars, truncate at 8000 chars. Empty output is a valid return — the uploader still flips to `ocr_done` and hands off to the parse step.
> - **Deskew swallows every failure** (OpenCV timeout, OpenCV load error, jscanify throw, no quad detected) and falls back to the raw image. The only visible side effect is one `console.warn('[ocr] deskew skipped:', err)` per failure.
>
> **Audit (`rls-security-auditor`):** clean on all hard rules — service-role key containment intact, no new secret references, no new Supabase queries, no new server routes. Three advisory warnings surfaced and were triaged:
> - **MEDIUM (deferred):** no Subresource Integrity hashes on the CDN-loaded OpenCV + pdfjs worker. Revisit before any production rollout with real users — either add `integrity="sha384-..."` attributes or copy `pdfjs-dist/build/pdf.worker.min.mjs` into `public/` at install time. Out of scope for dev-phase 1.2 because the parse route is still a 501 stub and no users are touching this.
> - **LOW (fixed):** OpenCV URL pinned from `4.x` → `4.10.0`.
> - **LOW (fixed):** `opencvPromise` reset-on-rejection so a single CDN failure doesn't permanently disable deskew.
> - **LOW (deferred):** no CSP header in `next.config.mjs` or `middleware.ts`. Pre-existing gap — tracking for Phase 4.
>
> **End-to-end right now (as of 1.2):** upload → storage → DB row (`pending`) → `runOcr` runs the real pipeline → row patched to `ocr_done` with populated `ocr_text` → `POST /api/receipts/parse` returns 501 → uploader surfaces `"Could not parse receipt."`. The `status='failed'` path now only fires when `runOcr` actually throws (corrupt PDF, Tesseract crash, etc.), not on every upload. When 1.3 lands, the uploader reaches `done` without further edits — the contract is intact.
>
> **Notes for 1.3 handoff (`groq-prompt-engineer`):** `runOcr` returns text that is already lowercased, whitespace-collapsed, and capped at 8000 chars. The Groq system prompt should assume lowercase input. Empty string is possible (blurry photo, OpenCV failure compounded with an unreadable image) — the parse route should treat `ocr_text === ''` as "0 items" rather than throwing.

**File:** [src/lib/ocr/runOcr.ts](src/lib/ocr/runOcr.ts)

The OCR pipeline is **compress → deskew → Tesseract → clean**. Three libraries carry the first three steps so we don't have to hand-roll image ops.

**Library: [`browser-image-compression`](https://github.com/Donaldcwl/browser-image-compression)** — shrinks 12MP phone photos before they ever reach Tesseract. A 4000×3000 JPEG that takes ~20s to OCR becomes a 1500px image that takes ~4s with negligible accuracy loss for receipts.
- Install: `npm i browser-image-compression`
- Input: `File`, `{ maxWidthOrHeight: 1500, maxSizeMB: 1.5, useWebWorker: true, initialQuality: 0.85 }`
- Output: compressed `File` — use it for both the Supabase upload *and* the OCR input.
- Skip when `file.type === 'application/pdf'`.

**Library: [`jscanify`](https://github.com/puffinsoft/jscanify)** — detects document corners and warps the image to a clean flat rectangle. Receipts are almost always photographed at an angle; feeding a deskewed canvas into Tesseract is the single biggest OCR accuracy improvement for this app.
- Install: `npm i jscanify` (depends on OpenCV.js loaded via script tag from `https://docs.opencv.org/4.x/opencv.js`)
- Input: `HTMLImageElement` built from the compressed file
- Output: `HTMLCanvasElement` with the receipt extracted and flattened
- Usage: `const scanner = new jscanify(); const canvas = scanner.extractPaper(imgEl, 1500, 2000);`
- On failure (no quad detected) fall back to the raw image — never block the pipeline.

**Library: [`tesseract.js`](https://github.com/naptha/tesseract.js)** — already in deps. Feed it the deskewed canvas rather than the raw file:
```ts
import Tesseract from 'tesseract.js';
import imageCompression from 'browser-image-compression';
import jscanify from 'jscanify';

export async function runOcr(file: File): Promise<string> {
  const compressed = file.type.startsWith('image/')
    ? await imageCompression(file, { maxWidthOrHeight: 1500, maxSizeMB: 1.5, useWebWorker: true })
    : file;

  const source = await prepareSource(compressed); // HTMLCanvasElement | File
  const { data } = await Tesseract.recognize(source, 'eng', { logger: () => {} });
  return cleanOcrText(data.text);
}
```
`prepareSource` loads the compressed image into an `<img>`, hands it to `jscanify.extractPaper`, and returns the canvas (or the original file on failure / PDFs).

**Library: [`pdfjs-dist`](https://github.com/mozilla/pdf.js)** — for PDF receipts. Render page 1 to a canvas, then run it through the same jscanify → Tesseract path above.
- Input: `ArrayBuffer` from `file.arrayBuffer()`
- Output: `HTMLCanvasElement` of page 1 at ~2× scale for legibility

**Text cleanup:** lowercase, collapse whitespace, drop lines shorter than 3 chars, cap at 8K chars before handing off to Groq. Plain string ops — no library needed.

**Why client-side:** keeps the Vercel function under its 10–60s window and avoids server-side image processing.

### 1.3 Groq receipt parser

> **Status: shipped.** [src/lib/groq/parseReceipt.ts](src/lib/groq/parseReceipt.ts) and [src/app/api/receipts/parse/route.ts](src/app/api/receipts/parse/route.ts) are now fully wired. A successful upload now walks all the way through: storage → `pending` → real OCR → `ocr_done` with populated `ocr_text` → Groq parse + Fuse category resolve → `pantry_items` insert → `parsed` → success toast with a **View pantry** link. `npm run typecheck`, `npm run lint`, and `npm run build` are all clean.
>
> **Decisions made beyond the bare spec below:**
> - **`parseReceipt(ocrText, categoryKeys)` takes the category list as a second argument** instead of fetching from `shelf_life_rules` itself. The route handler fetches the keys once per request and passes them in, keeping the Groq helper pure (no DB coupling, trivially testable).
> - **Hand-authored JSON schema const, not `zod-to-json-schema`.** The library is incompatible with Zod v4 (produces an empty `$ref` schema), so `RECEIPT_SCHEMA_JSON` in `parseReceipt.ts` mirrors `parsedReceiptItemSchema` by hand with a one-line WHY comment above it. The unused `zod-to-json-schema` dep was removed from `package.json` per the audit's must-fix. If `zod-to-json-schema` ships Zod v4 support later, swap the const for a generated schema and delete the comment.
> - **Empty-OCR short-circuit.** `parseReceipt` returns `[]` immediately when `ocrText.trim() === ''` — blurry photos / OpenCV-disabled sessions don't burn Groq tokens. The route handles zero-items gracefully (no insert, still flips to `parsed`).
> - **Fuse two-tier resolve.** Each item's category is resolved via `fuse.search(normalized_name)[0]` first, then `fuse.search(category)[0]`, then `'other'`. This catches the common case where Groq emits `category: "produce"` but `normalized_name: "romaine lettuce"` — we want it to land on `'leafy_greens'`.
> - **Route auth-gates before any DB or Groq call.** `supabase.auth.getUser()` runs first, returns 401 on no session. A caller without a cookie burns zero Groq tokens and reads zero OCR text.
> - **Zod-validates the body** (`receiptId: z.string().uuid()`) before any DB query. Malformed JSON returns 400, invalid body returns 400.
> - **Fail-path flips `status='failed'`** on Groq/Zod failure OR on pantry insert failure, via the RLS-scoped client (no explicit `user_id` filter needed — `auth.uid() = user_id` policy covers it). The success path flips to `'parsed'` at the end.
> - **Response body is minimal**: `{ ok: true, count }`. No echoing of parsed items back to the client — the uploader only checks `res.ok`, so there's no reason to expand the response surface.
> - **`estimated_expiration_at` stays `null` and `status='fresh'`** on every inserted item. Phase 2 will fill in real expiration dates and computed statuses; 1.3 deliberately stops at `null` per the spec.
> - **`parsedReceiptSchema` already existed** in [src/lib/validation/schemas.ts](src/lib/validation/schemas.ts) from Phase 0.4 — reused, not redefined.
> - **Dev-mode token logging.** `parseReceipt` prints `{ prompt, completion, total }` token counts to the console only when `NODE_ENV === 'development'`, so you can eyeball token burn while iterating without noisy production logs.
>
> **Audit (`rls-security-auditor`):** clean on all hard rules — 401 gate before any side effect, RLS scoping on every query, `user_id` sourced from the session (not the client body), `SUPABASE_SERVICE_ROLE_KEY` containment intact, `GROQ_API_KEY` server-only, no retry loops, no secrets in logs. One must-fix (unused `zod-to-json-schema` dep) was addressed inline. Two advisory warnings triaged:
> - `receipts.update({status:'failed'})` on the error path doesn't carry an explicit `user_id` filter — accepted, RLS covers it, and the alternative would be dead code.
> - Middleware `PROTECTED_PREFIXES` doesn't include `/api/receipts/parse` — accepted, API routes are gated in-handler per Next.js convention.
>
> **End-to-end right now (as of 1.3):** upload → storage → `pending` → real `runOcr` → `ocr_done` → `POST /api/receipts/parse` (real Groq + Fuse + DB insert) → `parsed` → success toast → items visible on `/pantry`. The `ocr_done` rows left behind by 1.2 testing are not automatically advanced by 1.3 — the uploader only POSTs on fresh uploads. Re-upload to see parsed results for an old receipt. Stale `failed` rows from 1.1/1.2 testing are also untouched.
>
> **Notes for 1.4 handoff (`nextjs-builder`, pantry page):** `pantry_items` rows inserted by 1.3 have `estimated_expiration_at=null` and `status='fresh'` — the pantry page should render those fields gracefully until Phase 2 fills them in. The `category` field is always one of the `shelf_life_rules` keys or the literal string `'other'` — never a free-form Groq string.
>
> **Notes for Phase 2 handoff (`shelf-life-researcher` / `supabase-architect`):** every row also has a valid `receipt_id` and `purchased_at` (derived from `receipts.uploaded_at::date`), so the expiration estimator has everything it needs — no backfill from OCR text required.

**File:** [src/lib/groq/parseReceipt.ts](src/lib/groq/parseReceipt.ts)

**Library: [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema)** — generate the JSON schema string directly from the Zod schema and embed it in the system prompt. One source of truth: if the Zod schema changes, the prompt changes with it. Also improves Groq JSON-mode adherence.
- Install: `npm i zod-to-json-schema`
- Input: `zodToJsonSchema(parsedReceiptSchema, 'ParsedReceipt')`
- Output: JSON Schema object → `JSON.stringify(..., null, 2)` into the system prompt template
- **Do NOT use [`instructor-js`](https://github.com/instructor-ai/instructor-js)** — it auto-retries on Zod failure, which violates the global "no retry loops on Groq failures" rule.

**Library: [`fuse.js`](https://www.fusejs.io/)** — fuzzy-map Groq's free-form category strings (e.g. `"romaine lettuce"`, `"baby spinach"`) to the canonical keys in `shelf_life_rules` (`"leafy_greens"`). Deterministic, server-side, zero tokens.
- Install: `npm i fuse.js`
- Input: list of `{ key, aliases[] }` built from `shelf_life_rules`, Fuse config `{ keys: ['key','aliases'], threshold: 0.4 }`
- Output: `fuse.search(item.normalized_name)[0]?.item.key ?? 'other'` — the resolved category stored on `pantry_items.category`
- Call inside the parse route, **after** Zod validation, **before** the insert.

1. System prompt (kept short — token budget matters):
   ```
   You convert raw OCR text from grocery receipts into a JSON array of items.
   Output ONLY valid JSON matching the schema below. No prose.
   Ignore non-food lines (totals, taxes, store name, addresses, payment info).

   Schema:
   <generated via zod-to-json-schema at module load>
   ```
2. User prompt: just the cleaned OCR text.
3. Use `response_format: { type: "json_object" }` and request a wrapper `{ "items": [...] }`.
4. Per-item schema:
   ```ts
   {
     name: string,
     normalized_name: string,  // lowercase canonical, e.g. "milk", "chicken breast"
     category: string,         // matches a key in shelf_life_rules (fuse-resolved server-side)
     quantity: number | null,
     unit: string | null
   }
   ```
5. Validate with Zod; reject and log if invalid (do NOT re-prompt to keep cost down).
6. After validation, resolve each item's `category` through the Fuse index so the DB never sees a category that isn't in `shelf_life_rules`.

**File:** [src/app/api/receipts/parse/route.ts](src/app/api/receipts/parse/route.ts)

1. POST handler: read `receiptId`, load the receipt row (RLS scoped), pull `ocr_text`.
2. Call `parseReceipt(ocrText)`.
3. For each item:
   - `purchased_at = receipt.uploaded_at::date`
   - Insert into `pantry_items` with `status='fresh'`, `estimated_expiration_at=null` (Phase 2 fills this).
4. Update receipt `status='parsed'`.
5. Return parsed items to the client.

### 1.4 Pantry page

> **Status: shipped.** [src/app/(app)/pantry/page.tsx](src/app/(app)/pantry/page.tsx) is now a real async server component: `createClient()` → `auth.getUser()` (belt-and-braces alongside the middleware `PROTECTED_PREFIXES` gate) → `.from('pantry_items').select('id, name, category, quantity, unit, purchased_at, estimated_expiration_at, status').order('category').order('purchased_at desc')` → group by `category ?? 'other'` into a `{ category, label, items }[]` sorted alphabetically by label with `'Other'` pinned last → render a group heading (`h2`) above a flat `PantryList` grid per group. No `user_id` filter on the query — RLS scoping is implicit. Query errors `throw` for the Next error boundary; no hand-rolled error cards. Zero `'use client'` in the feature. `npm run typecheck`, `npm run lint`, and `npm run build` are all clean; `/pantry` ships as a `ƒ` dynamic server route.
>
> **Decisions made beyond the bare spec above:**
> - **New helper [src/lib/pantry/categoryLabels.ts](src/lib/pantry/categoryLabels.ts)** — pure `formatCategoryLabel(key: string | null): string` converting snake_case → Title Case, with both `null` and `'other'` collapsing to `'Other'`. No DB lookup, no hard-coded key list — the 20 canonical keys from [supabase/migrations/0002_shelf_life_seed.sql](supabase/migrations/0002_shelf_life_seed.sql) all follow the snake_case shape so generic splitting is enough.
> - **`PantryList` empty state is a dashed-border card**, not a plain `<p>`. Copy: `Your pantry is empty.` + primary **Upload a receipt** button. The button is a plain `<a href="/receipts/upload">` styled with `buttonVariants()` — same pattern as [src/app/(app)/receipts/page.tsx](src/app/(app)/receipts/page.tsx) uses, deliberately avoiding `<Link>` to dodge the App Router prefetch staleness documented in the 1.1 notes.
> - **`PantryItemCard` layout collapsed to one line** — qty/unit and purchase date render as `qty unit · date` on a single secondary line via `const qtyLine = [item.quantity, item.unit].filter(Boolean).join(' ')`. When both are null the separator and the ghost whitespace both drop cleanly; the card shows just the date. `date-fns`'s `parseISO(item.purchased_at)` + `format(..., 'MMM d, yyyy')` does the date math — no `new Date(string)` anywhere.
> - **Category badge was removed from `PantryItemCard` post-ship.** An initial version rendered the human-readable category as a `<Badge>` inside every card, but because the page now renders a group heading (e.g. **Bread**) above the cards, the badge was a verbatim duplicate of the heading on every row. Dropped the `Badge` import entirely; the card is now `{name} / {qty unit · date}`. The `formatCategoryLabel` helper is still used at the page level for group headings.
> - **Belt-and-braces auth gate** — the middleware already redirects unauthed `/pantry` requests to `/login?redirectTo=/pantry`, but the page *also* calls `auth.getUser()` and redirects on null. Costs one extra server call, buys defense-in-depth if middleware regresses.
> - **Phase 2 stub columns intentionally ignored.** Every row today has `estimated_expiration_at=null` and `status='fresh'` (the Phase 1.3 stub state). The card does not read either column — no expiration line, no status pill. Phase 2.5 will light them up without touching this page; verification step 11 confirms a manually-patched `status='use_soon'` row renders identically to a `fresh` row today.
>
> **Audit (`rls-security-auditor`):** clean — 0 must-fix. RLS policy `auth.uid() = user_id` on `pantry_items` covers the only operation this page performs (SELECT). `createClient()` uses the anon key + cookie session — not the service role. `SUPABASE_SERVICE_ROLE_KEY` still has exactly one import site ([src/app/api/dev/session/route.ts](src/app/api/dev/session/route.ts)). `PROTECTED_PREFIXES` still lists `/pantry`. Two advisory warnings triaged:
> - **LOW (accepted):** `if (error) throw error` surfaces raw Supabase error messages via the Next error boundary. Matches repo convention (no hand-rolled error cards elsewhere in the `(app)` segment); acceptable for an internal-user-only dev phase. Revisit in Phase 4 polish alongside a proper `error.tsx` boundary under `(app)/`.
> - **LOW (accepted):** `parseISO(item.purchased_at)` relies on the `purchased_at NOT NULL DEFAULT current_date` constraint in [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql). If the schema ever relaxes that constraint, the card will throw — tracked via the type definition (`PantryItem.purchased_at: string`, not `string | null`).
>
> **End-to-end right now (as of 1.4):** upload → storage → `pending` → OCR → `ocr_done` → Groq parse + Fuse + insert → `parsed` → success toast with **View pantry** link → `/pantry` renders the new items grouped by category heading, sorted by `purchased_at desc` within each group. The Phase 1 goal — "a user uploads one receipt and sees parsed items appear on the pantry page" — is now fully visible end-to-end. Bad OCR still produces garbage item names (e.g. `ren`, `sei`, `govaltl`) because the Tesseract output from hard receipts is low-quality; the page renders those strings faithfully rather than trying to sanitize them. Fixing OCR quality is a Phase 1.2 / Phase 4 concern, not a 1.4 concern.
>
> **Notes for 1.5 handoff (`nextjs-builder`, receipts list page):** [src/app/(app)/receipts/page.tsx](src/app/(app)/receipts/page.tsx) is still the Phase 0.4 placeholder (`"No receipts yet."`). The pantry page establishes the page-level conventions 1.5 should mirror: `createClient()` + `auth.getUser()` at the top, implicit RLS on the query (no `.eq('user_id', ...)`), `throw` on query error, server component only (no `'use client'`), `<section className="space-y-4">` + `text-2xl font-semibold` h1, plain `<a>` (not `<Link>`) for the inbound upload CTA. Reuse `formatCategoryLabel` if you need category labels on the detail view.
>
> **Notes for Phase 2 handoff (`shelf-life-researcher` / `supabase-architect`):** the pantry page already selects `estimated_expiration_at` and `status` in its query tuple — Phase 2 only needs to (a) backfill the columns via the estimator and (b) light up the card UI. The server component will pick up the new data on its next render with zero edits to `page.tsx`.

**File:** [src/app/(app)/pantry/page.tsx](src/app/(app)/pantry/page.tsx)

1. Server component fetches all pantry items for `auth.uid()`.
2. Group by `category`.
3. Render `PantryItemCard` for each: name, qty, purchase date, category badge.
4. Empty state: link to upload.

### 1.5 Receipts list page

**File:** [src/app/(app)/receipts/page.tsx](src/app/(app)/receipts/page.tsx)

1. List user's uploaded receipts with status pill.
2. Click → detail view showing OCR text + parsed items.

### 1.6 Exit criteria for Phase 1
- A receipt image uploads, runs OCR, parses via Groq, and items appear on `/pantry`.
- Bad OCR or bad JSON shows a graceful error and does not crash the app.
- All data is RLS-scoped to the logged-in user.

---

## Phase 2 — Expiration Intelligence

**Goal:** Every pantry item gets a deterministic estimated expiration date and a `fresh` / `use_soon` / `likely_expired` status.

### 2.1 Shelf-life rules

**Data source: [USDA FoodKeeper dataset](https://catalog.data.gov/dataset/fsis-foodkeeper-data)** — public-domain JSON/CSV dataset with shelf-life ranges for hundreds of foods across pantry / fridge / freezer. Hand this file to the `shelf-life-researcher` subagent instead of manually researching ranges.
- Input: `FoodKeeper.json` downloaded from data.gov
- Output: `supabase/migrations/0002_shelf_life_seed.sql` (already shipped — re-run against the FoodKeeper extract if you want tighter ranges later)
- Map FoodKeeper's `Name_subtitle` + `Keywords` columns onto your canonical category keys; pick the midpoint of the "Refrigerate After Opening" range as `default_days`.

1. Confirm `shelf_life_rules` is seeded with realistic defaults from the FoodKeeper dataset.
2. Add a `storage` column so rules can differ between fridge/pantry/frozen.

### 2.2 Estimator

**File:** [src/lib/shelfLife/estimate.ts](src/lib/shelfLife/estimate.ts)

**Library: [`date-fns`](https://date-fns.org/)** — already in deps. Use `addDays`, `differenceInDays`, `startOfDay` for all date math. Do not reach for `dayjs` or `moment`. No LLM in this file — ever.

```ts
export type EstimateInput = {
  category: string;
  purchasedAt: Date;
};
export type EstimateResult = {
  estimatedExpirationAt: Date;
  status: 'fresh' | 'use_soon' | 'likely_expired';
};

export async function estimateExpiration(
  input: EstimateInput,
  rules: Map<string, number>
): Promise<EstimateResult> {
  const days = rules.get(input.category) ?? 7; // default fallback
  const exp = addDays(input.purchasedAt, days);
  const today = startOfDay(new Date());
  const daysLeft = differenceInDays(exp, today);
  const status =
    daysLeft < 0 ? 'likely_expired'
    : daysLeft <= 2 ? 'use_soon'
    : 'fresh';
  return { estimatedExpirationAt: exp, status };
}
```

**Important:** date math is deterministic — never delegated to the LLM.

### 2.3 Wire estimator into parsing pipeline

1. Modify `/api/receipts/parse` to call `estimateExpiration` for each item before insert.
2. Backfill: add a one-shot script `scripts/backfill-expirations.ts` for items already in DB.

### 2.4 Daily status refresh

Pantry status changes as time passes. Options (pick one):
- **Option A (simplest):** Compute status on read in the pantry query (`SELECT ..., CASE WHEN ... END as status`). No background job. Recommended for MVP.
- **Option B:** Supabase scheduled Edge Function that runs nightly to update statuses.

Go with **Option A** for Phase 2.

### 2.5 UI updates

1. Add status badges with colors: green (fresh), amber (use soon), red (likely expired).
2. Add a "Use Soon" filter chip on `/pantry`.
3. Add a "Use Soon" widget on `/dashboard` showing top 5 items.

### 2.6 Exit criteria for Phase 2
- Every newly parsed item has an estimated expiration date.
- Pantry visually distinguishes the three statuses.
- "Use Soon" filter works.

---

## Phase 3 — Meal & "Use Soon" Suggestions

**Goal:** From the current pantry, generate 3–5 simple meal ideas that prioritize use-soon items.

**New deps this phase:** none — Spoonacular and TheMealDB are plain `fetch` calls. Add `SPOONACULAR_API_KEY` to `.env`, `.env.example`, and Vercel Production.

**Architecture shift (high-leverage):** Instead of asking Groq to invent meals from scratch — which is hallucination-prone, burns the bulk of your daily token budget, and produces generic recipes — fetch real recipes from a free recipe API keyed on pantry ingredients, then use Groq *only* to write the one-sentence "why this meal" reason. This cuts Groq TPM by ~80% and returns recipes with images, real ingredient lists, and accurate `missing_ingredients` arrays.

### 3.1 Suggestion endpoint

**File:** [src/app/api/meals/suggest/route.ts](src/app/api/meals/suggest/route.ts)

**Library: [Spoonacular `findByIngredients`](https://spoonacular.com/food-api/docs#Search-Recipes-by-Ingredients)** (primary) — free tier 150 points/day (one `findByIngredients` call ≈ 1 point). Takes a comma-separated ingredient list and returns ranked recipes with `usedIngredients[]` and `missedIngredients[]` — literally the Phase 3 output shape, for free.
- No SDK needed; native `fetch`.
- Input: `GET https://api.spoonacular.com/recipes/findByIngredients?ingredients=spinach,chicken,rice&ranking=2&number=5&ignorePantry=true&apiKey=${SPOONACULAR_API_KEY}`
  - `ranking=2` = minimize missing ingredients (better for "use what I have")
- Output: `Array<{ id, title, image, usedIngredients: {name,amount,unit}[], missedIngredients: {name}[], likes }>`
- Env var: add `SPOONACULAR_API_KEY` (server-only) to `.env`, `.env.example`, and Vercel Production.

**Library: [TheMealDB `filter.php?i=`](https://www.themealdb.com/api.php)** (fallback, no key) — used when Spoonacular is quota-capped or errors out. Free, no auth, single-ingredient filter.
- Input: `GET https://www.themealdb.com/api/json/v1/1/filter.php?i=chicken_breast`
- Output: `{ meals: [{ idMeal, strMeal, strMealThumb }] }` — less rich than Spoonacular (no `missedIngredients`), but enough for a degraded experience.

Steps:
1. POST handler authenticated via Supabase server client.
2. Load all pantry items with `status in ('fresh','use_soon')`, tag the use-soon ones.
3. Build the ingredient list: `use_soon` items first, then `fresh`, cap at 20 names, join with commas.
4. Call Spoonacular `findByIngredients` with `number=5&ranking=2`. On non-2xx or quota error, fall through to TheMealDB with the top `use_soon` ingredient.
5. Pass the returned recipe titles + used ingredients to `generateMealReasons()` (Groq, see 3.2) to get the one-sentence reason per meal.
6. Persist to `meal_suggestions` and return to client.

### 3.2 Groq meal reason generator (trimmed)

**File:** [src/lib/groq/suggestMeals.ts](src/lib/groq/suggestMeals.ts)

Groq's only job here is writing the `reason` field for each meal Spoonacular already picked — a tiny prompt, a tiny output. The meal titles and ingredient lists come from Spoonacular; Groq never invents a recipe.

1. System prompt:
   ```
   For each meal, write ONE short sentence explaining why it's a good pick given
   the user's pantry, especially items marked "use_soon". Output JSON only.
   ```
2. User prompt: compact JSON like `{ meals: [{ title, uses: [...] }], useSoon: [...] }`.
3. Output schema (Zod-validated):
   ```ts
   { reasons: Array<{ title: string; reason: string }> }
   ```
4. Use `response_format: { type: "json_object" }` and `zod-to-json-schema` (same helper as 1.3) to embed the schema.
5. Merge `reasons` back onto the Spoonacular recipes by `title` match. If a title has no matching reason, default to `""` — never block the response.
6. Validate with Zod. On failure, return the Spoonacular meals with empty reasons (graceful degrade, no retry loop).

Final `MealCard` shape stays what the UI already expects:
```ts
{
  title: string,
  image: string | null,
  ingredients_used: string[],
  missing_ingredients: string[],
  reason: string
}
```

### 3.3 Token discipline (critical for free tier)
- Spoonacular does the heavy lifting — Groq prompt is now ~200 tokens instead of ~2K.
- **Never** include receipt history, full item ids, dates, or quantities in any prompt.
- Cap ingredient list sent to Spoonacular at 20 items; cap meals passed to Groq at 5.
- Cache last suggestion in `meal_suggestions` and reuse if pantry hasn't changed in the last hour — this ALSO protects the Spoonacular quota, which is the new bottleneck.
- Track Spoonacular point usage in the `withGroqGuard`-equivalent helper (or a parallel `withSpoonacularGuard`) so we don't blow the 150/day ceiling.

### 3.4 Meals page

**File:** [src/app/(app)/meals/page.tsx](src/app/(app)/meals/page.tsx)

1. Button: "Suggest meals from my pantry" → calls `/api/meals/suggest`.
2. Renders `MealCard` for each suggestion.
3. Each card shows title, used ingredients (chips), missing ingredients (faded chips), reason.
4. Action buttons: "Mark cooked" (sets used items to `consumed`) and "Save".

### 3.5 Guardrails (light)
- Run user-provided text (e.g. notes, preferences if added later) through a short keyword-based filter before sending to Groq.
- Note in code where Llama Prompt Guard 2 could be plugged in if abuse becomes a concern.

### 3.6 Exit criteria for Phase 3
- Pantry → 3–5 meal cards generated by Groq in <5s.
- "Mark cooked" decrements pantry items.
- Endpoint stays under 6K TPM ceiling for normal usage.

---

## Phase 4 — Product Polish

**Goal:** Move from demo to real-feeling app.

**New deps this phase:**
```bash
npm i react-hook-form @hookform/resolvers @tremor/react recharts next-themes
npx shadcn@latest add drawer   # pulls in vaul
```

### 4.1 Pantry editing

**Library: [`react-hook-form`](https://react-hook-form.com/) + [`@hookform/resolvers/zod`](https://github.com/react-hook-form/resolvers)** — reuse the Zod schemas from [src/lib/validation/schemas.ts](src/lib/validation/schemas.ts) for inline pantry-item edit forms. One line for validation, automatic dirty tracking, plays nicely with shadcn's `<Form>` wrapper.
- Install: `npm i react-hook-form @hookform/resolvers`
- Input: `useForm({ resolver: zodResolver(pantryItemSchema), defaultValues: item })`
- Output: typed `handleSubmit((values) => …)` with field errors wired to shadcn `<FormMessage>`
- Use on inline edit rows and the manual-add form (4.3).

- Inline edit name, qty, category, expiration date.
- Bulk select + delete.
- "Mark used" button per item; sets `status='consumed'`.

### 4.2 Filters & search

**Library: [`fuse.js`](https://www.fusejs.io/)** — already added in 1.3; reuse a client-side Fuse instance over the pantry list for the search box. Tolerates typos ("chiken" → "chicken breast") without needing a Postgres full-text index.
- Input: `new Fuse(items, { keys: ['name','normalized_name','category'], threshold: 0.35 })`
- Output: `fuse.search(query).map(r => r.item)` — debounced with a simple `useDeferredValue` or ~150ms setTimeout
- Filter chips and category dropdown stay as plain `.filter()` calls — don't over-engineer.

- Filter chips: All / Fresh / Use Soon / Expired / Consumed.
- Category dropdown.
- Text search on `normalized_name`.

### 4.3 Manual add
- "Add item" form for items bought without a receipt.
- Uses the same `react-hook-form` + `zodResolver` setup as 4.1.

### 4.4 Dashboard

**Library: [`@tremor/react`](https://www.tremor.so/)** — pre-styled KPI cards, spark-lines, and bar charts built on Recharts. Matches shadcn's aesthetic out of the box and saves writing any chart boilerplate.
- Install: `npm i @tremor/react` (pulls `recharts` as a peer dep)
- Input: server-queried `{ inPantry, expiringThisWeek, mealsThisWeek, wastedThisMonth, weeklySeries: [{ date, added, used, wasted }] }`
- Output: `<Card><Metric>…</Metric></Card>` for KPIs and `<BarChart data={weeklySeries} categories={['added','used','wasted']} />` for the weekly summary
- Wire on [src/app/(app)/dashboard/page.tsx](src/app/(app)/dashboard/page.tsx).

- KPIs: items in pantry, items expiring this week, meals suggested this week, items wasted this month.
- Weekly summary card: added vs. used vs. wasted.
- "Waste avoided" metric: count of items moved to `consumed` before `estimated_expiration_at`.

### 4.5 Receipt detail improvements
- Side-by-side: original image + parsed items + raw OCR text.
- "Re-parse" button to retry Groq parsing.

### 4.6 UX polish

**Library: [`next-themes`](https://github.com/pacocoursey/next-themes)** — two-line dark mode with no flash-of-wrong-theme. Pairs with shadcn's CSS variables already configured in 0.1.
- Install: `npm i next-themes`
- Input: wrap the app in `<ThemeProvider attribute="class" defaultTheme="system">` in `src/app/layout.tsx`
- Output: `const { theme, setTheme } = useTheme()` inside the nav toggle

**Library: [`vaul`](https://vaul.emilkowal.ski/)** — swipe-up mobile drawer for pantry item detail. Already a shadcn peer dep if you add the `drawer` component via `npx shadcn@latest add drawer`.
- Input: `<Drawer open={…} onOpenChange={…}>` wrapping the item detail content
- Output: native-feeling swipe gesture on mobile, modal on desktop

**Library: [`sonner`](https://sonner.emilkowal.ski/)** — already installed in 0.1. Use `toast.success` / `toast.error` for every async action. No per-page setup — the `<Toaster />` lives once in the root layout.

- Toast notifications for all async actions (sonner).
- Loading skeletons (shadcn `Skeleton`).
- Empty states with illustrations.
- Mobile-responsive nav.
- Dark mode via `next-themes`.

### 4.7 Exit criteria for Phase 4
- All CRUD on pantry items works.
- Dashboard renders real metrics.
- App works on a phone in portrait mode.

---

## Phase 5 — Stretch Features (Optional)

Pick any depending on time.

**New deps per feature (install only what you ship):**
```bash
# #3 Email reminders
npm i resend @react-email/components
# #5 Barcode scanning
npm i @zxing/browser @zxing/library
# #6 CSV export
npm i papaparse
npm i -D @types/papaparse
```

1. **Recurring grocery trends:** "You buy bananas every 4 days on average." Pure SQL — `date_trunc` + `lag()` window functions. No library; resist the urge to reach for `simple-statistics`.

2. **Favorite meal suggestions:** Save meals; surface them again when ingredients are present. No new deps — just a `favorites` boolean on `meal_suggestions`.

3. **Email reminders:**
   - **Library: [`resend`](https://resend.com/)** (free tier 3K/mo, 100/day) + **[`react-email`](https://react.email/)** for typed JSX email templates.
   - Install: `npm i resend @react-email/components`
   - Input: `<ExpiringDigestEmail items={items} />` rendered with `render()` from `@react-email/components`
   - Output: `await resend.emails.send({ from, to, subject, react: <ExpiringDigestEmail …/> })`
   - Triggered from a Supabase scheduled Edge Function (`pg_cron` → HTTP POST to a Next route handler) once a day.

4. **Shared household mode:** Add `households` table; pantry items belong to a household; invite via email link (reuse Resend from #3).

5. **Barcode scanning:**
   - **Library: [`@zxing/browser`](https://github.com/zxing-js/browser)** — camera-driven barcode reader in the browser.
   - Install: `npm i @zxing/browser @zxing/library`
   - Input: a `<video>` element ref → `new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, videoEl, cb)`
   - Output: `Result.getText()` = UPC/EAN string
   - **Library: [Open Food Facts API](https://world.openfoodfacts.org/data)** (free, no key) for the UPC → product lookup. Skips OCR entirely for single-item adds.
     - Input: `GET https://world.openfoodfacts.org/api/v2/product/{upc}.json`
     - Output: `{ product: { product_name, categories_tags, brands } }` → map `categories_tags` through the Fuse category resolver from 1.3.

6. **CSV export:**
   - **Library: [`papaparse`](https://www.papaparse.com/)** — bulletproof CSV encoder. Handles quoting, commas-in-names, and BOM.
   - Install: `npm i papaparse @types/papaparse`
   - Input: `Papa.unparse(pantryRows, { columns: ['name','category','purchased_at','estimated_expiration_at','status'] })`
   - Output: CSV string → wrap in a `Blob` and trigger a download link. ~5 lines total.

---

## Cross-Cutting Concerns

### Validation
- Every Groq response is parsed with Zod. Failure = log + user-facing toast, never a crash.
- Every form is validated with Zod on both client and server.

### Rate-limit safety (Groq)
- Wrap Groq calls in a tiny `withGroqGuard` helper that:
  - Tracks calls per minute in memory (per-instance, best-effort).
  - Returns a friendly "slow down" error if >25 RPM.
- Log token usage per call to spot drift.

### Error handling
- API routes return `{ ok: false, error: string }` on failure.
- Client uses a single `toast.error(error)` helper.
- No silent failures in the parsing pipeline — always update receipt status to `failed` with reason.

### Security
- RLS on every table; verify with a "log in as user B, try to read user A's pantry" test.
- Storage bucket policy: only owner can read/write their own folder.
- Service-role key only used in server route handlers, never exposed to client.
- Sanitize OCR text length (cap at ~8K chars before sending to Groq).

### Testing strategy
- Unit-test `estimateExpiration` (pure function) with a few categories and dates.
- Unit-test Zod schemas against good/bad sample LLM outputs.
- Manual end-to-end test checklist:
  1. Sign up new user.
  2. Upload sample receipt.
  3. Verify parsed items.
  4. Verify expiration estimates.
  5. Generate meals.
  6. Mark cooked.
  7. Verify dashboard updates.
  8. Log in as second user, confirm no cross-access.

### Observability
- `console.log` Groq token counts and durations in dev.
- Vercel logs are enough for free tier; no Sentry yet.

### Cost & quota dashboard (informal)
- Add a `/admin/usage` page (gated to your email) showing Groq calls today and DB row counts.

---

## Milestone Schedule (Suggested)

| Week | Milestone |
|---|---|
| 1 | Phase 0 complete: deployed skeleton with auth. |
| 2 | Phase 1 complete: receipt → pantry working end-to-end. |
| 3 | Phase 2 complete: expiration estimates + statuses. |
| 4 | Phase 3 complete: meal suggestions live. |
| 5 | Phase 4 polish, dashboard, mobile QA. |
| 6 | Phase 5 stretch + write a README + record demo video. |

---

## Definition of Done (Whole Project)

1. Live URL on Vercel that anyone can sign up to.
2. Upload a receipt → see pantry items with expiration estimates → get meal suggestions. All in under 60 seconds end-to-end.
3. README with screenshots, architecture diagram, env var list, and a 60-second demo gif.
4. RLS verified across users.
5. Groq usage stays comfortably under free-tier limits during a normal 10-receipt day.
6. Code passes lint and TypeScript strict mode.
