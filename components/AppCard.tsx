"use client";
// Renders one MCP App (ui:// resource) in a sandboxed iframe and bridges it with the ext-apps AppBridge.
import { useEffect, useRef, useState } from "react";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callTool, readUi } from "@/lib/client/mcp";

interface Props {
  uri: string;
  result: CallToolResult;
  onMessage: (text: string) => void;
}

export default function AppCard({ uri, result, onMessage }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [height, setHeight] = useState(360);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let live = true;
    readUi(uri).then((h) => live && setHtml(h)).catch(() => live && setHtml("<p style='font-family:sans-serif'>Couldn't load this card.</p>"));
    return () => {
      live = false;
    };
  }, [uri]);

  useEffect(() => {
    const iframe = frame.current;
    if (!html || !iframe || !iframe.contentWindow) return;
    const bridge = new AppBridge(
      null,
      { name: "Refill display simulator", version: "1.0.0" },
      { serverTools: {}, message: { text: {} } },
      { hostContext: { theme: "light", platform: "web", displayMode: "inline", locale: "en-US" } },
    );
    bridge.oncalltool = async (params) => callTool(params.name, (params.arguments ?? {}) as Record<string, unknown>);
    bridge.onmessage = async (params) => {
      const text = params.content.map((c) => (c.type === "text" ? c.text : "")).join(" ").trim();
      if (text) onMessageRef.current(text);
      return {};
    };
    bridge.onsizechange = ({ height: h }) => {
      if (h) setHeight(Math.min(Math.max(h, 120), 620));
    };
    bridge.oninitialized = () => {
      void bridge.sendToolResult(result);
    };
    const win = iframe.contentWindow;
    let closed = false;
    void bridge.connect(new PostMessageTransport(win, win)).then(() => {
      if (!closed) iframe.srcdoc = html;
    });
    return () => {
      closed = true;
      void bridge.close();
    };
  }, [html, result]);

  return <iframe ref={frame} title={uri} sandbox="allow-scripts" data-testid="card-frame" className="w-full rounded-2xl border-0 bg-[#fffaf1] transition-[height] duration-300" style={{ height }} />;
}
