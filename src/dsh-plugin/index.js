import { MCP_TOOLS, executeMcpToolCall } from "../mcp/mcp-server.js";

export const name = "dsh-company-multiagent";
export const inject = {
  optional: ["tools", "commands"],
};

/**
 * Native DSH Cordis plugin entry point.
 * Registers the 4-tier company orchestration tools directly into DSH's tool registry when available.
 */
export function apply(ctx) {
  if (ctx.tools && typeof ctx.tools.register === "function") {
    for (const toolDef of MCP_TOOLS) {
      ctx.tools.register({
        name: toolDef.name,
        description: toolDef.description,
        parameters: toolDef.inputSchema,
        execute: async (args) => executeMcpToolCall(toolDef.name, args),
      });
    }
  }
}
