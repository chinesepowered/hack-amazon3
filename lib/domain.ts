// Refill household model and every business rule that matters: run-out prediction, order sizing,
// budget, duplicate prevention, prescription refill requests, and the weekly digest.
// Pure functions over a plain JSON object so the MCP server stays stateless.

export type Category = "grocery" | "supplies" | "otc" | "rx";

export interface Item {
  id: string;
  name: string;
  detail: string;
  category: Category;
  onHand: number;
  unit: string;
  dailyUse: number;
  packSize: number;
  packPrice: number;
}

export interface Rx {
  id: string;
  itemId: string;
  drug: string;
  strength: string;
  qtyPerFill: number;
  refillsLeft: number;
  copay: number;
}

export interface OrderLine {
  itemId: string;
  name: string;
  packs: number;
  units: number;
  price: number;
}

export interface Order {
  id: string;
  status: "draft" | "placed" | "delivered";
  createdOn: string;
  placedOn?: string;
  eta?: string;
  lines: OrderLine[];
  total: number;
}

export interface RxRequest {
  id: string;
  rxId: string;
  drug: string;
  qty: number;
  status: "sent" | "ready" | "picked_up";
  sentOn: string;
  pickedUpBy?: string;
}

export interface PharmacistQuestion {
  id: string;
  question: string;
  askedOn: string;
  status: "sent" | "answered";
  answer?: string;
}

export interface LogEntry {
  date: string;
  kind: "order" | "delivery" | "rx" | "pharmacist" | "restock" | "digest";
  who: string;
  text: string;
}

export interface Household {
  v: 1;
  sub: string;
  today: string;
  seq: number;
  parent: { name: string; age: number; city: string };
  caregiver: { name: string; relation: string; city: string };
  family: { name: string; role: string }[];
  pharmacy: string;
  retailer: string;
  budget: { monthly: number; spent: number };
  items: Item[];
  rx: Rx[];
  orders: Order[];
  rxRequests: RxRequest[];
  questions: PharmacistQuestion[];
  log: LogEntry[];
  digestsSent: number;
}

export const CRITICAL_DAYS = 3;
export const LOW_DAYS = 7;
export const DEFAULT_COVER_DAYS = 14;
export const DEMO_START = "2026-09-14";

export class RuleError extends Error {
  constructor(public rule: string, message: string) {
    super(message);
  }
}

const money = (n: number) => Math.round(n * 100) / 100;

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function seedHousehold(sub: string): Household {
  return {
    v: 1,
    sub,
    today: DEMO_START,
    seq: 1,
    parent: { name: "Walter", age: 81, city: "Tucson, AZ" },
    caregiver: { name: "Maya", relation: "daughter", city: "Seattle, WA" },
    family: [
      { name: "Maya", role: "Daughter · primary caregiver · Seattle" },
      { name: "Dan", role: "Son · 12 minutes away" },
      { name: "Rosa", role: "Neighbor · checks in daily" },
    ],
    pharmacy: "Desert Bloom Pharmacy",
    retailer: "Corner Cart",
    budget: { monthly: 250, spent: 74.2 },
    items: [
      { id: "briefs", name: "Overnight briefs", detail: "Size L", category: "supplies", onHand: 9, unit: "briefs", dailyUse: 3, packSize: 18, packPrice: 21.99 },
      { id: "shakes", name: "Nutrition shakes", detail: "Vanilla, 8 oz", category: "grocery", onHand: 8, unit: "bottles", dailyUse: 2, packSize: 12, packPrice: 17.49 },
      { id: "lisinopril", name: "Lisinopril 10 mg", detail: "Prescription", category: "rx", onHand: 5, unit: "tablets", dailyUse: 1, packSize: 90, packPrice: 0 },
      { id: "gloves", name: "Nitrile gloves", detail: "Medium", category: "supplies", onHand: 22, unit: "gloves", dailyUse: 4, packSize: 100, packPrice: 12.99 },
      { id: "oatmeal", name: "Oatmeal cups", detail: "Low sugar", category: "grocery", onHand: 6, unit: "cups", dailyUse: 1, packSize: 10, packPrice: 7.99 },
      { id: "underpads", name: "Bed underpads", detail: "Disposable", category: "supplies", onHand: 20, unit: "pads", dailyUse: 2, packSize: 30, packPrice: 19.99 },
      { id: "coffee", name: "Decaf coffee pods", detail: "Medium roast", category: "grocery", onHand: 33, unit: "pods", dailyUse: 3, packSize: 24, packPrice: 14.99 },
      { id: "fiber", name: "Fiber powder", detail: "Unflavored", category: "otc", onHand: 12, unit: "servings", dailyUse: 1, packSize: 30, packPrice: 11.49 },
      { id: "metformin", name: "Metformin 500 mg", detail: "Prescription", category: "rx", onHand: 42, unit: "tablets", dailyUse: 2, packSize: 180, packPrice: 0 },
    ],
    rx: [
      { id: "RX-40218", itemId: "lisinopril", drug: "Lisinopril", strength: "10 mg", qtyPerFill: 90, refillsLeft: 2, copay: 4 },
      { id: "RX-40233", itemId: "metformin", drug: "Metformin", strength: "500 mg", qtyPerFill: 180, refillsLeft: 3, copay: 6 },
    ],
    orders: [],
    rxRequests: [],
    questions: [],
    log: [
      { date: addDays(DEMO_START, -3), kind: "restock", who: "Dan", text: "Dan dropped off coffee pods and fiber powder" },
    ],
    digestsSent: 0,
  };
}

function nextId(h: Household, prefix: string): string {
  const id = `${prefix}-${String(h.seq).padStart(3, "0")}`;
  h.seq += 1;
  return id;
}

export function openOrderFor(h: Household, itemId: string): Order | undefined {
  return h.orders.find((o) => o.status === "placed" && o.lines.some((l) => l.itemId === itemId));
}

export function openRxRequest(h: Household, rxId: string): RxRequest | undefined {
  return h.rxRequests.find((r) => r.rxId === rxId && r.status !== "picked_up");
}

export function budgetView(h: Household, pending = 0) {
  const remaining = money(h.budget.monthly - h.budget.spent);
  return { monthly: h.budget.monthly, spent: money(h.budget.spent), remaining, pending: money(pending), withinBudget: pending <= remaining };
}

export function itemView(h: Household, item: Item) {
  const daysLeft = Math.floor(item.onHand / item.dailyUse);
  const status = daysLeft <= CRITICAL_DAYS ? "critical" : daysLeft <= LOW_DAYS ? "low" : "ok";
  const order = openOrderFor(h, item.id);
  const rx = h.rx.find((r) => r.itemId === item.id);
  const rxReq = rx ? openRxRequest(h, rx.id) : undefined;
  return {
    id: item.id,
    name: item.name,
    detail: item.detail,
    category: item.category,
    onHand: item.onHand,
    unit: item.unit,
    dailyUse: item.dailyUse,
    daysLeft,
    runsOut: addDays(h.today, daysLeft),
    runsOutLabel: dayLabel(addDays(h.today, daysLeft)),
    status,
    onOrder: order ? { orderId: order.id, eta: order.eta, etaLabel: order.eta ? dayLabel(order.eta) : undefined } : null,
    rx: rx ? { rxId: rx.id, refillsLeft: rx.refillsLeft, request: rxReq ? { id: rxReq.id, status: rxReq.status } : null } : null,
  };
}

export function statusReport(h: Household) {
  const items = h.items.map((i) => itemView(h, i)).sort((a, b) => a.daysLeft - b.daysLeft);
  const needsAction = items.filter((i) => i.status !== "ok" && !i.onOrder && !(i.rx && i.rx.request));
  return {
    kind: "status" as const,
    household: `${h.parent.name}'s house`,
    parent: h.parent,
    today: h.today,
    todayLabel: dayLabel(h.today),
    items,
    counts: {
      critical: needsAction.filter((i) => i.status === "critical").length,
      low: needsAction.filter((i) => i.status === "low").length,
      rxDue: needsAction.filter((i) => i.category === "rx").length,
      onOrder: items.filter((i) => i.onOrder).length,
    },
    budget: budgetView(h),
  };
}

function rxDue(h: Household) {
  return h.rx
    .filter((r) => {
      const item = h.items.find((i) => i.id === r.itemId)!;
      return Math.floor(item.onHand / item.dailyUse) <= LOW_DAYS && !openRxRequest(h, r.id);
    })
    .map((r) => {
      const item = h.items.find((i) => i.id === r.itemId)!;
      return { rxId: r.id, drug: r.drug, strength: r.strength, qty: r.qtyPerFill, copay: r.copay, refillsLeft: r.refillsLeft, daysLeft: Math.floor(item.onHand / item.dailyUse), pharmacy: h.pharmacy };
    });
}

export function orderView(h: Household, order: Order | undefined, skipped: { name: string; reason: string }[] = []) {
  return {
    kind: "order" as const,
    household: `${h.parent.name}'s house`,
    retailer: h.retailer,
    today: h.today,
    order: order ? { ...order, etaLabel: order.eta ? dayLabel(order.eta) : undefined } : null,
    skipped,
    budget: budgetView(h, order && order.status === "draft" ? order.total : 0),
    rxDue: rxDue(h),
    rxRequests: h.rxRequests.map((r) => ({ ...r, pharmacy: h.pharmacy })),
  };
}

export function draftOrder(h: Household, coverDays = DEFAULT_COVER_DAYS, excludeItemIds: string[] = []) {
  h.orders = h.orders.filter((o) => o.status !== "draft");
  const lines: OrderLine[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const item of h.items) {
    if (item.category === "rx") continue;
    const daysLeft = Math.floor(item.onHand / item.dailyUse);
    if (daysLeft > LOW_DAYS) continue;
    const open = openOrderFor(h, item.id);
    if (open) {
      skipped.push({ name: item.name, reason: `already on ${open.id}, arriving ${dayLabel(open.eta!)}` });
      continue;
    }
    if (excludeItemIds.includes(item.id)) {
      skipped.push({ name: item.name, reason: "left off at your request" });
      continue;
    }
    const need = Math.max(0, item.dailyUse * coverDays - item.onHand);
    const packs = Math.max(1, Math.ceil(need / item.packSize));
    lines.push({ itemId: item.id, name: `${item.name} (${item.detail})`, packs, units: packs * item.packSize, price: money(packs * item.packPrice) });
  }
  if (lines.length === 0) {
    return orderView(h, undefined, skipped);
  }
  const order: Order = { id: nextId(h, "ORD"), status: "draft", createdOn: h.today, lines, total: money(lines.reduce((s, l) => s + l.price, 0)) };
  h.orders.push(order);
  return orderView(h, order, skipped);
}

export function placeOrder(h: Household, orderId: string) {
  const order = h.orders.find((o) => o.id === orderId);
  if (!order) throw new RuleError("order-exists", `No order ${orderId}. Draft one with draft_refill_order first.`);
  if (order.status !== "draft") throw new RuleError("duplicate-order", `${orderId} was already placed on ${order.placedOn}. Not ordering it twice.`);
  const dup = order.lines.find((l) => openOrderFor(h, l.itemId));
  if (dup) throw new RuleError("duplicate-order", `${dup.name} is already on an open order. Re-draft the order.`);
  const remaining = h.budget.monthly - h.budget.spent;
  if (order.total > remaining) throw new RuleError("budget-cap", `Order total $${order.total.toFixed(2)} exceeds the $${remaining.toFixed(2)} left in this month's budget.`);
  order.status = "placed";
  order.placedOn = h.today;
  order.eta = addDays(h.today, 2);
  h.budget.spent = money(h.budget.spent + order.total);
  h.log.push({ date: h.today, kind: "order", who: h.caregiver.name, text: `${h.caregiver.name} approved ${order.id} from ${h.retailer} ($${order.total.toFixed(2)})` });
  return orderView(h, order);
}

export function requestRefill(h: Household, rxId: string) {
  const rx = h.rx.find((r) => r.id === rxId || r.drug.toLowerCase() === rxId.toLowerCase());
  if (!rx) throw new RuleError("rx-exists", `No prescription ${rxId} on file.`);
  if (openRxRequest(h, rx.id)) throw new RuleError("duplicate-order", `A refill request for ${rx.drug} is already open.`);
  if (rx.refillsLeft <= 0) throw new RuleError("rx-refills", `${rx.drug} has no refills left. Ask the prescriber for a new prescription.`);
  const req: RxRequest = { id: nextId(h, "REQ"), rxId: rx.id, drug: `${rx.drug} ${rx.strength}`, qty: rx.qtyPerFill, status: "sent", sentOn: h.today };
  rx.refillsLeft -= 1;
  h.rxRequests.push(req);
  h.log.push({ date: h.today, kind: "rx", who: h.caregiver.name, text: `Refill request for ${req.drug} (${req.qty} tablets) sent to ${h.pharmacy}` });
  const order = h.orders.filter((o) => o.status !== "delivered").at(-1);
  return orderView(h, order);
}

export function askPharmacist(h: Household, question: string) {
  const q: PharmacistQuestion = { id: nextId(h, "Q"), question: question.slice(0, 280), askedOn: h.today, status: "sent" };
  h.questions.push(q);
  h.log.push({ date: h.today, kind: "pharmacist", who: h.caregiver.name, text: `Question sent to the pharmacist at ${h.pharmacy}` });
  return { kind: "pharmacist" as const, ticket: q.id, pharmacy: h.pharmacy, question: q.question, expectedCallback: "within 24 hours", note: "Refill does not give dosing or medical advice." };
}

export function updateSupply(h: Household, itemId: string, units: number, who: string) {
  const item = h.items.find((i) => i.id === itemId);
  if (!item) throw new RuleError("item-exists", `Unknown item ${itemId}.`);
  item.onHand = Math.max(0, item.onHand + units);
  h.log.push({ date: h.today, kind: "restock", who, text: `${who} ${units >= 0 ? "added" : "removed"} ${Math.abs(units)} ${item.unit} of ${item.name}` });
  return itemView(h, item);
}

export function simulateDays(h: Household, days: number) {
  for (let d = 0; d < days; d++) {
    h.today = addDays(h.today, 1);
    for (const item of h.items) item.onHand = Math.max(0, item.onHand - item.dailyUse);
    for (const o of h.orders) {
      if (o.status === "placed" && o.eta && o.eta <= h.today) {
        o.status = "delivered";
        for (const l of o.lines) {
          const item = h.items.find((i) => i.id === l.itemId);
          if (item) item.onHand += l.units;
        }
        h.log.push({ date: h.today, kind: "delivery", who: h.retailer, text: `${o.id} delivered to ${h.parent.name}'s porch (${o.lines.length} items)` });
      }
    }
    for (const r of h.rxRequests) {
      if (r.status === "ready") {
        r.status = "picked_up";
        r.pickedUpBy = "Dan";
        const rx = h.rx.find((x) => x.id === r.rxId);
        const item = rx && h.items.find((i) => i.id === rx.itemId);
        if (item) item.onHand += r.qty;
        h.log.push({ date: h.today, kind: "rx", who: "Dan", text: `Dan picked up ${r.drug} from ${h.pharmacy}` });
      } else if (r.status === "sent" && addDays(r.sentOn, 1) <= h.today) {
        r.status = "ready";
        h.log.push({ date: h.today, kind: "rx", who: h.pharmacy, text: `${r.drug} ready for pickup at ${h.pharmacy}` });
      }
    }
    for (const q of h.questions) {
      if (q.status === "sent" && addDays(q.askedOn, 1) <= h.today) {
        q.status = "answered";
        q.answer = `The pharmacist at ${h.pharmacy} called ${h.caregiver.name} back and reviewed the question with her.`;
        h.log.push({ date: h.today, kind: "pharmacist", who: h.pharmacy, text: `Pharmacist called ${h.caregiver.name} back` });
      }
    }
  }
  return statusReport(h);
}

export function buildDigest(h: Household) {
  const from = addDays(h.today, -7);
  const week = h.log.filter((e) => e.date > from && e.date <= h.today);
  const report = statusReport(h);
  const upcoming = report.items.filter((i) => i.daysLeft <= LOW_DAYS).map((i) => ({ name: i.name, daysLeft: i.daysLeft, runsOutLabel: i.runsOutLabel, covered: Boolean(i.onOrder || (i.rx && i.rx.request)) }));
  const helpers = new Map<string, number>();
  for (const e of week) if (h.family.some((f) => f.name === e.who)) helpers.set(e.who, (helpers.get(e.who) ?? 0) + 1);
  h.digestsSent += 1;
  h.log.push({ date: h.today, kind: "digest", who: "Refill", text: `Weekly digest sent to ${h.family.map((f) => f.name).join(", ")}` });
  return {
    kind: "digest" as const,
    household: `${h.parent.name}'s house`,
    parent: h.parent,
    weekLabel: `${dayLabel(addDays(from, 1))} – ${dayLabel(h.today)}`,
    highlights: week.map((e) => ({ date: dayLabel(e.date), kind: e.kind, who: e.who, text: e.text })),
    budget: budgetView(h),
    upcoming,
    thanks: [...helpers.entries()].map(([name, count]) => ({ name, count })),
    sentTo: h.family,
  };
}
