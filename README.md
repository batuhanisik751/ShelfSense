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
supabase/
  migrations/        # SQL migrations
```

## Hard constraints

- Vercel Hobby: serverless functions capped at 60s (`vercel.json`). Keep heavy work off the server — OCR runs in the browser.
- Supabase Free: 500 MB DB, 1 GB storage, 50 MB max upload. RLS is mandatory.
- Groq Free: 30 RPM, 6K TPM. Small prompts only, no history replay, no retry loops.
- Groq model is text-only — OCR must complete before any Groq call.
- Date math is deterministic, never delegated to the LLM.
