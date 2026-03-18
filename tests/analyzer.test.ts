import { describe, it, expect, beforeEach } from 'vitest'
import { Analyzer } from '../src/analyzer.js'
import { QueryEvent } from '../src/types.js'

function makeEvent(overrides: Partial<QueryEvent> = {}): QueryEvent {
  return {
    model: 'User',
    action: 'findUnique',
    args: { where: { id: 1 } },
    duration: 10,
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('Analyzer — slow query', () => {
  it('reports a violation when duration exceeds threshold', () => {
    const analyzer = new Analyzer({ slowQueryThreshold: 100 })
    const event = makeEvent({ model: 'Post', action: 'findMany', duration: 250 })
    const violations = analyzer.analyze(event)

    expect(violations).toHaveLength(1)
    expect(violations[0]!.type).toBe('slow')
    expect(violations[0]!.message).toContain('250ms')
  })

  it('does not report when duration is below threshold', () => {
    const analyzer = new Analyzer({ slowQueryThreshold: 500 })
    const event = makeEvent({ duration: 100 })
    const violations = analyzer.analyze(event)
    const slow = violations.filter((v) => v.type === 'slow')
    expect(slow).toHaveLength(0)
  })
})

describe('Analyzer — duplicate queries', () => {
  it('detects duplicate queries within 100ms window', () => {
    const analyzer = new Analyzer({ detectDuplicates: true, detectN1: false })
    const now = Date.now()
    const args = { where: { id: 42 } }

    analyzer.analyze(makeEvent({ args, timestamp: now }))
    const violations = analyzer.analyze(makeEvent({ args, timestamp: now + 10 }))

    const dups = violations.filter((v) => v.type === 'duplicate')
    expect(dups).toHaveLength(1)
    expect(dups[0]!.queries).toHaveLength(2)
  })

  it('does not flag duplicates outside the 100ms window', () => {
    const analyzer = new Analyzer({ detectDuplicates: true, detectN1: false })
    const args = { where: { id: 99 } }

    analyzer.analyze(makeEvent({ args, timestamp: 1000 }))
    const violations = analyzer.analyze(makeEvent({ args, timestamp: 1200 }))

    const dups = violations.filter((v) => v.type === 'duplicate')
    expect(dups).toHaveLength(0)
  })
})

describe('Analyzer — N+1 detection', () => {
  it('detects N+1 when same model queried 3+ times with different IDs', () => {
    const analyzer = new Analyzer({ detectN1: true, n1WindowMs: 50, detectDuplicates: false })
    const now = Date.now()

    analyzer.analyze(makeEvent({ model: 'User', action: 'findUnique', args: { where: { id: 1 } }, timestamp: now }))
    analyzer.analyze(makeEvent({ model: 'User', action: 'findUnique', args: { where: { id: 2 } }, timestamp: now + 5 }))
    const violations = analyzer.analyze(
      makeEvent({ model: 'User', action: 'findUnique', args: { where: { id: 3 } }, timestamp: now + 10 }),
    )

    const n1 = violations.filter((v) => v.type === 'n1')
    expect(n1).toHaveLength(1)
    expect(n1[0]!.queries).toHaveLength(3)
    expect(n1[0]!.suggestion).toContain('findMany')
  })

  it('does not flag N+1 for less than 3 queries', () => {
    const analyzer = new Analyzer({ detectN1: true, n1WindowMs: 50, detectDuplicates: false })
    const now = Date.now()

    analyzer.analyze(makeEvent({ args: { where: { id: 1 } }, timestamp: now }))
    const violations = analyzer.analyze(makeEvent({ args: { where: { id: 2 } }, timestamp: now + 5 }))

    const n1 = violations.filter((v) => v.type === 'n1')
    expect(n1).toHaveLength(0)
  })

  it('does not flag N+1 when queries are outside the time window', () => {
    const analyzer = new Analyzer({ detectN1: true, n1WindowMs: 50, detectDuplicates: false })

    analyzer.analyze(makeEvent({ args: { where: { id: 1 } }, timestamp: 1000 }))
    analyzer.analyze(makeEvent({ args: { where: { id: 2 } }, timestamp: 1030 }))
    const violations = analyzer.analyze(makeEvent({ args: { where: { id: 3 } }, timestamp: 1200 }))

    const n1 = violations.filter((v) => v.type === 'n1')
    expect(n1).toHaveLength(0)
  })
})
