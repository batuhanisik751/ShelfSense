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
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon key, RLS-scoped |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | never import from a client component |
| `GROQ_API_KEY` | **server-only** | used by `/api` route handlers |

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
    (auth)/          # login, signup
    (app)/           # protected routes: dashboard, pantry, receipts, meals
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
- **Phase 0.4 – app skeleton**: route groups `(auth)` and `(app)`, protected shell layout with `Nav`, stub API handlers for `/api/receipts/parse` and `/api/meals/suggest` (return `501` until wired), and lazy Supabase/Groq client helpers. Middleware is a no-op when env vars are missing so the app boots without Supabase configured.
- **Phase 0.5 – auth wiring** (next): real `/login` + `/signup` forms, redirect unauthenticated users from `(app)/*`.

## Hard constraints

- Vercel Hobby: serverless functions capped at 60s (`vercel.json`). Keep heavy work off the server — OCR runs in the browser.
- Supabase Free: 500 MB DB, 1 GB storage, 50 MB max upload. RLS is mandatory.
- Groq Free: 30 RPM, 6K TPM. Small prompts only, no history replay, no retry loops.
- Groq model is text-only — OCR must complete before any Groq call.
- Date math is deterministic, never delegated to the LLM.
