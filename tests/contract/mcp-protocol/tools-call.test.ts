import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mcpConnectionManager } from '@services/mcp-connection-manager.js';
import { hubManager } from '@services/hub-manager.service.js';
import { resolveInstanceConfig } from '@config/config-migrator.js';

// Mock MCP SDK
const mockListTools = vi.fn().mockResolvedValue({ tools: [] });
const mockListResources = vi.fn().mockResolvedValue({ resources: [] });
const mockSetLoggingLevel = vi.fn().mockResolvedValue({});
const mockCallTool = vi.fn().mockImplementation((toolCall) => {
  if (toolCall.name === 'calculator') {
    const { a, b, operation } = toolCall.arguments;

    // Validate parameter types
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw new Error('Invalid parameters: a and b must be numbers');
    }

    if (typeof operation !== 'string') {
      throw new Error('Invalid parameters: operation must be a string');
    }

    let result;
    switch (operation) {
      case 'add':
        result = a + b;
        break;
      case 'subtract':
        result = a - b;
        break;
      case 'multiply':
        result = a * b;
        break;
      case 'divide':
        if (b === 0) {
          throw new Error('Division by zero');
        }
        result = a / b;
        break;
      default:
        throw new Error('Invalid operation');
    }
    return Promise.resolve({ result });
  }
  if (toolCall.name === 'get_weather') {
    return Promise.resolve({ temperature: 25, condition: 'sunny' });
  }
  if (toolCall.name === 'search_news') {
    return Promise.resolve({ articles: ['News 1', 'News 2'] });
  }
  throw new Error('Unknown tool');
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  return {
    Client: class {
      connect = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      listTools = mockListTools;
      listResources = mockListResources;
      setLoggingLevel = mockSetLoggingLevel;
      callTool = mockCallTool;
      getServerVersion = vi.fn().mockReturnValue({ name: 'Test SDK Server', version: '1.0.0' });
    }
  };
});

// Mock transport
vi.mock('@utils/transports/transport-factory.js', () => {
  return {
    TransportFactory: {
      createTransport: vi.fn().mockReturnValue({
        onclose: null,
        onstdout: null,
        onstderr: null,
        close: vi.fn().mockResolvedValue(undefined)
      })
    }
  };
});

describe('MCP Protocol Contract - tools/call (with SDK)', () => {
  const serverName = 'test-sdk-server';
  let serverId: string;
  let serverIndex: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockListTools.mockResolvedValue({ tools: [] });
    mockListResources.mockResolvedValue({ resources: [] });
    mockSetLoggingLevel.mockResolvedValue({});

    // Add to hub manager (v1.1 format)
    await hubManager.addServer(serverName, {
      command: 'node',
      args: [],
      type: 'stdio' as const,
      timeout: 60000,
      aggregatedTools: []
    });

    // Add server instance
    const instance = await hubManager.addServerInstance(serverName, {});
    serverId = instance.id;
    serverIndex = instance.index ?? 0;
  });

  afterEach(async () => {
    await mcpConnectionManager.disconnect(serverName, serverIndex);
    hubManager.removeServer(serverName);
  });

  it('should execute tool with correct arguments', async () => {
    // Get server configuration and instance configuration
    const serverInfo = hubManager.getServerById(serverId);
    if (!serverInfo) {
      throw new Error('Server not found');
    }

    // Resolve the complete configuration using v1.1 resolveInstanceConfig
    const resolvedConfig = resolveInstanceConfig(serverInfo.config, serverId);
    if (!resolvedConfig) {
      throw new Error('Failed to resolve server configuration');
    }

    await mcpConnectionManager.connect(serverName, serverIndex, {
      ...resolvedConfig,
      id: serverId,
      timestamp: Date.now()
    });

    const result = (await mcpConnectionManager.callTool(serverName, serverIndex, 'calculator', {
      a: 5,
      b: 3,
      operation: 'add'
    })) as { result: number };

    expect(result).toHaveProperty('result');
    expect(result.result).toBe(8);
  });

  it('should pass configured server timeout to SDK tool calls', async () => {
    const serverInfo = hubManager.getServerById(serverId);
    if (!serverInfo) {
      throw new Error('Server not found');
    }

    const resolvedConfig = resolveInstanceConfig(serverInfo.config, serverId);
    if (!resolvedConfig) {
      throw new Error('Failed to resolve server configuration');
    }

    const timeout = 180000;
    await mcpConnectionManager.connect(serverName, serverIndex, {
      ...resolvedConfig,
      timeout,
      id: serverId,
      timestamp: Date.now()
    });

    await mcpConnectionManager.callTool(serverName, serverIndex, 'get_weather', {
      location: 'New York'
    });

    expect(mockCallTool).toHaveBeenLastCalledWith(
      {
        name: 'get_weather',
        arguments: { location: 'New York' }
      },
      undefined,
      { timeout }
    );
  });

  it('should use short discovery timeouts during connection setup', async () => {
    const serverInfo = hubManager.getServerById(serverId);
    if (!serverInfo) {
      throw new Error('Server not found');
    }

    const resolvedConfig = resolveInstanceConfig(serverInfo.config, serverId);
    if (!resolvedConfig) {
      throw new Error('Failed to resolve server configuration');
    }

    await mcpConnectionManager.connect(serverName, serverIndex, {
      ...resolvedConfig,
      id: serverId,
      timestamp: Date.now()
    });

    expect(mockListTools).toHaveBeenCalledWith(undefined, { timeout: 5000 });
    expect(mockListResources).toHaveBeenCalledWith(undefined, { timeout: 5000 });
    expect(mockSetLoggingLevel).toHaveBeenCalledWith('info', { timeout: 5000 });
  });

  it('should not block connection on resources discovery', async () => {
    const serverInfo = hubManager.getServerById(serverId);
    if (!serverInfo) {
      throw new Error('Server not found');
    }

    const resolvedConfig = resolveInstanceConfig(serverInfo.config, serverId);
    if (!resolvedConfig) {
      throw new Error('Failed to resolve server configuration');
    }

    let resolveResources: (value: { resources: [] }) => void = () => undefined;
    const resourcesPromise = new Promise<{ resources: [] }>((resolve) => {
      resolveResources = resolve;
    });
    mockListResources.mockReturnValueOnce(resourcesPromise);

    const connected = await mcpConnectionManager.connect(serverName, serverIndex, {
      ...resolvedConfig,
      id: serverId,
      timestamp: Date.now()
    });

    expect(connected).toBe(true);
    expect(mockListResources).toHaveBeenCalledWith(undefined, { timeout: 5000 });

    resolveResources({ resources: [] });
    await resourcesPromise;
  });

  it('should handle invalid parameters', async () => {
    // Get server configuration and instance configuration
    const serverInfo = hubManager.getServerById(serverId);
    if (!serverInfo) {
      throw new Error('Server not found');
    }

    // Resolve the complete configuration using v1.1 resolveInstanceConfig
    const resolvedConfig = resolveInstanceConfig(serverInfo.config, serverId);
    if (!resolvedConfig) {
      throw new Error('Failed to resolve server configuration');
    }

    await mcpConnectionManager.connect(serverName, serverIndex, {
      ...resolvedConfig,
      id: serverId,
      timestamp: Date.now()
    });

    await expect(
      mcpConnectionManager.callTool(serverName, serverIndex, 'calculator', {
        a: 'invalid',
        b: 3,
        operation: 'add'
      })
    ).rejects.toThrow();
  });

  it('should handle unknown tool', async () => {
    // Get server configuration and instance configuration
    const serverInfo = hubManager.getServerById(serverId);
    if (!serverInfo) {
      throw new Error('Server not found');
    }

    // Resolve the complete configuration using v1.1 resolveInstanceConfig
    const resolvedConfig = resolveInstanceConfig(serverInfo.config, serverId);
    if (!resolvedConfig) {
      throw new Error('Failed to resolve server configuration');
    }

    await mcpConnectionManager.connect(serverName, serverIndex, {
      ...resolvedConfig,
      id: serverId,
      timestamp: Date.now()
    });

    await expect(
      mcpConnectionManager.callTool(serverName, serverIndex, 'unknown_tool', {})
    ).rejects.toThrow();
  });

  it('should support multiple concurrent tool calls', async () => {
    // Get server configuration and instance configuration
    const serverInfo = hubManager.getServerById(serverId);
    if (!serverInfo) {
      throw new Error('Server not found');
    }

    // Resolve the complete configuration using v1.1 resolveInstanceConfig
    const resolvedConfig = resolveInstanceConfig(serverInfo.config, serverId);
    if (!resolvedConfig) {
      throw new Error('Failed to resolve server configuration');
    }

    await mcpConnectionManager.connect(serverName, serverIndex, {
      ...resolvedConfig,
      id: serverId,
      timestamp: Date.now()
    });

    const [result1, result2] = await Promise.all([
      mcpConnectionManager.callTool(serverName, serverIndex, 'get_weather', {
        location: 'New York'
      }) as Promise<{
        temperature: number;
        condition: string;
      }>,
      mcpConnectionManager.callTool(serverName, serverIndex, 'search_news', {
        query: 'technology'
      }) as Promise<{
        articles: string[];
      }>
    ]);

    expect(result1).toHaveProperty('temperature');
    expect(result1).toHaveProperty('condition');
    expect(result2).toHaveProperty('articles');
    expect(Array.isArray(result2.articles)).toBe(true);
  });
});
