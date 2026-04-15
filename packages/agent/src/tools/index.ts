import type { Logger, Tool } from '../types.ts';

interface ToolRegistryDeps {
  logger?: Logger;
  dynamicTools?: Tool[];
}

interface ToolRegistry {
  toolDefinitions: Tool['definition'][];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
}

export function createToolRegistry({
  logger = console,
  dynamicTools = [],
}: ToolRegistryDeps): ToolRegistry {
  const toolMap = new Map<string, Tool>();
  dynamicTools.forEach((tool) => {
    toolMap.set(tool.definition.function.name, tool);
  });

  return {
    toolDefinitions: [...toolMap.values()].map((tool) => tool.definition),
    async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
      const tool = toolMap.get(name);
      if (!tool) {
        return JSON.stringify({ error: `Unknown tool: ${name}` });
      }

      try {
        logger.log(`  [tool] ${name}`, JSON.stringify(input));
        return await tool.execute(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`  [tool:error] ${name}`, message);
        return JSON.stringify({ error: message });
      }
    },
  };
}
