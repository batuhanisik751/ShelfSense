# ShelfSense — Implementation Plan

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

> **Status: shipped.** Implemented in [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql), [0002_shelf_life_seed.sql](supabase/migrations/0002_shelf_life_seed.sql), and [0003_storage_policies.sql](supabase/migrations/0003_storage_policies.sql). Verified locally with `supabase db reset` + a functional RLS cross-user test (11/11). Not yet pushed to remote — run `npx supabase db push` when ready.
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

### 0.6 Exit criteria for Phase 0
- App builds and deploys to Vercel.
- A user can sign up, log in, and reach an empty `/pantry` page.
- DB tables exist with RLS enforced.
- Env vars set in Vercel.

---

## Phase 1 — Foundation MVP (Receipt → Pantry)

**Goal:** A user uploads one receipt and sees parsed items appear on the pantry page.

### 1.1 Receipt upload flow

**File:** [src/components/receipts/ReceiptUploader.tsx](src/components/receipts/ReceiptUploader.tsx)

Steps:
1. Render a file input accepting `image/png, image/jpeg, image/webp, application/pdf`.
2. Client-side validate: max 8 MB (well below Supabase's 50 MB cap, keeps OCR quick).
3. On select:
   - Upload file to Supabase Storage at `receipts/{user_id}/{uuid}.{ext}`.
   - Insert a row in `receipts` with `status='pending'`.
   - Trigger client-side OCR (see 1.2).
   - On OCR success, PATCH the receipt with `ocr_text` and `status='ocr_done'`.
   - Call `/api/receipts/parse` with `{ receiptId }`.
4. Show progress states: uploading → OCR → parsing → done.

### 1.2 OCR (client-side primary)

**File:** [src/lib/ocr/runOcr.ts](src/lib/ocr/runOcr.ts)

1. Use `tesseract.js` in the browser:
   ```ts
   import Tesseract from 'tesseract.js';
   export async function runOcr(file: File): Promise<string> {
     const { data } = await Tesseract.recognize(file, 'eng', { logger: () => {} });
     return data.text;
   }
   ```
2. For PDFs: use `pdfjs-dist` to render page 1 to a canvas, then OCR the canvas.
3. Pre-process: lowercase, strip duplicate whitespace, drop lines shorter than 3 chars before sending to Groq (saves tokens).

**Why client-side:** keeps the Vercel function under its 10–60s window and avoids server-side image processing.

### 1.3 Groq receipt parser

**File:** [src/lib/groq/parseReceipt.ts](src/lib/groq/parseReceipt.ts)

1. System prompt (kept short — token budget matters):
   ```
   You convert raw OCR text from grocery receipts into a JSON array of items.
   Output ONLY valid JSON matching the schema. No prose.
   Ignore non-food lines (totals, taxes, store name, addresses, payment info).
   ```
2. User prompt: just the cleaned OCR text.
3. Use `response_format: { type: "json_object" }` and request a wrapper `{ "items": [...] }`.
4. Per-item schema:
   ```ts
   {
     name: string,
     normalized_name: string,  // lowercase canonical, e.g. "milk", "chicken breast"
     category: string,         // matches a key in shelf_life_rules
     quantity: number | null,
     unit: string | null
   }
   ```
5. Validate with Zod; reject and log if invalid (do NOT re-prompt to keep cost down).

**File:** [src/app/api/receipts/parse/route.ts](src/app/api/receipts/parse/route.ts)

1. POST handler: read `receiptId`, load the receipt row (RLS scoped), pull `ocr_text`.
2. Call `parseReceipt(ocrText)`.
3. For each item:
   - `purchased_at = receipt.uploaded_at::date`
   - Insert into `pantry_items` with `status='fresh'`, `estimated_expiration_at=null` (Phase 2 fills this).
4. Update receipt `status='parsed'`.
5. Return parsed items to the client.

### 1.4 Pantry page

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

1. Confirm `shelf_life_rules` is seeded with realistic defaults (research a single source like USDA FoodKeeper for ranges).
2. Add a `storage` column so rules can differ between fridge/pantry/frozen.

### 2.2 Estimator

**File:** [src/lib/shelfLife/estimate.ts](src/lib/shelfLife/estimate.ts)

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

### 3.1 Suggestion endpoint

**File:** [src/app/api/meals/suggest/route.ts](src/app/api/meals/suggest/route.ts)

1. POST handler authenticated via Supabase server client.
2. Load:
   - All pantry items with `status in ('fresh','use_soon')`
   - Mark which are `use_soon`
3. Build a compact payload: `[{ name, category, status }, ...]` — drop ids, dates, ids to save tokens.
4. Call `suggestMeals()` (below).

### 3.2 Groq meal suggester

**File:** [src/lib/groq/suggestMeals.ts](src/lib/groq/suggestMeals.ts)

1. System prompt:
   ```
   You suggest 3 to 5 simple meals using the user's pantry items.
   Prioritize items marked "use_soon".
   Output ONLY valid JSON matching the schema. Be concise.
   No nutrition claims. No long instructions.
   ```
2. User prompt: JSON of pantry items + a single line `"prioritize: [item1, item2]"`.
3. JSON schema:
   ```ts
   {
     meals: [
       {
         title: string,
         ingredients_used: string[],
         missing_ingredients: string[],
         reason: string  // 1 sentence, e.g. "Uses your spinach which expires in 1 day."
       }
     ]
   }
   ```
4. Use `response_format: { type: "json_object" }`.
5. Validate with Zod. If invalid, return a fallback empty list with a friendly message.

### 3.3 Token discipline (critical for free tier)
- **Never** include receipt history, full item ids, dates, or quantities in the prompt.
- Cap pantry list at 40 items; if more, send only top 40 by `use_soon` then by recency.
- Cache last suggestion in `meal_suggestions` and reuse if pantry hasn't changed in the last hour.

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

### 4.1 Pantry editing
- Inline edit name, qty, category, expiration date.
- Bulk select + delete.
- "Mark used" button per item; sets `status='consumed'`.

### 4.2 Filters & search
- Filter chips: All / Fresh / Use Soon / Expired / Consumed.
- Category dropdown.
- Text search on `normalized_name`.

### 4.3 Manual add
- "Add item" form for items bought without a receipt.

### 4.4 Dashboard
- KPIs: items in pantry, items expiring this week, meals suggested this week, items wasted this month.
- Weekly summary card: added vs. used vs. wasted.
- "Waste avoided" metric: count of items moved to `consumed` before `estimated_expiration_at`.

### 4.5 Receipt detail improvements
- Side-by-side: original image + parsed items + raw OCR text.
- "Re-parse" button to retry Groq parsing.

### 4.6 UX polish
- Toast notifications for all async actions.
- Loading skeletons.
- Empty states with illustrations.
- Mobile-responsive nav.
- Dark mode (Tailwind + shadcn).

### 4.7 Exit criteria for Phase 4
- All CRUD on pantry items works.
- Dashboard renders real metrics.
- App works on a phone in portrait mode.

---

## Phase 5 — Stretch Features (Optional)

Pick any depending on time.

1. **Recurring grocery trends:** "You buy bananas every 4 days on average." Pure SQL aggregation.
2. **Favorite meal suggestions:** Save meals; surface them again when ingredients are present.
3. **Email reminders:** Supabase Edge Function on a schedule sends "items expiring in 2 days" digest. Use Resend free tier.
4. **Shared household mode:** Add `households` table; pantry items belong to a household; invite via email link.
5. **Barcode scanning:** `@zxing/browser` for camera barcode reads → product DB lookup.
6. **CSV export:** download pantry / receipts as CSV.

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
