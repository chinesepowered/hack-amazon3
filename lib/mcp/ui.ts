// MCP Apps (ui:// resources). Each is a self-contained HTML page that speaks the MCP Apps postMessage
// dialect directly (ui/initialize, ui/notifications/tool-result, ui/message, size-changed), so any
// MCP Apps host can render it without loading external scripts.

export const MCP_APPS_PROTOCOL = "2026-01-26";

const RUNTIME = /* js */ `
const pending = new Map(); let seq = 0;
function rpc(method, params) { const id = ++seq; parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*"); return new Promise((res, rej) => pending.set(id, { res, rej })); }
function notify(method, params) { parent.postMessage({ jsonrpc: "2.0", method, params }, "*"); }
function say(text) { return rpc("ui/message", { role: "user", content: [{ type: "text", text }] }); }
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const usd = (n) => "$" + Number(n || 0).toFixed(2);
window.addEventListener("message", (ev) => {
  const m = ev.data; if (!m || m.jsonrpc !== "2.0") return;
  if (m.id !== undefined && m.method === undefined) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(m.error) : p.res(m.result); } return; }
  if (m.method === "ui/notifications/tool-result") { try { render(m.params.structuredContent || {}); } catch (e) { document.body.textContent = "Render error: " + e; } }
  else if (m.id !== undefined && (m.method === "ui/resource-teardown" || m.method === "ping")) parent.postMessage({ jsonrpc: "2.0", id: m.id, result: {} }, "*");
});
(async () => {
  await rpc("ui/initialize", { appInfo: { name: APP_NAME, version: "1.0.0" }, appCapabilities: {}, protocolVersion: "${MCP_APPS_PROTOCOL}" });
  notify("ui/notifications/initialized", {});
  const root = document.getElementById("root");
  const report = () => notify("ui/notifications/size-changed", { height: Math.ceil(root.getBoundingClientRect().height) + 40 });
  new ResizeObserver(report).observe(root);
})();
`;

const BASE_CSS = /* css */ `
:root { --ink:#2a2119; --muted:#7c6c5c; --paper:#fffaf1; --card:#fff; --line:#ecdfcc; --crit:#c8431a; --low:#d98a12; --ok:#4f7d5c; --rx:#6a55c8; --teal:#1d5c58; }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--paper); }
body { padding:18px 20px 22px; color:var(--ink); font:14px/1.4 "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
h1 { margin:0; font:600 23px/1.15 Georgia, "Iowan Old Style", "Palatino Linotype", serif; letter-spacing:-.01em; }
.sub { color:var(--muted); font-size:12.5px; margin-top:3px; }
.chip { display:inline-block; font-size:11.5px; font-weight:600; padding:3px 8px; border-radius:999px; white-space:nowrap; }
.chip.ok { background:#e3efe5; color:#2f5d3b; } .chip.rx { background:#ece8fb; color:#4b3aa0; } .chip.crit { background:#fbe3d9; color:#9a3412; } .chip.low { background:#fdf1dc; color:#8a5300; }
button { font:600 14px "Segoe UI", system-ui, sans-serif; border:0; border-radius:12px; padding:11px 16px; cursor:pointer; }
button:disabled { opacity:.6; cursor:default; }
.primary { background:var(--teal); color:#fff; } .secondary { background:#ece8fb; color:#3d2f8f; }
`;

function page(name: string, css: string, body: string, script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${BASE_CSS}${css}</style></head><body><div id="root">${body}</div><script>const APP_NAME=${JSON.stringify(name)};${script}\n${RUNTIME}</script></body></html>`;
}

const LOADING = `<div class="sub">Loading…</div>`;

const runningLow = page(
  "refill-running-low",
  /* css */ `
  .top { display:flex; justify-content:space-between; align-items:flex-end; gap:10px; margin-bottom:10px; }
  .stats { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
  .grid { display:grid; grid-template-columns: 176px 1fr 104px; column-gap:12px; align-items:center; }
  .axis { font-size:11px; color:var(--muted); position:relative; height:18px; }
  .axis span { position:absolute; top:0; transform:translateX(-50%); white-space:nowrap; } .axis span.first { transform:none; } .axis span.last { transform:translateX(-100%); }
  .row { padding:6px 0; border-top:1px solid var(--line); opacity:0; transform:translateY(4px); transition:opacity .35s ease var(--d), transform .35s ease var(--d); }
  .go .row { opacity:1; transform:none; }
  .name b { font-weight:600; font-size:13.5px; } .det { font-size:11.5px; color:var(--muted); }
  .rxb { margin-left:6px; font-size:10px; font-weight:700; color:var(--rx); border:1.5px solid var(--rx); border-radius:4px; padding:0 3px; vertical-align:1px; }
  .track { position:relative; height:26px; border-radius:7px; background:linear-gradient(90deg, #fbe7de 0 calc(100%*3/21), #fdf1dc calc(100%*3/21) calc(100%*7/21), #f4efe6 calc(100%*7/21)); }
  .bar { position:absolute; left:0; top:5px; bottom:5px; width:0; border-radius:0 6px 6px 0; transition:width .8s cubic-bezier(.2,.8,.2,1) var(--d); }
  .go .bar { width:var(--w); }
  .critical .bar { background:var(--crit); } .low .bar { background:var(--low); } .ok .bar { background:var(--ok); }
  .lbl { position:absolute; top:4px; font-size:12px; font-weight:600; white-space:nowrap; color:var(--ink); }
  .lbl.in { left:8px; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.3); }
  .foot { margin-top:10px; display:flex; justify-content:space-between; font-size:12.5px; color:var(--muted); }
  `,
  LOADING,
  /* js */ `
function render(d) {
  const MAX = 21;
  const rows = (d.items || []).map((it, i) => {
    const pct = Math.max(3, Math.min(100, (it.daysLeft / MAX) * 100));
    const days = it.daysLeft === 0 ? "Out today" : it.daysLeft + (it.daysLeft === 1 ? " day" : " days");
    const inside = pct > 58;
    let chip = "";
    if (it.onOrder) chip = '<span class="chip ok">Arrives ' + esc(it.onOrder.etaLabel.replace(/^\\w+, /, "")) + "</span>";
    else if (it.rx && it.rx.request) chip = '<span class="chip rx">Refill ' + esc(it.rx.request.status.replace("_", " ")) + "</span>";
    else if (it.category === "rx" && it.status !== "ok") chip = '<span class="chip rx">Refill due</span>';
    else if (it.status === "critical") chip = '<span class="chip crit">Order now</span>';
    return '<div class="grid row ' + it.status + '" style="--d:' + (i * 55) + 'ms"><div class="name"><b>' + esc(it.name) + "</b>" + (it.category === "rx" ? '<span class="rxb">Rx</span>' : "") +
      '<div class="det">' + it.onHand + " " + esc(it.unit) + " left · " + it.dailyUse + '/day</div></div><div class="track"><div class="bar" style="--w:' + pct + '%"></div><div class="lbl' + (inside ? " in" : "") + '"' + (inside ? "" : ' style="left:calc(' + pct + '% + 8px)"') + ">" + days + " · " + esc(it.runsOutLabel) + "</div></div><div>" + chip + "</div></div>";
  }).join("");
  const c = d.counts || {};
  document.getElementById("root").innerHTML =
    '<div class="top"><div><h1>Running low at ' + esc(d.parent && d.parent.name) + '’s</h1><div class="sub">' + esc(d.parent && d.parent.city) + " · predicted from daily use · " + esc(d.todayLabel) + '</div></div><div class="stats">' +
    (c.critical ? '<span class="chip crit">' + c.critical + " urgent</span>" : "") + (c.low ? '<span class="chip low">' + c.low + " low</span>" : "") + (c.rxDue ? '<span class="chip rx">' + c.rxDue + " Rx due</span>" : "") + (c.onOrder ? '<span class="chip ok">' + c.onOrder + " on order</span>" : "") + "</div></div>" +
    '<div class="grid"><div></div><div class="axis"><span class="first" style="left:0">Today</span><span style="left:' + (100 * 7 / 21) + '%">1 wk</span><span style="left:' + (100 * 14 / 21) + '%">2 wk</span><span class="last" style="left:100%">3 wk</span></div><div></div></div>' +
    rows + '<div class="foot"><span>' + usd(d.budget && d.budget.remaining) + " left of " + usd(d.budget && d.budget.monthly) + " monthly budget</span><span>Refill · MCP App</span></div>";
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("go")));
}`,
);

const checkout = page(
  "refill-checkout",
  /* css */ `
  .head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .stamp { font:700 15px Georgia, serif; color:var(--ok); border:2.5px solid var(--ok); border-radius:10px; padding:6px 12px; transform:rotate(-4deg); animation:pop .45s cubic-bezier(.2,1.6,.4,1); }
  @keyframes pop { from { transform:rotate(-4deg) scale(1.8); opacity:0 } }
  table { width:100%; border-collapse:collapse; margin:12px 0 6px; font-size:13.5px; }
  td { padding:6px 0; border-top:1px solid var(--line); } td.q { color:var(--muted); width:84px; } td.p { text-align:right; font-variant-numeric:tabular-nums; width:80px; }
  tr.total td { font-weight:700; border-top:2px solid var(--ink); }
  .skip { font-size:12px; color:var(--muted); margin:2px 0; }
  .budget { margin:12px 0 4px; } .btrack { height:10px; border-radius:6px; background:#efe6d8; overflow:hidden; display:flex; }
  .spent { background:#8c7b69; } .pend { background:repeating-linear-gradient(45deg, var(--teal) 0 6px, #2d7a74 6px 12px); } .pend.over { background:var(--crit); }
  .blbl { font-size:12px; color:var(--muted); margin-top:5px; display:flex; justify-content:space-between; }
  .actions { margin-top:12px; } .actions .primary { width:100%; font-size:15px; padding:13px; }
  .rx { margin-top:14px; border:1.5px dashed #c9bdf0; background:#f8f6ff; border-radius:14px; padding:12px 14px; }
  .rx h2 { margin:0 0 2px; font:600 15px Georgia, serif; color:#3d2f8f; } .rx .row { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:8px; }
  .rx .lock { font-size:11.5px; color:#5b4bb0; margin-top:6px; }
  `,
  LOADING,
  /* js */ `
function render(d) {
  const o = d.order, b = d.budget || {};
  const who = String(d.household || "").replace(/[’']s house$/, "");
  let h = '<div class="head"><div><h1>' + (!o ? "Nothing to order right now" : o.status === "draft" ? "Refill order for " + esc(who) : "Order placed") + '</h1><div class="sub">' + esc(d.retailer) + (o ? " · " + esc(o.id) : "") + (o && o.eta ? " · arrives " + esc(o.etaLabel) : o ? " · delivery in 2 days" : "") + "</div></div>" + (o && o.status !== "draft" ? '<div class="stamp">✓ Placed</div>' : "") + "</div>";
  if (o) {
    h += "<table>" + o.lines.map((l) => '<tr><td>' + esc(l.name) + '</td><td class="q">' + l.packs + " × pack</td><td class='p'>" + usd(l.price) + "</td></tr>").join("") + '<tr class="total"><td>Total</td><td></td><td class="p">' + usd(o.total) + "</td></tr></table>";
  }
  (d.skipped || []).forEach((s) => { h += '<div class="skip">Skipped ' + esc(s.name) + " — " + esc(s.reason) + "</div>"; });
  const pend = o && o.status === "draft" ? o.total : 0;
  const pctSpent = Math.min(100, (b.spent / b.monthly) * 100), pctPend = Math.min(100 - pctSpent, (pend / b.monthly) * 100);
  h += '<div class="budget"><div class="btrack"><div class="spent" style="width:' + pctSpent + '%"></div><div class="pend' + (b.withinBudget === false ? " over" : "") + '" style="width:' + pctPend + '%"></div></div><div class="blbl"><span>' + usd(b.spent) + " spent" + (pend ? " + " + usd(pend) + " this order" : "") + "</span><span>" + usd(b.monthly) + " monthly budget</span></div></div>";
  if (o && o.status === "draft") {
    h += '<div class="actions"><button class="primary" id="place"' + (b.withinBudget === false ? " disabled" : "") + ">" + (b.withinBudget === false ? "Over budget" : "Place order · " + usd(o.total)) + "</button></div>";
  }
  (d.rxDue || []).forEach((r) => {
    h += '<div class="rx"><h2>Prescription refill needs your OK</h2><div class="sub">' + esc(r.drug) + " " + esc(r.strength) + " · " + r.daysLeft + " days left · " + r.qty + " tablets as prescribed · " + usd(r.copay) + " copay</div>" +
      '<div class="row"><span class="sub">' + esc(r.pharmacy) + " · " + r.refillsLeft + ' refills left</span><button class="secondary" data-rx="' + esc(r.rxId) + '" data-drug="' + esc(r.drug) + '">Request refill</button></div><div class="lock">Quantity comes from the prescription. Refill never changes it.</div></div>';
  });
  (d.rxRequests || []).filter((r) => r.status !== "picked_up").forEach((r) => {
    h += '<div class="rx"><h2>Refill request sent</h2><div class="sub">' + esc(r.drug) + " · " + r.qty + " tablets · " + esc(r.pharmacy) + " · " + esc(r.status === "ready" ? "ready for pickup" : "pharmacy is filling it") + "</div></div>";
  });
  document.getElementById("root").innerHTML = h;
  const place = document.getElementById("place");
  if (place) place.onclick = () => { place.disabled = true; place.textContent = "Sent to Refill…"; say("Confirm order " + o.id + " for " + usd(o.total)); };
  document.querySelectorAll("button[data-rx]").forEach((btn) => { btn.onclick = () => { btn.disabled = true; btn.textContent = "Sent…"; say("Yes, request the " + btn.dataset.drug + " refill (" + btn.dataset.rx + ")"); }; });
}`,
);

const pharmacist = page(
  "refill-pharmacist",
  /* css */ `
  .wrap { display:flex; gap:14px; align-items:flex-start; }
  .icon { flex:none; width:46px; height:46px; border-radius:14px; background:#ece8fb; color:#4b3aa0; display:grid; place-items:center; font:600 24px Georgia, serif; }
  blockquote { margin:14px 0; padding:10px 14px; background:#fff; border-left:4px solid var(--rx); border-radius:0 10px 10px 0; font:16px/1.4 Georgia, serif; }
  .note { font-size:12.5px; color:#5b4bb0; background:#f3f0ff; border-radius:10px; padding:9px 12px; }
  .steps { display:flex; gap:8px; margin-top:12px; font-size:12px; color:var(--muted); } .steps span { background:#fff; border:1px solid var(--line); border-radius:999px; padding:3px 9px; }
  `,
  LOADING,
  /* js */ `
function render(d) {
  document.getElementById("root").innerHTML = '<div class="wrap"><div class="icon">℞</div><div><h1>Sent to the pharmacist</h1><div class="sub">' + esc(d.pharmacy) + " · ticket " + esc(d.ticket) + " · callback " + esc(d.expectedCallback) + '</div></div></div><blockquote>“' + esc(d.question) + '”</blockquote><div class="note">Refill doesn’t answer dosing or medical questions. A licensed pharmacist will call you back. For an emergency, call 911.</div><div class="steps"><span>✓ Question logged</span><span>✓ Pharmacy notified</span><span>Callback pending</span></div>';
}`,
);

const digest = page(
  "refill-digest",
  /* css */ `
  .head { display:flex; justify-content:space-between; align-items:flex-end; }
  .avatars { display:flex; } .av { width:32px; height:32px; border-radius:50%; display:grid; place-items:center; color:#fff; font-weight:700; font-size:13px; margin-left:-6px; border:2px solid var(--paper); }
  .cols { display:grid; grid-template-columns: 1.25fr 1fr; gap:14px; margin-top:12px; }
  .box { background:#fff; border:1px solid var(--line); border-radius:14px; padding:10px 12px; }
  .box h2 { margin:0 0 6px; font:600 12px "Segoe UI", sans-serif; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); }
  .ev { display:flex; gap:8px; font-size:13px; padding:4px 0; border-top:1px solid #f3eadc; } .ev:first-of-type { border-top:0; }
  .ev .d { color:var(--muted); width:74px; flex:none; font-size:12px; padding-top:1px; } .ev .k { flex:none; width:16px; text-align:center; }
  .up { display:flex; justify-content:space-between; font-size:13px; padding:3px 0; }
  .btrack { height:9px; border-radius:6px; background:#efe6d8; overflow:hidden; margin-top:4px; } .spent { height:100%; background:var(--teal); }
  .thanks { font:15px/1.35 Georgia, serif; }
  .sent { margin-top:12px; font-size:12.5px; color:var(--ok); font-weight:600; }
  `,
  LOADING,
  /* js */ `
function render(d) {
  const icon = { order: "🛒", delivery: "📦", rx: "℞", pharmacist: "☎", restock: "🧺", digest: "✉" };
  const colors = ["#1d5c58", "#c8431a", "#6a55c8", "#b7791f"];
  const av = (d.sentTo || []).map((p, i) => '<div class="av" style="background:' + colors[i % 4] + '" title="' + esc(p.name) + '">' + esc(p.name[0]) + "</div>").join("");
  const ev = (d.highlights || []).filter((e) => e.kind !== "digest").slice(-6).map((e) => '<div class="ev"><span class="d">' + esc(e.date) + '</span><span class="k">' + (icon[e.kind] || "•") + "</span><span>" + esc(e.text) + "</span></div>").join("") || '<div class="sub">A quiet week.</div>';
  const up = (d.upcoming || []).map((u) => '<div class="up"><span>' + esc(u.name) + '</span><span class="sub" style="margin:0">' + (u.covered ? "covered ✓" : u.daysLeft + "d · " + esc(u.runsOutLabel)) + "</span></div>").join("") || '<div class="sub">Nothing runs out this week.</div>';
  const b = d.budget || {};
  const thanks = (d.thanks || []).filter((t) => t.name !== "Maya").map((t) => esc(t.name)).join(" and ");
  document.getElementById("root").innerHTML =
    '<div class="head"><div><h1>' + esc(d.parent && d.parent.name) + '’s week</h1><div class="sub">Family digest · ' + esc(d.weekLabel) + '</div></div><div class="avatars">' + av + "</div></div>" +
    '<div class="cols"><div class="box"><h2>What happened</h2>' + ev + "</div><div>" +
    '<div class="box"><h2>Coming up</h2>' + up + "</div>" +
    '<div class="box" style="margin-top:10px"><h2>Budget</h2><div class="up"><span>' + usd(b.spent) + " of " + usd(b.monthly) + '</span><span class="sub" style="margin:0">' + usd(b.remaining) + ' left</span></div><div class="btrack"><div class="spent" style="width:' + Math.min(100, (b.spent / b.monthly) * 100) + '%"></div></div></div>' +
    (thanks ? '<div class="box" style="margin-top:10px"><h2>Thank you</h2><div class="thanks">' + thanks + " kept Dad covered this week.</div></div>" : "") +
    '</div></div><div class="sent">✓ Sent to ' + esc((d.sentTo || []).map((p) => p.name).join(", ")) + "</div>";
}`,
);

export interface AppResource {
  uri: string;
  title: string;
  description: string;
  html: string;
}

export const APPS: AppResource[] = [
  { uri: "ui://refill/running-low", title: "Running low timeline", description: "Days until each supply and prescription runs out, with order and refill status.", html: runningLow },
  { uri: "ui://refill/checkout", title: "Refill checkout", description: "Consolidated order with budget bar, caregiver confirmation, and prescription refill approval.", html: checkout },
  { uri: "ui://refill/pharmacist", title: "Pharmacist handoff", description: "Confirmation that a medication question went to a licensed pharmacist.", html: pharmacist },
  { uri: "ui://refill/digest", title: "Family digest", description: "Weekly summary sent to the family: deliveries, refills, budget, what's coming up.", html: digest },
];
