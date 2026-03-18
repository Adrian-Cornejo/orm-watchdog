import { QueryEvent, Violation, WatchdogOptions } from './types.js'

const CIRCULAR_BUFFER_SIZE = 200
const DUPLICATE_WINDOW_MS = 100
const N1_MIN_COUNT = 3

function hashQuery(event: QueryEvent): string {
  return `${event.model}:${event.action}:${JSON.stringify(event.args)}`
}

function extractWhereId(args: unknown): unknown {
  if (args && typeof args === 'object') {
    const a = args as Record<string, unknown>
    if (a['where'] && typeof a['where'] === 'object') {
      const w = a['where'] as Record<string, unknown>
      return w['id'] ?? w['ID'] ?? null
    }
  }
  return null
}

export class Analyzer {
  private buffer: QueryEvent[] = []
  private options: Required<
    Pick<WatchdogOptions, 'slowQueryThreshold' | 'detectN1' | 'detectDuplicates' | 'n1WindowMs'>
  >

  constructor(options: WatchdogOptions) {
    this.options = {
      slowQueryThreshold: options.slowQueryThreshold ?? 200,
      detectN1: options.detectN1 ?? true,
      detectDuplicates: options.detectDuplicates ?? true,
      n1WindowMs: options.n1WindowMs ?? 50,
    }
  }

  analyze(event: QueryEvent): Violation[] {
    this.addToBuffer(event)
    const violations: Violation[] = []

    const slowViolation = this.checkSlow(event)
    if (slowViolation) violations.push(slowViolation)

    if (this.options.detectDuplicates) {
      const dupViolation = this.checkDuplicate(event)
      if (dupViolation) violations.push(dupViolation)
    }

    if (this.options.detectN1) {
      const n1Violation = this.checkN1(event)
      if (n1Violation) violations.push(n1Violation)
    }

    return violations
  }

  private addToBuffer(event: QueryEvent): void {
    this.buffer.push(event)
    if (this.buffer.length > CIRCULAR_BUFFER_SIZE) {
      this.buffer.shift()
    }
  }

  private checkSlow(event: QueryEvent): Violation | null {
    if (event.duration < this.options.slowQueryThreshold) return null

    return {
      type: 'slow',
      message: `Slow query detected on model ${event.model}.${event.action} (${event.duration}ms)`,
      queries: [event],
      suggestion: `Add an index on the filtered columns or optimize the query. Threshold: ${this.options.slowQueryThreshold}ms`,
    }
  }

  private checkDuplicate(event: QueryEvent): Violation | null {
    const hash = hashQuery(event)
    const windowStart = event.timestamp - DUPLICATE_WINDOW_MS

    const duplicates = this.buffer.filter(
      (e) => e !== event && e.timestamp >= windowStart && hashQuery(e) === hash,
    )

    if (duplicates.length === 0) return null

    return {
      type: 'duplicate',
      message: `Duplicate query detected: ${event.model}.${event.action} called ${duplicates.length + 1} times in ${DUPLICATE_WINDOW_MS}ms`,
      queries: [...duplicates, event],
      suggestion: `Cache the result or consolidate calls to ${event.model}.${event.action} with the same arguments`,
    }
  }

  private checkN1(event: QueryEvent): Violation | null {
    // N+1 pattern: same model + action (findUnique/findFirst) called with different IDs in quick succession
    if (!['findUnique', 'findFirst', 'findUniqueOrThrow', 'findFirstOrThrow'].includes(event.action)) {
      return null
    }

    const currentId = extractWhereId(event.args)
    if (currentId === null) return null

    const windowStart = event.timestamp - this.options.n1WindowMs

    const similarQueries = this.buffer.filter((e) => {
      if (e === event) return false
      if (e.model !== event.model || e.action !== event.action) return false
      if (e.timestamp < windowStart) return false

      const otherId = extractWhereId(e.args)
      return otherId !== null && otherId !== currentId
    })

    if (similarQueries.length + 1 < N1_MIN_COUNT) return null

    const allQueries = [...similarQueries, event]
    const totalMs = event.timestamp - Math.min(...allQueries.map((q) => q.timestamp))

    return {
      type: 'n1',
      message: `N+1 detected on model ${event.model} (${allQueries.length} queries in ${totalMs}ms)`,
      queries: allQueries,
      suggestion: `Use include: { ${event.model.toLowerCase()}: true } in your findMany or batch with findMany({ where: { id: { in: ids } } })`,
    }
  }

  /** Reset the internal buffer (useful in tests) */
  reset(): void {
    this.buffer = []
  }
}
