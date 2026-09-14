"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import AppCard from "@/components/AppCard";
import type { AgentEvent } from "@/lib/agent";
import { accessToken, clearTokens, loadTokens, startLink } from "@/lib/client/link";
import { callTool, clearState, getState, setState } from "@/lib/client/mcp";

interface Card {
  key: string;
  uri: string;
  tool: string;
  result: CallToolResult;
}

interface Turn {
  key: string;
  user: string;
  via: "voice" | "card" | "demo";
  reply?: string;
  error?: string;
}

type Activity = AgentEvent & { key: string };

const uid = () => Math.random().toString(36).slice(2, 10);

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.03;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is optional */
  }
}

function compact(v: unknown): string {
  if (v === undefined) return "";
  const s = JSON.stringify(v);
  return s === "{}" ? "" : s.length > 70 ? `${s.slice(0, 67)}…` : s;
}

const TONES = {
  blocked: { box: "bg-[#3a1a12] ring-[#7a2e1a]", pill: "bg-[#c8431a]", text: "text-[#f3b8a3]", label: "BLOCKED" },
  allowed: { box: "bg-[#132a22] ring-[#24533f]", pill: "bg-[#3f9a6e]", text: "text-[#a9dcc2]", label: "ALLOWED" },
  routed: { box: "bg-[#1b1f2e] ring-[#34405f]", pill: "bg-[#5566b8]", text: "text-[#b9c3ee]", label: "ROUTED" },
  steered: { box: "bg-[#322712] ring-[#6b5220]", pill: "bg-[#b7791f]", text: "text-[#f1d19c]", label: "STEERED" },
} as const;

export default function Display() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [clock, setClock] = useState("");
  const busyRef = useRef(false);
  const queue = useRef<{ text: string; via: Turn["via"] }[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  turnsRef.current = turns;

  useEffect(() => {
    setLinked(Boolean(loadTokens()));
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 20_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [activity]);

  const pushActivity = (e: AgentEvent) => setActivity((a) => [...a.slice(-60), { ...e, key: uid() }]);

  const send = useCallback(
    async (text: string, via: Turn["via"] = "voice") => {
      const clean = text.trim();
      if (!clean) return;
      if (busyRef.current) {
        queue.current.push({ text: clean, via });
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const key = uid();
      const history = turnsRef.current
        .filter((t) => t.via !== "demo")
        .slice(-4)
        .flatMap((t) => [{ role: "user", text: t.user }, ...(t.reply ? [{ role: "assistant", text: t.reply }] : [])]);
      setTurns((ts) => [...ts, { key, user: clean, via }]);
      const patch = (p: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.key === key ? { ...t, ...p } : t)));
      try {
        const token = await accessToken();
        if (!token) {
          setLinked(false);
          throw new Error("Refill isn't linked yet.");
        }
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ text: clean, history, state: getState() }),
        });
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `Agent error ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const e = JSON.parse(line) as AgentEvent;
            if (e.type === "state") setState(e.token);
            else if (e.type === "say") {
              patch({ reply: e.text });
              if (!muted) speak(e.text);
            } else if (e.type === "error") patch({ error: e.message });
            else {
              pushActivity(e);
              if (e.type === "mcp" && e.phase === "response" && e.resourceUri && e.structuredContent && !e.isError) {
                const result: CallToolResult = { content: [{ type: "text", text: e.text ?? "" }], structuredContent: e.structuredContent as Record<string, unknown> };
                setCards((cs) => [...cs.slice(-5), { key: uid(), uri: e.resourceUri!, tool: e.tool ?? "", result }]);
              }
            }
          }
        }
      } catch (err) {
        patch({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        busyRef.current = false;
        setBusy(false);
        const next = queue.current.shift();
        if (next) void send(next.text, next.via);
      }
    },
    [muted],
  );

  const submit = () => {
    const t = input;
    setInput("");
    void send(t, "voice");
  };

  const toggleMic = () => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript ?? "";
      setInput("");
      void send(said, "voice");
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const simulate = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const key = uid();
    setTurns((ts) => [...ts, { key, user: "Three days later…", via: "demo" }]);
    try {
      const r = await callTool("simulate_days", { days: 3 });
      pushActivity({ type: "mcp", phase: "response", id: key, method: "tools/call", tool: "simulate_days", status: 200, ms: 0, text: "Demo control: calendar advanced 3 days (deliveries, pickups, usage)" });
      setTurns((ts) => ts.map((t) => (t.key === key ? { ...t, reply: "The order arrived and Dan picked up the refill while you were away." } : t)));
      if (r.structuredContent) setCards((cs) => [...cs.slice(-5), { key: uid(), uri: "ui://refill/running-low", tool: "simulate_days", result: r }]);
    } catch (err) {
      setTurns((ts) => ts.map((t) => (t.key === key ? { ...t, error: String(err) } : t)));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const reset = () => {
    window.speechSynthesis?.cancel();
    clearState();
    setTurns([]);
    setCards([]);
    setActivity([]);
  };

  const unlink = () => {
    reset();
    clearTokens();
    setLinked(false);
  };

  const latest = turns.at(-1);
  const earlier = turns.slice(-3, -1);
  const card = cards.at(-1);

  return (
    <main className="room h-screen overflow-hidden w-full flex items-stretch gap-6 p-6 text-[15px]">
      <section className="flex-1 flex flex-col items-center justify-center min-w-0 min-h-0">
        <div className="bezel rounded-[38px] p-[18px] w-full max-w-[1000px]">
          <div className="screen rounded-[24px] h-[640px] overflow-hidden flex flex-col">
            <header className="flex items-center justify-between px-7 pt-5 pb-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-[#1d5c58] text-white grid place-items-center font-[family-name:var(--font-display)] text-lg">R</div>
                <div>
                  <div className="font-[family-name:var(--font-display)] text-[20px] leading-none text-[#2a2119]">Refill</div>
                  <div className="text-[12.5px] text-[#7c6c5c] mt-1">Walter’s house · Tucson · {linked ? "account linked" : "not linked"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[13px] text-[#7c6c5c]">
                <span className="rounded-full bg-[#efe4d2] px-3 py-1">Simulated Alexa+ display</span>
                <span className="tabular-nums">{clock}</span>
              </div>
            </header>

            {linked === false ? (
              <div className="flex-1 grid place-items-center px-10">
                <div className="max-w-md text-center fade-in">
                  <div className="font-[family-name:var(--font-display)] text-[34px] leading-tight text-[#2a2119]">Keep Dad’s house stocked from a thousand miles away.</div>
                  <p className="mt-4 text-[#7c6c5c]">Refill is an Alexa+ add-on. Link your Refill account to use it on this display.</p>
                  <button onClick={() => void startLink()} data-testid="link-account" className="mt-7 rounded-2xl bg-[#1d5c58] px-7 py-3.5 text-white font-semibold text-[16px] shadow-lg">
                    Link Refill account
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 grid grid-cols-[320px_1fr] gap-5 px-7 pb-6 min-h-0">
                <div className="flex flex-col justify-end min-h-0 pb-2 overflow-hidden" data-testid="captions">
                  {earlier.map((t) => (
                    <div key={t.key} className="mb-3 opacity-45">
                      <div className="text-[14px] text-[#2a2119] line-clamp-2">“{t.user}”</div>
                      {t.reply && <div className="text-[13px] text-[#7c6c5c] line-clamp-2 mt-0.5">{t.reply}</div>}
                    </div>
                  ))}
                  {latest ? (
                    <div key={latest.key} className="fade-in">
                      <div className="text-[11.5px] uppercase tracking-[.14em] text-[#9a8672] mb-1">{latest.via === "card" ? "Tapped on card" : latest.via === "demo" ? "Demo control" : "You said"}</div>
                      <div className="font-[family-name:var(--font-display)] text-[25px] leading-[1.18] text-[#2a2119]">“{latest.user}”</div>
                      <div className="mt-4 min-h-[76px]" data-testid="reply">
                        {latest.reply ? (
                          <div className="fade-in flex gap-2.5">
                            <div className="mt-1 h-6 w-6 flex-none rounded-full bg-gradient-to-br from-[#2f8a82] to-[#1d5c58] shadow" />
                            <div className="text-[17px] leading-snug text-[#3b3026]">{latest.reply}</div>
                          </div>
                        ) : latest.error ? (
                          <div className="text-[14px] text-[#b4441c]">{latest.error}</div>
                        ) : (
                          <div className="flex items-center gap-2 text-[14px] text-[#7c6c5c]">
                            <span className="flex gap-1">
                              <span className="listening-dot h-2 w-2 rounded-full bg-[#1d5c58]" />
                              <span className="listening-dot h-2 w-2 rounded-full bg-[#1d5c58] [animation-delay:.15s]" />
                              <span className="listening-dot h-2 w-2 rounded-full bg-[#1d5c58] [animation-delay:.3s]" />
                            </span>
                            Refill agent is working…
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="fade-in">
                      <div className="font-[family-name:var(--font-display)] text-[27px] leading-tight text-[#2a2119]">Good afternoon, Maya.</div>
                      <p className="mt-2 text-[#7c6c5c]">Try “What’s running low at Dad’s?”</p>
                    </div>
                  )}
                </div>
                <div className="cards min-h-0 overflow-y-auto flex flex-col justify-center" data-testid="cards">
                  {card ? (
                    <div key={card.key} className="fade-in rounded-[22px] bg-[#fffaf1] shadow-[0_18px_40px_-24px_rgba(60,40,20,.55)] ring-1 ring-[#eadfcc] overflow-hidden">
                      <AppCard uri={card.uri} result={card.result} onMessage={(t) => void send(t, "card")} />
                    </div>
                  ) : (
                    <div className="h-full rounded-[22px] border-2 border-dashed border-[#e6d8c2] grid place-items-center text-[#b19c83] text-sm">Cards from Refill appear here</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 w-full max-w-[1000px] flex items-center gap-3">
          <button onClick={toggleMic} disabled={!linked} data-testid="mic" title="Push to talk" className={`h-12 w-12 flex-none rounded-full grid place-items-center text-white shadow-lg ${listening ? "bg-[#c8431a]" : "bg-[#1d5c58]"} disabled:opacity-40`}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            disabled={!linked}
            data-testid="agent-input"
            placeholder={listening ? "Listening…" : "Talk to Refill (or type)"}
            className="flex-1 h-12 rounded-full bg-[#2c241e] px-5 text-[#f5ead8] placeholder:text-[#8e7d6b] outline-none ring-1 ring-[#3d332b] focus:ring-[#2f8a82] disabled:opacity-40"
          />
          <button onClick={submit} disabled={!linked || busy} data-testid="send" className="h-12 rounded-full bg-[#f1e4cf] px-6 font-semibold text-[#2a2119] disabled:opacity-40">
            Send
          </button>
          <div className="w-px h-8 bg-[#3d332b] mx-1" />
          <button onClick={() => void simulate()} disabled={!linked || busy} data-testid="simulate" className="h-12 rounded-full px-4 text-[13px] text-[#d8c8b2] ring-1 ring-[#3d332b] disabled:opacity-40">
            ⏩ 3 days later
          </button>
          <button onClick={reset} data-testid="reset" className="h-12 rounded-full px-4 text-[13px] text-[#d8c8b2] ring-1 ring-[#3d332b]">
            Reset demo
          </button>
          <button onClick={() => setMuted((m) => !m)} className="h-12 rounded-full px-3 text-[13px] text-[#d8c8b2] ring-1 ring-[#3d332b]" title="Spoken replies">
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </section>

      <aside className="w-[380px] flex-none min-h-0 rounded-[26px] bg-[#120e0b]/90 ring-1 ring-[#2e2620] flex flex-col overflow-hidden" data-testid="activity-panel">
        <div className="px-5 pt-5 pb-3 border-b border-[#2a221c]">
          <div className="text-[11px] uppercase tracking-[.18em] text-[#8e7d6b]">Under the hood</div>
          <div className="mt-1 font-[family-name:var(--font-display)] text-[20px] text-[#f3e7d3]">Strands agent → Refill MCP server</div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full bg-[#1d3b39] text-[#9fd8cf] px-2 py-0.5">Strands Agents SDK</span>
            <span className="rounded-full bg-[#2b2540] text-[#c7b9ff] px-2 py-0.5">MCP 2025-11-25 · Streamable HTTP</span>
            <span className="rounded-full bg-[#3a2a1c] text-[#f3c58f] px-2 py-0.5">MCP Apps</span>
            <span className="rounded-full bg-[#2a2a2a] text-[#cfcfcf] px-2 py-0.5">OAuth 2.1 + PKCE</span>
          </div>
        </div>
        <div ref={logRef} className="activity flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-1.5 font-[family-name:var(--font-mono)] text-[11.5px] leading-snug" data-testid="activity">
          {activity.length === 0 && <div className="text-[#6f6052] font-sans text-[13px] px-1">MCP requests and guardrail decisions show up here.</div>}
          {activity.map((a) => {
            if (a.type === "hook") {
              const tone = TONES[a.verdict];
              if (a.verdict === "routed") {
                return (
                  <div key={a.key} data-testid="hook-routed" className="fade-in mt-2 flex items-center gap-2 font-sans text-[12px] text-[#b9c3ee]">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white ${tone.pill}`}>{tone.label}</span>
                    <span>{a.reason}</span>
                  </div>
                );
              }
              return (
                <div key={a.key} data-testid={`hook-${a.verdict}`} className={`fade-in rounded-lg px-2.5 py-2 font-sans ring-1 ${tone.box}`}>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white ${tone.pill}`}>{tone.label}</span>
                    <span className="font-[family-name:var(--font-mono)] text-[11px] text-[#e8dccb]">{a.tool}</span>
                  </div>
                  <div className={`mt-1 text-[12px] ${tone.text}`}>
                    <span className="opacity-70">{a.verdict === "steered" ? "steering" : "hook"} {a.rule}:</span> {a.reason}
                  </div>
                </div>
              );
            }
            if (a.type !== "mcp") return null;
            if (a.phase === "request") {
              return (
                <div key={a.key} className="fade-in text-[#cdbba5]">
                  <span className="text-[#7fc4bb]">→</span> {a.method}
                  {a.tool && <span className="text-[#f3e7d3]"> {a.tool}</span>}
                  {a.tool && <span className="text-[#8e7d6b]"> {compact(a.args)}</span>}
                </div>
              );
            }
            return (
              <div key={a.key} className={`fade-in pl-3 ${a.isError ? "text-[#f0a58c]" : "text-[#8e7d6b]"}`}>
                <span className={a.isError ? "text-[#f0a58c]" : "text-[#7fc4bb]"}>←</span> {a.status}
                {a.ms ? ` · ${a.ms} ms` : ""}
                {a.summary && <span className="text-[#bfae98]"> · {a.summary}</span>}
                {a.resourceUri && <span className="text-[#f3c58f]"> · {a.resourceUri}</span>}
                {a.text && <div className="text-[#a8967f] line-clamp-2">{a.text}</div>}
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-[#2a221c] flex items-center justify-between text-[11.5px] text-[#6f6052]">
          <span>Qwen3.8-27B via Strands OpenAIModel</span>
          {linked && (
            <button onClick={unlink} className="underline decoration-dotted">
              Unlink
            </button>
          )}
        </div>
      </aside>
    </main>
  );
}
