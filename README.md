# orm-watchdog

[![npm version](https://img.shields.io/npm/v/orm-watchdog)](https://www.npmjs.com/package/orm-watchdog)
[![CI](https://github.com/Adrian-Cornejo/orm-watchdog/actions/workflows/ci.yml/badge.svg)](https://github.com/Adrian-Cornejo/orm-watchdog/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)

> Zero-config N+1, slow query, and duplicate query detector for **Prisma**.  
> Wraps your client with a transparent JavaScript Proxy — no code changes beyond a single wrap call.

---

## The problem

Prisma's built-in `log` option prints queries to stdout but gives you **zero analysis** — no N+1 detection, no thresholds, no CI integration, no grouping. You ship a feature, it works fine locally, and three weeks later your database is on fire because a loop is firing 200 `findUnique` calls per request.

orm-watchdog sits on top of your existing Prisma setup and catches these issues **before they reach production**.

---

## Why not DataDog / New Relic?

Those tools are great — and expensive, require external infra, and are overkill for catching N+1s during development. orm-watchdog is a **zero-dependency npm package** that works in your terminal, your test suite, and your CI pipeline with no account required.

---

## Installation

```bash
npm install orm-watchdog
```

> `@prisma/client` is a peer dependency. Install it separately if you haven't already.

---

## Quick start

```ts
import { PrismaClient } from '@prisma/client'
import { watchdog } from 'orm-watchdog'

const prisma = watchdog(new PrismaClient())

// Use prisma exactly as before — full TypeScript autocomplete preserved
const users = await prisma.user.findMany()
```

That's it. orm-watchdog will start printing violations to your terminal immediately.

---

## Example output

```
⚠  [orm-watchdog] N+1 detected — User (5 queries in 23ms)
   → Try: include: { user: true } in your findMany
   → at src/routes/posts.ts:42

🐢 [orm-watchdog] Slow query — Post.findMany (847ms, threshold: 200ms)
   → at src/services/feed.ts:18

♻  [orm-watchdog] Duplicate query — User.findUnique (3× in 12ms)
   → at src/middleware/auth.ts:9
```

---

## Configuration

```ts
const prisma = watchdog(new PrismaClient(), {
  slowQueryThreshold: 300,  // ms before a query is flagged as slow
  detectN1: true,           // enable N+1 detection
  detectDuplicates: true,   // enable duplicate query detection
  onViolation: 'warn',      // 'warn' | 'throw' | 'silent'
  output: 'terminal',       // 'terminal' | 'json'
  n1WindowMs: 50,           // time window to group N+1 candidates
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `slowQueryThreshold` | `number` | `200` | Duration in ms above which a query is flagged as slow |
| `detectN1` | `boolean` | `true` | Enable N+1 pattern detection |
| `detectDuplicates` | `boolean` | `true` | Enable duplicate query detection |
| `onViolation` | `'warn' \| 'throw' \| 'silent'` | `'warn'` | What to do when a violation is found |
| `output` | `'terminal' \| 'json'` | `'terminal'` | Output format |
| `n1WindowMs` | `number` | `50` | Time window (ms) used to group N+1 candidates |

---

## How it works

orm-watchdog uses a JavaScript `Proxy` to intercept every model action (`findMany`, `findUnique`, `create`, `update`, `delete`, …). For each call it:

1. Records the start time and a stack trace (only in `NODE_ENV !== 'production'`).
2. Awaits the original query — your code runs unchanged.
3. Feeds a `QueryEvent` to the **Analyzer**, which runs three detectors in parallel:
   - **N+1** — 3+ `findUnique`/`findFirst` calls to the same model with different IDs within `n1WindowMs`.
   - **Slow** — any query exceeding `slowQueryThreshold`.
   - **Duplicate** — same model + action + args hash appearing 2+ times within 100ms.
4. Violations are passed to the **Reporter** — ANSI colors in the terminal, newline-delimited JSON in CI.

The Proxy is fully transparent: `watchdog<T>(client: T): T` returns exactly `T`, so Prisma's autocomplete and type safety are completely preserved. Overhead is under 0.1ms per query.

---

## CI Integration

Set `onViolation: 'throw'` and orm-watchdog will accumulate all violations across your test run, then call `process.exit(1)` before the process exits — failing the build with a full summary.

```ts
// e.g. in your test setup file or integration seed
const prisma = watchdog(new PrismaClient(), {
  onViolation: 'throw',
})
```

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      CI: true
      NODE_ENV: development   # enables stack traces
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
```

---

## JSON output mode

Useful for parsing violations in custom scripts or external dashboards:

```ts
const prisma = watchdog(new PrismaClient(), {
  output: 'json',
})
```

Each violation is printed as a newline-delimited JSON object:

```json
{ "type": "n1", "model": "User", "count": 5, "durationMs": 23, "suggestion": "use include: { user: true }", "stack": "at src/routes/posts.ts:42" }
{ "type": "slow", "model": "Post", "action": "findMany", "durationMs": 847, "threshold": 200, "stack": "at src/services/feed.ts:18" }
```

---

## Roadmap

- [ ] **Drizzle ORM** support
- [ ] **TypeORM** support (DataSource query subscriber)
- [ ] `@watchdog/reporter-html` — visual query timeline report
- [ ] Query deduplication suggestions with code transforms
- [ ] OpenTelemetry span export

---

## Contributing

Issues and PRs are welcome. Please open an issue first for large changes.

```bash
git clone https://github.com/Adrian-Cornejo/orm-watchdog
cd orm-watchdog
npm install
npm test        # vitest
npm run build   # tsup → dist/
```

---

## License

MIT © [Adrian Cornejo](https://github.com/Adrian-Cornejo)