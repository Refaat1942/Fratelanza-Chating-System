/**
 * Bot flow engine — pure functions, no database and no sending. The live
 * runtime (bot-runtime.ts) and the "Test bot" simulator both use it, so what
 * an admin tests is exactly what customers get.
 *
 * A flow is a list of steps:
 *   - message:  says something, then continues to `next`
 *   - menu:     numbered options; each option can run actions and go somewhere
 *   - question: free-text answer saved to `saveTo` (name | email | custom:<key> | answer)
 */
import { normalizeText } from "./topics";

export type BotAction =
  | { type: "route_team"; teamId: number }
  | { type: "set_topic"; topicId: number }
  | { type: "tag"; tag: string }
  | { type: "handover" }
  | { type: "close" };

export interface BotOption { label: string; next?: string | null; actions?: BotAction[] }
export interface BotStep {
  key: string;
  kind: "message" | "menu" | "question";
  text: string;
  options?: BotOption[];
  saveTo?: string;
  next?: string | null;
}
export interface BotDef {
  welcomeMessage?: string | null;
  fallbackMessage?: string | null;
  handoverMessage?: string | null;
  completionMessage?: string | null;
  endAction: "handover" | "close";
  maxFallbacks: number;
  steps: BotStep[];
}
export interface BotState { stepKey: string | null; answers: Record<string, string>; fallbacks: number }
export type BotEnd = "completed" | "handed_over" | null;
export interface BotTurn {
  replies: string[];
  actions: BotAction[];
  /** Customer fields to save: name, email or custom:<key>. */
  saves: { field: string; value: string }[];
  state: BotState;
  end: BotEnd;
}

const HUMAN_WORDS = ["agent", "human", "person", "representative", "operator", "موظف", "خدمه العملاء", "خدمة العملاء", "مندوب", "حد يكلمني", "عايز اكلم حد"];

export function wantsHuman(input: string): boolean {
  const t = normalizeText(input);
  return HUMAN_WORDS.some((w) => {
    const n = normalizeText(w);
    return /^[a-z ]+$/.test(n) ? new RegExp(`(^|\\s)${n}(\\s|$)`).test(t) : t.includes(n);
  });
}

function stepByKey(def: BotDef, key: string | null | undefined): BotStep | undefined {
  return key ? def.steps.find((s) => s.key === key) : undefined;
}

/** The step after `s` when nothing else is said: explicit next, else the following step in the list. */
function defaultNext(def: BotDef, s: BotStep): string | null {
  if (s.next !== undefined) return s.next ?? null;
  const i = def.steps.findIndex((x) => x.key === s.key);
  return def.steps[i + 1]?.key ?? null;
}

export function renderStep(s: BotStep): string {
  if (s.kind !== "menu" || !s.options?.length) return s.text;
  return `${s.text}\n${s.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}`;
}

/** Walk from `key` through message steps until a step that waits for input (or the end). */
function enter(def: BotDef, key: string | null, turn: BotTurn): void {
  let guard = 0;
  let k = key;
  while (k && guard++ < 50) {
    const s = stepByKey(def, k);
    if (!s) { k = null; break; }
    turn.replies.push(renderStep(s));
    if (s.kind === "message") { k = defaultNext(def, s); continue; }
    turn.state.stepKey = s.key;
    return;
  }
  finish(def, turn, "flow");
}

/**
 * End the bot. "flow" = the steps ran out (or an option closes the chat): the
 * bot's end action applies. "human" = handover now (customer asked, too many
 * misunderstood answers, or an option says so).
 */
function finish(def: BotDef, turn: BotTurn, why: "flow" | "close" | "human"): void {
  turn.state.stepKey = null;
  const close = why === "close" || (why === "flow" && def.endAction === "close");
  if (close) {
    if (def.completionMessage) turn.replies.push(def.completionMessage);
    turn.actions.push({ type: "close" });
    turn.end = "completed";
  } else {
    const msg = why === "flow" ? def.completionMessage || def.handoverMessage : def.handoverMessage;
    if (msg) turn.replies.push(msg);
    turn.actions.push({ type: "handover" });
    turn.end = "handed_over";
  }
}

export function startBot(def: BotDef): BotTurn {
  const turn: BotTurn = { replies: [], actions: [], saves: [], state: { stepKey: null, answers: {}, fallbacks: 0 }, end: null };
  if (def.welcomeMessage) turn.replies.push(def.welcomeMessage);
  enter(def, def.steps[0]?.key ?? null, turn);
  return turn;
}

function matchOption(s: BotStep, input: string): number {
  const opts = s.options ?? [];
  const t = normalizeText(input).replace(/[.)\-]/g, " ").trim();
  // "1", "١", "option 2"
  const digits = t.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const num = /^(?:option\s*)?(\d{1,2})$/.exec(digits);
  if (num) { const i = Number(num[1]) - 1; return i >= 0 && i < opts.length ? i : -1; }
  const exact = opts.findIndex((o) => normalizeText(o.label) === t);
  if (exact >= 0) return exact;
  const partial = opts.findIndex((o) => { const l = normalizeText(o.label); return l.length >= 3 && (t.includes(l) || (t.length >= 3 && l.includes(t))); });
  return partial;
}

export function advanceBot(def: BotDef, state: BotState, input: string): BotTurn {
  const turn: BotTurn = { replies: [], actions: [], saves: [], state: { ...state, answers: { ...state.answers } }, end: null };
  if (wantsHuman(input)) { finish(def, turn, "human"); return turn; }
  const s = stepByKey(def, state.stepKey);
  if (!s) { finish(def, turn, "flow"); return turn; }

  if (s.kind === "menu") {
    const i = matchOption(s, input);
    if (i < 0) {
      turn.state.fallbacks += 1;
      if (turn.state.fallbacks > def.maxFallbacks) { finish(def, turn, "human"); return turn; }
      turn.replies.push(def.fallbackMessage || "Sorry, I didn't get that. Please reply with the number of an option.");
      turn.replies.push(renderStep(s));
      return turn;
    }
    const o = s.options![i]!;
    turn.state.fallbacks = 0;
    turn.state.answers[s.key] = o.label;
    for (const a of o.actions ?? []) if (a.type !== "handover" && a.type !== "close") turn.actions.push(a);
    if (o.actions?.some((a) => a.type === "handover")) { finish(def, turn, "human"); return turn; }
    if (o.actions?.some((a) => a.type === "close")) { finish(def, turn, "close"); return turn; }
    enter(def, o.next !== undefined ? o.next ?? null : defaultNext(def, s), turn);
    return turn;
  }

  // question
  const answer = input.trim().slice(0, 500);
  if (!answer) { turn.replies.push(renderStep(s)); return turn; }
  if (s.saveTo === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer)) {
    turn.state.fallbacks += 1;
    if (turn.state.fallbacks > def.maxFallbacks) { finish(def, turn, "human"); return turn; }
    turn.replies.push(def.fallbackMessage || "That doesn't look like an email address — please try again.");
    return turn;
  }
  turn.state.fallbacks = 0;
  turn.state.answers[s.key] = answer;
  if (s.saveTo && s.saveTo !== "answer") turn.saves.push({ field: s.saveTo, value: answer });
  enter(def, defaultNext(def, s), turn);
  return turn;
}

/** Problems that would make a flow misbehave (shown in the editor; blocks activation). */
export function validateFlow(steps: BotStep[], known: { teams: number[]; topics: number[] }): string[] {
  const errs: string[] = [];
  const keys = new Set<string>();
  if (!steps.length) errs.push("Add at least one step");
  for (const s of steps) {
    if (!s.key || !/^[\w-]{1,40}$/.test(s.key)) errs.push(`Step "${s.key}" needs a simple id (letters, digits, - or _)`);
    if (keys.has(s.key)) errs.push(`Two steps use the id "${s.key}"`);
    keys.add(s.key);
    if (!s.text?.trim()) errs.push(`Step "${s.key}" has no text`);
    if (s.kind === "menu" && !(s.options?.length)) errs.push(`Menu "${s.key}" has no options`);
    if ((s.options?.length ?? 0) > 10) errs.push(`Menu "${s.key}" has more than 10 options`);
  }
  for (const s of steps) {
    const targets = [s.next, ...(s.options ?? []).map((o) => o.next)].filter((x): x is string => typeof x === "string" && x !== "");
    for (const t of targets) if (!keys.has(t)) errs.push(`Step "${s.key}" points to a missing step "${t}"`);
    for (const o of s.options ?? []) {
      if (!o.label?.trim()) errs.push(`Menu "${s.key}" has an option without a label`);
      for (const a of o.actions ?? []) {
        if (a.type === "route_team" && !known.teams.includes(a.teamId)) errs.push(`Option "${o.label}" routes to a team that no longer exists`);
        if (a.type === "set_topic" && !known.topics.includes(a.topicId)) errs.push(`Option "${o.label}" sets a topic that no longer exists`);
      }
    }
    if (s.kind === "question" && s.saveTo && !/^(answer|name|email|custom:[\w]+)$/.test(s.saveTo)) errs.push(`Question "${s.key}" saves to an unknown field`);
  }
  return [...new Set(errs)];
}
