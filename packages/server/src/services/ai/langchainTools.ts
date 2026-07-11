import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { z } from "zod";

export type AgentTool = StructuredToolInterface;
export type AgentToolSet = Record<string, AgentTool>;

type ToolConfig<TSchema extends z.ZodTypeAny> = {
  description: string;
  inputSchema: TSchema;
  execute: (input: z.infer<TSchema>) => Promise<unknown> | unknown;
};

/**
 * Small helper for keeping object-shaped Chouse tool collections while exposing
 * concrete named LangChain tools to DeepAgents.
 */
export function createAgentTool<TSchema extends z.ZodTypeAny>(
  name: string,
  config: ToolConfig<TSchema>,
): AgentTool {
  return tool(
    async (input: z.infer<TSchema>) => config.execute(input),
    {
      name,
      description: config.description,
      schema: config.inputSchema,
    },
  );
}

export function toolsArray(tools: AgentToolSet): AgentTool[] {
  return Object.values(tools);
}
