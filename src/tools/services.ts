import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getServiceTemplate,
  listServiceTemplates,
  registerCustomService,
} from "../services/definitions.js";

function jsonOk(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function jsonError(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function registerServiceTools(server: McpServer): void {
  // === list_services ===
  server.tool(
    "list_services",
    "List all supported services with their login templates",
    {},
    async () => {
      try {
        const templates = listServiceTemplates();
        return jsonOk({
          count: templates.length,
          services: templates.map((t) => ({
            id: t.id,
            label: t.label,
            loginUrl: t.loginUrl,
            extraFields: t.extraFields?.map((f) => ({
              name: f.name,
              label: f.label,
              type: f.type,
            })),
          })),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === get_service_template ===
  server.tool(
    "get_service_template",
    "Get detailed login template for a specific service",
    {
      service: z.string().min(1).describe("Service identifier"),
    },
    async (input) => {
      try {
        const template = getServiceTemplate(input.service);
        if (!template) {
          return jsonError(`Service '${input.service}' not found. Use list_services to see available services.`);
        }
        return jsonOk(template);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );

  // === add_service ===
  server.tool(
    "add_service",
    "Register a custom service login template at runtime",
    {
      id: z.string().min(1).describe("Unique service identifier (e.g., 'mycompany', 'custom-app')"),
      label: z.string().min(1).describe("Human-readable display name"),
      loginUrl: z.string().url().describe("Login page URL"),
      usernameSelector: z.string().min(1).describe("CSS selector for username/email input field"),
      passwordSelector: z.string().min(1).describe("CSS selector for password input field"),
      submitSelector: z.string().min(1).describe("CSS selector for submit button"),
      successUrlPattern: z.string().optional().describe("URL pattern that indicates successful login"),
      successSelector: z.string().optional().describe("CSS selector for element that indicates successful login"),
    },
    async (input) => {
      try {
        registerCustomService({
          id: input.id,
          label: input.label,
          loginUrl: input.loginUrl,
          usernameSelector: input.usernameSelector,
          passwordSelector: input.passwordSelector,
          submitSelector: input.submitSelector,
          successUrlPattern: input.successUrlPattern,
          successSelector: input.successSelector,
        });
        return jsonOk({ success: true, service: input.id, label: input.label });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(msg);
      }
    }
  );
}
