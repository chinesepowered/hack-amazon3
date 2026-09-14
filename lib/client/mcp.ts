"use client";
// The display's own MCP client: reads ui:// resources and proxies MCP App tool calls back to Refill's server.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { accessToken } from "./link";

const STATE_KEY = "refill.state";

export const getState = () => localStorage.getItem(STATE_KEY);
export const setState = (token: string) => localStorage.setItem(STATE_KEY, token);
export const clearState = () => localStorage.removeItem(STATE_KEY);

async function statefulFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = await accessToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const state = getState();
  if (state) headers.set("x-refill-state", state);
  const res = await fetch(url, { ...init, headers });
  const next = res.headers.get("x-refill-state");
  if (next) setState(next);
  return res;
}

let client: Promise<Client> | null = null;

export function mcp(): Promise<Client> {
  if (!client) {
    client = (async () => {
      const c = new Client(
        { name: "refill-display-simulator", version: "1.0.0" },
        { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } as Record<string, unknown> },
      );
      await c.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", window.location.origin), { fetch: statefulFetch }));
      return c;
    })().catch((e) => {
      client = null;
      throw e;
    });
  }
  return client;
}

const uiCache = new Map<string, string>();

export async function readUi(uri: string): Promise<string> {
  const hit = uiCache.get(uri);
  if (hit) return hit;
  const res = await (await mcp()).readResource({ uri });
  const first = res.contents[0] as { text?: string };
  const html = first?.text ?? "<p>Missing UI</p>";
  uiCache.set(uri, html);
  return html;
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await (await mcp()).callTool({ name, arguments: args })) as CallToolResult;
}
