#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from "http";
import os from "os";
import { getConfig } from "./config.js";
import { registerCredentialTools } from "./tools/credentials.js";
import { registerServiceTools } from "./tools/services.js";
import { registerLoginTools } from "./tools/login.js";
import { registerSecretTools } from "./tools/secrets.js";
import { closeAllSessions } from "./browser/manager.js";

const VERSION = "0.1.0";
const TAILSCALE_RANGE = "100.";

function findTailscaleIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && addr.address.startsWith(TAILSCALE_RANGE)) {
        return addr.address;
      }
    }
  }
  return null;
}

function isTailscaleIP(ip: string): boolean {
  return ip.startsWith(TAILSCALE_RANGE);
}

function stripPort(addr: string): string {
  return addr.replace(/::ffff:/, "").replace(/:.*$/, "");
}

function registerTools(server: McpServer): void {
  registerCredentialTools(server);
  registerServiceTools(server);
  registerLoginTools(server);
  registerSecretTools(server);
}

async function main(): Promise<void> {
  const config = getConfig();

  process.on("SIGINT", async () => {
    await closeAllSessions();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await closeAllSessions();
    process.exit(0);
  });

  const ssePort = config.AUTH_SSE_PORT;

  if (ssePort) {
    const tailscaleIP = findTailscaleIPv4();
    const bindAddress = config.AUTH_BIND_ADDRESS || tailscaleIP || null;

    if (!bindAddress) {
      console.error(
        "[AUTH-VAULT] FATAL: No Tailscale interface detected and AUTH_BIND_ADDRESS not set.\n" +
          "  SSE mode requires a Tailscale IP (100.x.x.x) or explicit bind address."
      );
      process.exit(1);
    }

    const sseTransports = new Map<string, SSEServerTransport>();
    let connectionsBlocked = 0;

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const remoteIP = stripPort(req.socket.remoteAddress || "");

      if (bindAddress !== "127.0.0.1" && !isTailscaleIP(remoteIP) && remoteIP !== "127.0.0.1" && remoteIP !== "::1" && remoteIP !== "::ffff:127.0.0.1") {
        connectionsBlocked++;
        if (remoteIP !== "") {
          res.writeHead(403);
          res.end(JSON.stringify({ error: "Access denied: Tailscale network only" }));
          return;
        }
      }

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            service: "mcp-auth-vault",
            version: VERSION,
            bindAddress,
            remoteIP,
            sessions: sseTransports.size,
          })
        );
        return;
      }

      if (url.pathname === "/sse") {
        const sessionServer = new McpServer(
          { name: "mcp-auth-vault", version: VERSION },
          { capabilities: { tools: {} } }
        );
        registerTools(sessionServer);

        const transport = new SSEServerTransport("/messages", res);
        sseTransports.set(transport.sessionId, transport);
        res.on("close", () => sseTransports.delete(transport.sessionId));
        await sessionServer.connect(transport);
        return;
      }

      if (url.pathname === "/messages") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId || !sseTransports.has(sessionId)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid sessionId" }));
          return;
        }
        const transport = sseTransports.get(sessionId)!;
        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(ssePort, bindAddress, () => {
      console.error(`[AUTH-VAULT] SSE server running on ${bindAddress}:${ssePort}`);
      console.error(`[AUTH-VAULT]    Health: http://${bindAddress}:${ssePort}/health`);
      console.error(`[AUTH-VAULT]    SSE:    http://${bindAddress}:${ssePort}/sse`);
      console.error(`[AUTH-VAULT]    Vault:  ${config.VAULT_ROOT}`);
      console.error(`[AUTH-VAULT]    Encrypt: ${config.VAULT_ENCRYPTION_KEY ? "AES-256-GCM" : "disabled"}`);
    });
  } else {
    const server = new McpServer(
      { name: "mcp-auth-vault", version: VERSION },
      { capabilities: { tools: {} } }
    );
    registerTools(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((err) => {
  console.error("[AUTH-VAULT] Fatal error:", err);
  process.exit(1);
});
