/**
 * arkAI adaptive layer (TypeScript mirror of api/adaptive.py):
 * circuit breaker + learning scoreboard.
 *
 * Circuit breaker (per warm instance): a model that fails 3 times in a row
 * is benched for 3 minutes so requests stop wasting time on it; a success
 * resets its record.
 *
 * Learning scoreboard: anonymous, aggregate-only counters per (intent,
 * model): thumbs up/down, regenerate-away events. NO prompts, NO answers,
 * NO user data are ever stored. The router nudges rankings by observed
 * win-rate. Counters live in memory and, when a hosted KV is configured
 * (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN), persist
 * server-side - nothing is ever written to the user's device.
 */

const env = (globalThis as any).process?.env || {};

// ------------------------------------------------------------ circuit breaker
const BENCH_SECONDS = 180;
const FAIL_THRESHOLD = 3;
const fails = new Map<string, { fails: number; benchedUntil: number }>();

export function isBenched(modelId: string): boolean {
  const rec = fails.get(modelId);
  return !!rec && rec.benchedUntil > Date.now() / 1000;
}

export function recordFailure(modelId: string): void {
  const rec = fails.get(modelId) || { fails: 0, benchedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= FAIL_THRESHOLD) {
    rec.benchedUntil = Date.now() / 1000 + BENCH_SECONDS;
    rec.fails = 0;
  }
  fails.set(modelId, rec);
}

export function recordSuccess(modelId: string): void {
  fails.delete(modelId);
}

export function breakerSnapshot(): Record<string, { benched_for_s: number }> {
  const now = Date.now() / 1000;
  const out: Record<string, { benched_for_s: number }> = {};
  for (const [m, r] of fails) {
    if (r.benchedUntil > now) out[m] = { benched_for_s: Math.max(0, Math.floor(r.benchedUntil - now)) };
  }
  return out;
}

// ------------------------------------------------------------ scoreboard
type ScoreRec = { up: number; down: number; regen: number };
const scores = new Map<string, ScoreRec>();
const KV_URL: string = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '';
const KV_TOKEN: string = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';
const KV_KEY = 'arkai:scoreboard:v1';
let kvLoaded = false;
let feedbackCount = 0;

const key = (intent: string, model: string) => `${intent}::${model}`;

export function learningEnabled(): boolean { return true; }
export function kvConfigured(): boolean { return !!(KV_URL && KV_TOKEN); }

async function kvLoadOnce(): Promise<void> {
  if (kvLoaded || !kvConfigured()) return;
  kvLoaded = true;
  try {
    const resp = await fetch(`${KV_URL}/get/${KV_KEY}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
    const data: any = await resp.json().catch(() => null);
    const raw = data?.result;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries<any>(parsed)) {
          if (v && typeof v === 'object') {
            scores.set(k, { up: Number(v.up || 0), down: Number(v.down || 0), regen: Number(v.regen || 0) });
          }
        }
      }
    }
  } catch { /* best-effort */ }
}

async function kvSave(): Promise<void> {
  if (!kvConfigured()) return;
  try {
    const snapshot = JSON.stringify(Object.fromEntries(scores));
    await fetch(`${KV_URL}/set/${KV_KEY}`, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}` }, body: snapshot });
  } catch { /* best-effort */ }
}

/** event: 'up' | 'down' | 'regen' (user regenerated away from this model). */
export async function recordFeedback(intent: string, model: string, event: string): Promise<ScoreRec | Record<string, never>> {
  await kvLoadOnce();
  const field = ({ up: 'up', down: 'down', regen: 'regen', regenerate: 'regen' } as Record<string, string>)[event];
  if (!model || !field) return {};
  const k = key(intent || 'general', model);
  const rec = scores.get(k) || { up: 0, down: 0, regen: 0 };
  (rec as any)[field] = (rec as any)[field] + 1;
  scores.set(k, rec);
  feedbackCount += 1;
  if (kvConfigured() && feedbackCount % 3 === 0) await kvSave();
  return { ...rec };
}

export function winrate(intent: string, model: string): number {
  const rec = scores.get(key(intent || 'general', model));
  if (!rec) return 0.5;
  const up = rec.up;
  const down = rec.down + rec.regen;
  return (up + 1) / (up + down + 2);
}

export function applyLearning<T extends { id: string }>(intent: string, orderedModels: T[]): T[] {
  if (!orderedModels.length) return orderedModels;
  return orderedModels
    .map((m, idx) => ({ k: idx - (winrate(intent, m.id) - 0.5) * 2 * 1.2, idx, m }))
    .sort((a, b) => a.k - b.k || a.idx - b.idx)
    .map(t => t.m);
}

export function scoreboardSnapshot(): { entries: number; scores: Record<string, ScoreRec>; kv_persistence: boolean } {
  return { entries: scores.size, scores: Object.fromEntries(scores), kv_persistence: kvConfigured() };
}
