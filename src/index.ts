import { Analyzer } from './analyzer.js'
import { createProxy } from './proxy.js'
import { Reporter } from './reporter.js'
import { WatchdogOptions } from './types.js'

export type { QueryEvent, Violation, WatchdogOptions } from './types.js'

/**
 * Wraps a PrismaClient (or any ORM client) with a transparent Proxy that
 * detects N+1 queries, slow queries, and duplicate queries in development
 * and CI environments.
 *
 * @example
 * ```ts
 * import { PrismaClient } from '@prisma/client'
 * import { watchdog } from 'orm-watchdog'
 *
 * const prisma = watchdog(new PrismaClient())
 * ```
 */
export function watchdog<T extends object>(client: T, options: WatchdogOptions = {}): T {
  const analyzer = new Analyzer(options)
  const reporter = new Reporter(options)

  // Flush accumulated violations on process exit (CI mode)
  process.once('beforeExit', () => reporter.flush())

  return createProxy(client, analyzer, reporter)
}
