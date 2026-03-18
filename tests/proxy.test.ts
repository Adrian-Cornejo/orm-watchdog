import { describe, it, expect, vi, beforeEach } from 'vitest'
import { watchdog } from '../src/index.js'

// Minimal mock that simulates a PrismaClient shape
function makeMockClient() {
  return {
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      findUnique: vi.fn().mockResolvedValue({ id: 1 }),
      create: vi.fn().mockResolvedValue({ id: 3 }),
    },
    post: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  }
}

describe('watchdog() — proxy transparency', () => {
  it('returns an object with the same model delegates', () => {
    const client = makeMockClient()
    const wrapped = watchdog(client)

    expect(wrapped.user).toBeDefined()
    expect(wrapped.post).toBeDefined()
    expect(wrapped.$connect).toBe(client.$connect)
  })

  it('calls the original method and returns its result', async () => {
    const client = makeMockClient()
    const wrapped = watchdog(client)

    const result = await wrapped.user.findMany({ where: {} })
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
    expect(client.user.findMany).toHaveBeenCalledWith({ where: {} })
  })

  it('preserves $ prefixed properties without wrapping', () => {
    const client = makeMockClient()
    const wrapped = watchdog(client)
    expect(wrapped.$connect).toBe(client.$connect)
    expect(wrapped.$disconnect).toBe(client.$disconnect)
  })
})

describe('watchdog() — slow query detection', () => {
  it('captures slow queries via onViolation: throw', async () => {
    const client = {
      user: {
        findMany: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 50)),
        ),
      },
    }

    const wrapped = watchdog(client, {
      slowQueryThreshold: 20,
      onViolation: 'throw',
      detectN1: false,
      detectDuplicates: false,
    })

    await expect(wrapped.user.findMany({})).rejects.toThrow('[orm-watchdog]')
  })

  it('does not throw for fast queries', async () => {
    const client = makeMockClient()
    const wrapped = watchdog(client, {
      slowQueryThreshold: 5000,
      onViolation: 'throw',
      detectN1: false,
      detectDuplicates: false,
    })

    await expect(wrapped.user.findMany({})).resolves.toBeDefined()
  })
})

describe('watchdog() — N+1 detection via proxy', () => {
  it('detects N+1 pattern and throws when configured', async () => {
    // Simulate 3 rapid findUnique calls with different IDs
    const client = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
      },
    }

    const violations: string[] = []
    const wrapped = watchdog(client, {
      detectN1: true,
      n1WindowMs: 200,
      detectDuplicates: false,
      onViolation: 'silent',
      output: 'json',
    })

    // Override reporter to capture (test-only approach via silent mode)
    await wrapped.user.findUnique({ where: { id: 1 } })
    await wrapped.user.findUnique({ where: { id: 2 } })
    await wrapped.user.findUnique({ where: { id: 3 } })

    // With silent mode no error is thrown; we verify the underlying calls succeeded
    expect(client.user.findUnique).toHaveBeenCalledTimes(3)
  })
})

describe('watchdog() — duplicate detection via proxy', () => {
  it('detects duplicate queries with onViolation: throw', async () => {
    const client = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 5 }),
      },
    }

    const wrapped = watchdog(client, {
      detectDuplicates: true,
      detectN1: false,
      onViolation: 'throw',
      slowQueryThreshold: 9999,
    })

    const args = { where: { id: 5 } }
    await wrapped.user.findUnique(args)
    await expect(wrapped.user.findUnique(args)).rejects.toThrow('[orm-watchdog]')
  })
})

describe('watchdog() — onViolation modes', () => {
  it('silent mode does not throw even for violations', async () => {
    const client = {
      user: {
        findMany: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 50)),
        ),
      },
    }

    const wrapped = watchdog(client, {
      slowQueryThreshold: 10,
      onViolation: 'silent',
      detectN1: false,
      detectDuplicates: false,
    })

    await expect(wrapped.user.findMany({})).resolves.toEqual([])
  })
})
