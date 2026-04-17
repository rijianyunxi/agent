import type { SmartSiteAgentOptions } from './agent.ts';
import { SmartSiteAgent } from './agent.ts';

export type AgentCoreOptions = SmartSiteAgentOptions;

export function resolveAgentOptions(overrides: AgentCoreOptions = {}): AgentCoreOptions {
  return {
    ...(process.env['AGENT_USER_ID'] ? { userId: process.env['AGENT_USER_ID'] } : {}),
    ...(process.env['AGENT_USER_SYMBOL'] ? { userSymbol: process.env['AGENT_USER_SYMBOL'] } : {}),
    ...overrides,
  };
}

export function ensureApiKey(): void {
  if (!process.env['OPENAI_API_KEY']) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }
}

export async function createAgentCore(options: AgentCoreOptions = {}): Promise<SmartSiteAgent> {
  ensureApiKey();

  const agent = new SmartSiteAgent(resolveAgentOptions(options));
  await agent.initialize();
  return agent;
}

export async function disposeAgentCore(agent: SmartSiteAgent): Promise<void> {
  await agent.shutdown();
}
