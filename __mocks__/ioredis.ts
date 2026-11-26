// Minimal mock for ioredis used in tests
// Provides only the methods accessed in the test suite.

class MockRedis {
  constructor(public url?: string, public options?: any) {}
  // Simulate a successful ping
  async ping(): Promise<string> {
    return 'PONG';
  }
  // Event emitter stub
  on(_: string, __: (...args: any[]) => void): this {
    return this;
  }
  // Close connections – no‑op
  disconnect(): void {}
  quit(): void {}
}

export default MockRedis;
