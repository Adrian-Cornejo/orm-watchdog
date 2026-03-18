export interface WatchdogOptions {
  slowQueryThreshold?: number  // ms, default: 200
  detectN1?: boolean           // default: true
  detectDuplicates?: boolean   // default: true
  onViolation?: 'warn' | 'throw' | 'silent'
  output?: 'terminal' | 'json'
  n1WindowMs?: number          // time window for N+1 detection, default: 50ms
}

export interface QueryEvent {
  model: string
  action: string
  args: unknown
  duration: number
  timestamp: number
  stack?: string
}

export interface Violation {
  type: 'n1' | 'slow' | 'duplicate'
  message: string
  queries: QueryEvent[]
  suggestion: string
}
