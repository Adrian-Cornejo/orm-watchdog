import { Analyzer } from './analyzer.js'
import { Reporter } from './reporter.js'
import { QueryEvent, WatchdogOptions } from './types.js'

const PRISMA_ACTIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
])

function isDevEnv(): boolean {
  return process.env['NODE_ENV'] !== 'production'
}

function captureStack(): string | undefined {
  if (!isDevEnv()) return undefined
  const err = new Error()
  Error.captureStackTrace?.(err)
  return err.stack
}

/**
 * Wraps a single model delegate with a Proxy that records every action call.
 */
function wrapModel(
  model: object,
  modelName: string,
  analyzer: Analyzer,
  reporter: Reporter,
): object {
  return new Proxy(model, {
    get(target, prop) {
      const value = Reflect.get(target, prop)

      if (typeof prop !== 'string' || !PRISMA_ACTIONS.has(prop) || typeof value !== 'function') {
        return value
      }

      return function (...args: unknown[]) {
        const stack = captureStack()
        const start = Date.now()

        const result: unknown = Reflect.apply(value as (...a: unknown[]) => unknown, target, args)

        // Support both Promise-returning queries and sync calls
        if (result && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).then(
            (resolved) => {
              const event: QueryEvent = {
                model: modelName,
                action: prop,
                args: args[0],
                duration: Date.now() - start,
                timestamp: Date.now(),
                stack,
              }
              const violations = analyzer.analyze(event)
              for (const v of violations) reporter.report(v)
              return resolved
            },
            (err: unknown) => {
              // Still record the event even on error
              const event: QueryEvent = {
                model: modelName,
                action: prop,
                args: args[0],
                duration: Date.now() - start,
                timestamp: Date.now(),
                stack,
              }
              analyzer.analyze(event)
              throw err
            },
          )
        }

        // Synchronous path (rare but possible with some mock clients)
        const event: QueryEvent = {
          model: modelName,
          action: prop,
          args: args[0],
          duration: Date.now() - start,
          timestamp: Date.now(),
          stack,
        }
        const violations = analyzer.analyze(event)
        for (const v of violations) reporter.report(v)
        return result
      }
    },
  })
}

/**
 * Creates a transparent Proxy around a PrismaClient-like object.
 * All model delegates are lazily wrapped on first access.
 */
export function createProxy<T extends object>(
  client: T,
  analyzer: Analyzer,
  reporter: Reporter,
): T {
  const modelCache = new Map<string, object>()

  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop)

      // Only proxy plain objects that look like Prisma model delegates
      if (
        typeof prop !== 'string' ||
        typeof value !== 'object' ||
        value === null ||
        prop.startsWith('$') ||
        prop.startsWith('_')
      ) {
        return value
      }

      if (!modelCache.has(prop)) {
        modelCache.set(prop, wrapModel(value as object, prop, analyzer, reporter))
      }

      return modelCache.get(prop)
    },
  })
}
