# ShelfSense — Claude Code Instructions

ShelfSense turns grocery receipts into a smart pantry. Users upload a receipt, OCR extracts text, Groq's `llama-3.1-8b-instant` parses items, the app estimates expiration windows, and suggests meals. Full plan: [PLAN.md](PLAN.md).

## Stack (locked)

- **Frontend + API**: Next.js 14 App Router on Vercel Hobby
- **Database / Auth / Storage**: Supabase Free
- **AI**: Groq `llama-3.1-8b-instant` (text-only, JSON mode)
- **OCR**: Tesseract.js (client-side primary)
- **Styling**: Tailwind + shadcn/ui
- **Validation**: Zod on every LLM output and form boundary
- **Language**: TypeScript strict mode

## Hard constraints (design around these)

- Vercel Hobby functions: default 10s, max 60s → keep heavy work off the server.
- Supabase Free: 500 MB DB, 1 GB storage, **50 MB max upload**, RLS mandatory.
- Groq Free: **30 RPM**, 6K TPM → small prompts, no history replay, no retries-on-failure loops.
- Groq model is **text-only** → OCR must happen before any Groq call.
- **Date math is deterministic, not delegated to the LLM.**

## Global rules

1. **RLS on every table.** Every query must be scoped by `auth.uid()`. Never use the service-role key on the client.
2. **Zod-validate every Groq response.** On failure, log and return a friendly error — do NOT re-prompt in a loop.
3. **Token discipline.** Never send receipt history, ids, or past meals into a Groq prompt. Pantry payloads capped at 40 items.
4. **No comments unless the WHY is non-obvious.** Well-named identifiers speak for themselves.
5. **Server components by default.** Use client components only when interactivity is needed.
6. **Secrets live in env vars only.** `GROQ_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only.
7. **Ship small.** Prefer editing existing files over creating new ones. No speculative abstractions.

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
  components/        # React components (server-first)
supabase/
  migrations/        # SQL migrations
.claude/
  agents/            # specialist subagents
```

## Subagent roster

ShelfSense uses 7 specialist subagents. Each owns a narrow slice of the stack. **Delegate proactively** — don't do their work inline when a specialist exists.

| Subagent | Owns | Read/Write |
|---|---|---|
| [supabase-architect](.claude/agents/supabase-architect.md) | SQL schema, migrations, RLS policies, Supabase client helpers | write |
| [groq-prompt-engineer](.claude/agents/groq-prompt-engineer.md) | Groq prompts, JSON schemas, token budgets, Zod validators | write |
| [nextjs-builder](.claude/agents/nextjs-builder.md) | App Router pages, server actions, route handlers, React components | write |
| [ocr-pipeline-specialist](.claude/agents/ocr-pipeline-specialist.md) | Tesseract.js setup, image pre-processing, PDF handling | write |
| [rls-security-auditor](.claude/agents/rls-security-auditor.md) | Audits RLS, auth gates, secret exposure | **read-only** |
| [shelf-life-researcher](.claude/agents/shelf-life-researcher.md) | Food shelf-life rules, seed data for `shelf_life_rules` | research + write seeds |
| [ui-polish-reviewer](.claude/agents/ui-polish-reviewer.md) | Accessibility, responsiveness, shadcn consistency, loading/empty states | **read-only** |

## Orchestration map — who runs when

```
                        ┌──────────────────────────┐
                        │  Phase 0: Foundations    │
                        └────────────┬─────────────┘
                                     │
                supabase-architect ──┴── nextjs-builder
                                     │
                          rls-security-auditor (review)

                        ┌──────────────────────────┐
                        │  Phase 1: Receipt → Pantry│
                        └────────────┬─────────────┘
                                     │
      nextjs-builder (upload UI) ────┼──── ocr-pipeline-specialist (OCR)
                                     │
                       groq-prompt-engineer (parse receipt prompt)
                                     │
                         supabase-architect (pantry insert)
                                     │
                          rls-security-auditor (review)

                        ┌──────────────────────────┐
                        │  Phase 2: Expiration     │
                        └────────────┬─────────────┘
                                     │
           shelf-life-researcher ────┴──── supabase-architect (seed rules)
                                     │
                       nextjs-builder (integrate estimator)

                        ┌──────────────────────────┐
                        │  Phase 3: Meal Suggest   │
                        └────────────┬─────────────┘
                                     │
               groq-prompt-engineer ─┴─ nextjs-builder (meals UI)
                                     │
                          rls-security-auditor (review)

                        ┌──────────────────────────┐
                        │  Phase 4: Polish         │
                        └────────────┬─────────────┘
                                     │
                  nextjs-builder ────┴──── ui-polish-reviewer
```

### Handoff contracts

- **supabase-architect → nextjs-builder**: hands over table names, column types, and an example typed query. Never leaks service-role key.
- **ocr-pipeline-specialist → groq-prompt-engineer**: hands over cleaned OCR text (capped at 8K chars, whitespace normalized, non-food lines optionally stripped).
- **groq-prompt-engineer → nextjs-builder**: hands over a Zod-validated TypeScript function `(input) => Promise<TypedResult>`. The UI builder never writes prompt strings directly.
- **nextjs-builder → rls-security-auditor**: whenever a new route or query is added, auditor reviews before merge.
- **shelf-life-researcher → supabase-architect**: hands over a SQL seed file; architect applies it in a migration.
- **ui-polish-reviewer → nextjs-builder**: returns a punch list; builder applies fixes.

### Parallelization rules

- Delegate independent work in parallel (e.g. schema design + upload UI skeleton).
- **Serialize** anything touching the same file or schema to avoid conflicts.
- **Always** run `rls-security-auditor` after any DB schema change or new API route — never skip.

## Development commands

```bash
npm run dev           # local dev server
npm run build         # production build
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npx supabase db push  # apply migrations to remote
```

## What NOT to do

- Don't call Groq from the client.
- Don't let the LLM compute dates.
- Don't send full receipt history or meal history into any prompt.
- Don't add retry loops on Groq failures — just surface the error.
- Don't write to pantry without `user_id = auth.uid()`.
- Don't add features beyond the current phase unless explicitly requested.
