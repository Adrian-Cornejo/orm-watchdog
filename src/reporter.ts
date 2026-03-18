import { Violation, WatchdogOptions } from './types.js'

// ANSI color codes — no external dependencies
const ANSI = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
} as const

const ICON: Record<Violation['type'], string> = {
  n1: '⚠',
  slow: '🐢',
  duplicate: '♻',
}

export class Reporter {
  private mode: 'terminal' | 'json'
  private onViolation: WatchdogOptions['onViolation']
  private ciMode: boolean
  private accumulated: Violation[] = []

  constructor(options: WatchdogOptions) {
    this.mode = options.output ?? 'terminal'
    this.onViolation = options.onViolation ?? 'warn'
    this.ciMode = process.env['CI'] === 'true'
  }

  report(violation: Violation): void {
    if (this.onViolation === 'silent') return

    if (this.ciMode) {
      this.accumulated.push(violation)
      return
    }

    this.emit(violation)
    if (this.onViolation === 'throw') {
      throw new Error(`[orm-watchdog] ${violation.message}`)
    }
  }

  /** Flush accumulated violations — called at process exit in CI mode */
  flush(): void {
    if (!this.ciMode || this.accumulated.length === 0) return

    for (const v of this.accumulated) {
      this.emit(v)
    }

    if (this.onViolation === 'throw') {
      process.exit(1)
    }
  }

  private emit(violation: Violation): void {
    if (this.mode === 'json') {
      this.emitJson(violation)
    } else {
      this.emitTerminal(violation)
    }
  }

  private emitTerminal(violation: Violation): void {
    const icon = ICON[violation.type]
    const color = violation.type === 'slow' ? ANSI.red : ANSI.yellow

    const firstQuery = violation.queries[0]
    const stackLine = firstQuery?.stack ? extractFirstUserFrame(firstQuery.stack) : null

    process.stderr.write(
      `${color}${ANSI.bold}${icon} [orm-watchdog] ${violation.message}${ANSI.reset}\n`,
    )
    process.stderr.write(
      `${ANSI.cyan}  → Sugerencia: ${violation.suggestion}${ANSI.reset}\n`,
    )
    if (stackLine) {
      process.stderr.write(`${ANSI.gray}  → Origen: ${stackLine}${ANSI.reset}\n`)
    }
  }

  private emitJson(violation: Violation): void {
    const firstQuery = violation.queries[0]
    const payload = {
      type: violation.type,
      model: firstQuery?.model,
      count: violation.queries.length,
      duration: firstQuery?.duration,
      suggestion: violation.suggestion,
      stack: firstQuery?.stack ? extractFirstUserFrame(firstQuery.stack) : undefined,
    }
    process.stdout.write(JSON.stringify(payload) + '\n')
  }
}

function extractFirstUserFrame(stack: string): string | null {
  const lines = stack.split('\n').slice(1) // skip "Error" header
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip internal Node/orm-watchdog frames
    if (
      trimmed.startsWith('at node:') ||
      trimmed.includes('orm-watchdog/src/') ||
      trimmed.includes('orm-watchdog\\src\\') ||
      trimmed.includes('node_modules')
    ) {
      continue
    }
    // Extract path:line:col
    const match = trimmed.match(/\((.+:\d+:\d+)\)$/) ?? trimmed.match(/at (.+:\d+:\d+)$/)
    if (match) return match[1] ?? null
  }
  return null
}
