# orm-watchdog

[![npm version](https://img.shields.io/npm/v/orm-watchdog)](https://www.npmjs.com/package/orm-watchdog)
[![CI](https://github.com/your-org/orm-watchdog/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/orm-watchdog/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Zero-config N+1, slow query, and duplicate query detector for **Prisma** (Drizzle and TypeORM on the roadmap). Wraps your ORM client with a transparent JavaScript Proxy — no code changes required beyond a single wrap call.

## Installation

```bash
npm install orm-watchdog
```

> **Note:** `@prisma/client` is a peer dependency. Install it separately.

## Quick start

```ts
import { PrismaClient } from '@prisma/client'
import { watchdog } from 'orm-watchdog'

const prisma = watchdog(new PrismaClient())

// Use prisma exactly as before — full type safety preserved
const users = await prisma.user.findMany()
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `slowQueryThreshold` | `number` | `200` | Duration in ms above which a query is flagged as slow |
| `detectN1` | `boolean` | `true` | Enable N+1 pattern detection |
| `detectDuplicates` | `boolean` | `true` | Enable duplicate query detection |
| `onViolation` | `'warn' \| 'throw' \| 'silent'` | `'warn'` | What to do when a violation is found |
| `output` | `'terminal' \| 'json'` | `'terminal'` | Output format |
| `n1WindowMs` | `number` | `50` | Time window (ms) used to group N+1 candidates |

```ts
const prisma = watchdog(new PrismaClient(), {
  slowQueryThreshold: 300,
  detectN1: true,
  detectDuplicates: true,
  onViolation: 'warn',
  output: 'terminal',
  n1WindowMs: 50,
})
```

## How it works

orm-watchdog uses a JavaScript `Proxy` to intercept every model action (`findMany`, `findUnique`, `create`, …). For each call it:

1. Records the start time and a stack trace.
2. Awaits the original query.
3. Feeds a `QueryEvent` to the **Analyzer**, which checks three detectors:
   - **N+1** — 3+ `findUnique`/`findFirst` calls to the same model with different IDs within `n1WindowMs`.
   - **Slow** — any query exceeding `slowQueryThreshold`.
   - **Duplicate** — same model + action + args hash appearing 2+ times within 100ms.
4. Violations are passed to the **Reporter**, which prints them with ANSI colors (terminal) or as newline-delimited JSON (CI).

## Example output

```
⚠ [orm-watchdog] N+1 detectado en modelo User (5 queries en 23ms)
  → Sugerencia: usa include: { user: true } en tu findMany
  → Origen: src/routes/posts.ts:42
```

## CI Integration

Set `onViolation: 'throw'` so any detected violation fails the build. orm-watchdog checks `process.env.CI` and accumulates all violations before calling `process.exit(1)`.

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      CI: true
      NODE_ENV: development  # enables stack traces
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
```

```ts
// In your integration tests / seed scripts:
const prisma = watchdog(new PrismaClient(), {
  onViolation: 'throw', // process.exit(1) in CI mode
})
```

## Roadmap

- [ ] **Drizzle ORM** support
- [ ] **TypeORM** support (DataSource query subscriber)
- [ ] `@watchdog/reporter-html` — visual flame-graph report
- [ ] Query deduplication auto-fix suggestions with code transforms
- [ ] OpenTelemetry span export
