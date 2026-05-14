import { describe, it, expect, vi } from 'vitest';

const transportConstructor = vi.fn();
const connect = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {
    constructor(options?: unknown) {
      transportConstructor(options);
    }

    start = vi.fn().mockResolvedValue(undefined);
    send = vi.fn().mockResolvedValue(undefined);
  }
}));

vi.mock('@services/gateway/gateway.service.js', () => ({
  gateway: {
    createConnectionServer: vi.fn(() => ({
      connect
    }))
  }
}));

vi.mock('@utils/json-utils.js', () => ({
  stringifyForLogging: vi.fn((value) => JSON.stringify(value)),
  getMcpCommDebugSetting: vi.fn(() => false),
  getGatewayDebugSetting: vi.fn(() => false)
}));

vi.mock('@utils/logger/index.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn()
  },
  LOG_MODULES: {
    COMMUNICATION: 'communication',
    GATEWAY: 'gateway'
  }
}));

describe('createSessionTransport', () => {
  it('enables JSON responses for MCP request/response calls', async () => {
    const { createSessionTransport } = await import('@services/gateway/global-transport.js');

    await createSessionTransport();

    expect(transportConstructor).toHaveBeenCalledWith({ enableJsonResponse: true });
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
