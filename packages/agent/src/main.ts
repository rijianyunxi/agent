import { createInterface } from 'node:readline';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadImageAsDataURL } from '@agent/tools';

import type { SmartSiteAgentOptions } from './agent.ts';
import { SmartSiteAgent } from './agent.ts';

export interface ParsedInput {
  text: string;
  imageUrl?: string;
}

export type AgentCoreOptions = SmartSiteAgentOptions;

export function parseInput(raw: string): ParsedInput {
  const imageMatch = raw.match(/^image:(?:"([^"]+)"|'([^']+)'|(\S+))\s*(.*)$/s);

  if (imageMatch) {
    const imageUrl = imageMatch[1] ?? imageMatch[2] ?? imageMatch[3];
    return {
      text: imageMatch[4] || 'Please analyze this construction-site image for risks and issues.',
      ...(imageUrl ? { imageUrl } : {}),
    };
  }

  return { text: raw };
}

export async function resolveCliImageInput(imageUrl?: string): Promise<string | undefined> {
  if (!imageUrl) {
    return undefined;
  }

  const trimmed = imageUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    // treat as local path
  }

  const localPath = path.resolve(trimmed);
  const info = await stat(localPath);
  if (!info.isFile()) {
    throw new Error(`图片路径不是文件: ${localPath}`);
  }

  return await loadImageAsDataURL(localPath);
}

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

async function runCli(): Promise<void> {
  await import('dotenv/config');

  let agent: SmartSiteAgent | null = null;

  try {
    agent = await createAgentCore();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  if (!agent) {
    return;
  }

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await disposeAgentCore(agent);
  };

  process.once('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.once('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('========================================');
  console.log(' Agent Core CLI');
  console.log('========================================');
  console.log('Type a question to start chatting.');
  console.log('Image format: image:https://example.com/site.jpg What risks do you see?');
  console.log('Type reset to clear the current conversation window.');
  console.log('Type exit to quit.');
  console.log('');

  const prompt = (): void => {
    rl.question('you> ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === 'exit') {
        await shutdown();
        console.log('Bye.');
        rl.close();
        process.exit(0);
      }

      if (trimmed === 'reset') {
        agent.reset();
        prompt();
        return;
      }

      try {
        const { text, imageUrl } = parseInput(trimmed);
        const resolvedImage = await resolveCliImageInput(imageUrl);
        const reply = await agent.run(text, resolvedImage);
        console.log('');
        console.log('agent> ' + reply);
        console.log('');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('');
        console.error('error: ' + message);
        console.error('');
      }

      prompt();
    });
  };

  prompt();
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectExecution()) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
