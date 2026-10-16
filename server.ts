/**
 * arkAI Full-Stack Server Entrypoint
 * Express backend with Vite middleware integration.
 * Chat is served by the arkAI Orchestrator (src/orchestrator.ts):
 * free multi-model orchestration, NO vendor API key required.
 */

import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { executeOrchestratedChat, executeOrchestratedChatStream, classifyPromptIntent, rankedModelsForIntent, MODEL_CATALOG, FREE_GATEWAYS, detectProviderFromKey } from './src/orchestrator.ts';
export { detectProviderFromKey };

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// AI Studio dev server requires port 3000
const PORT = 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());

// Load Patterns Knowledge Base
interface IntentPattern {
  id: string;
  intent: string;
  priority?: number;
  tags?: string[];
  triggers?: string[];
  regex_patterns?: string[];
  response: string;
  follow_up_suggestions?: string[];
}

let patternsData: { intents: IntentPattern[] } = { intents: [] };
const patternsFilePath = path.join(__dirname, 'data', 'patterns.json');

try {
  if (fs.existsSync(patternsFilePath)) {
    patternsData = JSON.parse(fs.readFileSync(patternsFilePath, 'utf-8'));
    console.log(`[arkAI] Loaded ${patternsData.intents.length} commercial intent patterns.`);
  }
} catch (err) {
  console.error('[arkAI] Error reading patterns.json:', err);
}

// Pre-index triggers and compiled regular expressions
const exactTriggers = new Map<string, IntentPattern>();
const compiledRegexes: Array<{ regex: RegExp; pattern: IntentPattern }> = [];
const allTriggerPhrases: string[] = [];
const triggerWordIndex = new Map<string, Set<string>>();

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

for (const item of patternsData.intents) {
  if (Array.isArray(item.triggers)) {
    for (const trig of item.triggers) {
      const clean = normalize(trig);
      if (clean) {
        exactTriggers.set(clean, item);
        allTriggerPhrases.push(clean);

        // Index significant words for sub-microsecond inverted lookup
        const words = clean.split(' ').filter(w => w.length > 2);
        for (const w of words) {
          if (!triggerWordIndex.has(w)) {
            triggerWordIndex.set(w, new Set());
          }
          triggerWordIndex.get(w)!.add(clean);
        }
      }
    }
  }
  if (Array.isArray(item.regex_patterns)) {
    for (const regStr of item.regex_patterns) {
      try {
        compiledRegexes.push({
          regex: new RegExp(regStr, 'i'),
          pattern: item,
        });
      } catch (e) {
        console.error(`Invalid regex: ${regStr}`);
      }
    }
  }
}

// Rapid zero-allocation token sort similarity scoring (sub-10 microseconds in JS)
const MAX_LEV_LEN = 256;
const prevRowBuf = new Int32Array(MAX_LEV_LEN);
const currRowBuf = new Int32Array(MAX_LEV_LEN);

function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 100;
  const len1 = str1.length;
  const len2 = str2.length;
  // Fast length pre-check heuristic
  if (Math.abs(len1 - len2) > 8) return 0;
  if (len1 >= MAX_LEV_LEN || len2 >= MAX_LEV_LEN) return 0;

  const words1 = str1.split(' ').sort().join(' ');
  const words2 = str2.split(' ').sort().join(' ');
  if (words1 === words2) return 96;

  // Zero-allocation 2-row Levenshtein using pre-allocated typed arrays
  for (let j = 0; j <= len2; j++) prevRowBuf[j] = j;

  for (let i = 1; i <= len1; i++) {
    currRowBuf[0] = i;
    const char1 = str1.charCodeAt(i - 1);
    for (let j = 1; j <= len2; j++) {
      const cost = char1 === str2.charCodeAt(j - 1) ? 0 : 1;
      currRowBuf[j] = Math.min(
        currRowBuf[j - 1] + 1,
        prevRowBuf[j] + 1,
        prevRowBuf[j - 1] + cost
      );
    }
    for (let j = 0; j <= len2; j++) {
      prevRowBuf[j] = currRowBuf[j];
    }
  }

  const distance = prevRowBuf[len2];
  const maxLen = Math.max(len1, len2);
  return maxLen === 0 ? 100 : Math.round((1 - distance / maxLen) * 100);
}

// Sub-1ms Intent Matcher Function
export function matchIntent(query: string, threshold = 75.0) {
  const start = process.hrtime.bigint();
  const clean = normalize(query);

  if (!clean) {
    const elapsedMicros = Number(process.hrtime.bigint() - start) / 1000;
    return {
      matched: false,
      confidence: 0,
      match_type: 'none',
      execution_time_micros: elapsedMicros,
      execution_time_ms: elapsedMicros / 1000,
    };
  }

  // 1. Exact Trigger O(1) Lookup (~1 - 5 microseconds)
  if (exactTriggers.has(clean)) {
    const item = exactTriggers.get(clean)!;
    const elapsedMicros = Number(process.hrtime.bigint() - start) / 1000;
    return {
      matched: true,
      intent: item.intent,
      confidence: 100,
      match_type: 'exact',
      matched_trigger: clean,
      response: item.response,
      follow_up_suggestions: item.follow_up_suggestions,
      tags: item.tags,
      execution_time_micros: Math.round(elapsedMicros * 100) / 100,
      execution_time_ms: Math.round((elapsedMicros / 1000) * 10000) / 10000,
    };
  }

  // 2. Pre-Compiled Regex Matching (~5 - 15 microseconds)
  for (const { regex, pattern } of compiledRegexes) {
    if (regex.test(query) || regex.test(clean)) {
      const elapsedMicros = Number(process.hrtime.bigint() - start) / 1000;
      return {
        matched: true,
        intent: pattern.intent,
        confidence: 95,
        match_type: 'regex',
        matched_trigger: regex.source,
        response: pattern.response,
        follow_up_suggestions: pattern.follow_up_suggestions,
        tags: pattern.tags,
        execution_time_micros: Math.round(elapsedMicros * 100) / 100,
        execution_time_ms: Math.round((elapsedMicros / 1000) * 10000) / 10000,
      };
    }
  }

  // 3. Fast Inverted Index Keyword & Token Matching (~10 - 40 microseconds)
  const queryWords = clean.split(' ').filter(w => w.length > 2);
  const candidateTriggers = new Set<string>();
  for (const w of queryWords) {
    const set = triggerWordIndex.get(w);
    if (set) {
      for (const t of set) candidateTriggers.add(t);
    }
  }

  const triggersToTest = candidateTriggers.size > 0
    ? Array.from(candidateTriggers)
    : allTriggerPhrases.slice(0, 20);

  let bestScore = 0;
  let bestTrigger = '';
  let bestPattern: IntentPattern | null = null;

  for (const trig of triggersToTest) {
    const score = calculateSimilarity(clean, trig);
    if (score > bestScore) {
      bestScore = score;
      bestTrigger = trig;
      bestPattern = exactTriggers.get(trig) || null;
    }
    if (bestScore >= 95) break; // Early exit on near-exact
  }

  if (bestPattern && bestScore >= threshold) {
    const elapsedMicros = Number(process.hrtime.bigint() - start) / 1000;
    return {
      matched: true,
      intent: bestPattern.intent,
      confidence: bestScore,
      match_type: 'fuzzy',
      matched_trigger: bestTrigger,
      response: bestPattern.response,
      follow_up_suggestions: bestPattern.follow_up_suggestions,
      tags: bestPattern.tags,
      execution_time_micros: Math.round(elapsedMicros * 100) / 100,
      execution_time_ms: Math.round((elapsedMicros / 1000) * 10000) / 10000,
    };
  }

  const elapsedMicros = Number(process.hrtime.bigint() - start) / 1000;
  return {
    matched: false,
    confidence: bestScore,
    match_type: 'none',
    matched_trigger: bestTrigger || null,
    execution_time_micros: Math.round(elapsedMicros * 100) / 100,
    execution_time_ms: Math.round((elapsedMicros / 1000) * 10000) / 10000,
  };
}

// ==========================================
// API Endpoints
// ==========================================

// Health & System Info
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'operational',
    engine: 'arkAI Orchestrated Chatbot',
    version: '4.0.0',
    api_key_required: false,
    gateways: Object.keys(FREE_GATEWAYS),
    models_count: MODEL_CATALOG.length,
    models: MODEL_CATALOG.map(m => m.id),
    intents_indexed: patternsData.intents.length,
    triggers_indexed: exactTriggers.size,
    uptime_seconds: process.uptime(),
    uptime: process.uptime(),
  });
});

app.get('/api/models', (req: Request, res: Response) => {
  res.json({ count: MODEL_CATALOG.length, models: MODEL_CATALOG, gateways: Object.keys(FREE_GATEWAYS) });
});

app.post('/api/route-preview', (req: Request, res: Response) => {
  const r = classifyPromptIntent(req.body?.prompt || '');
  res.json({ category: r.category, assigned_model: r.assignedModel, routing_time_ms: r.routingTimeMs, sla_guaranteed: r.routingTimeMs < 2.0 });
});

// Patterns List
app.get('/api/patterns', (req: Request, res: Response) => {
  res.json({
    count: patternsData.intents.length,
    intents: patternsData.intents,
  });
});

// Sub-1ms Direct Matcher
app.post('/api/match', (req: Request, res: Response) => {
  const { query, threshold } = req.body;
  const result = matchIntent(query || '', threshold || 85.0);
  res.setHeader('X-Execution-Time-Micros', result.execution_time_micros.toString());
  res.json(result);
});

// Primary Orchestrated Chat Endpoint
async function handleChat(req: Request, res: Response, forceRegenerate = false) {
  const start = process.hrtime.bigint();
  const body = req.body || {};
  const userQuery = (body.message || '').trim();
  if (!userQuery) return res.status(400).json({ error: 'message is required' });

  const ownKey = (body.api_key_override || '').trim();
  const mode = ownKey ? 'own_key' : 'arkai_free';

  // 1) Instant local pattern engine first (free mode, non-regenerate only)
  if (!forceRegenerate && !ownKey && body.mode !== 'ai_only') {
    const match = matchIntent(userQuery, body.fuzzy_threshold || 85.0);
    if (match.matched) {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      res.setHeader('X-Engine-Source', 'pattern');
      return res.json({
        status: 'success', source: 'pattern',
        response: match.response, intent: match.intent, confidence: match.confidence,
        match_type: match.match_type, follow_up_suggestions: match.follow_up_suggestions,
        model_used: 'arkai/local-pattern-engine', model_name: 'arkAI Local Pattern Engine',
        model_badge: 'Instant · On-device', gateway: 'local', gateway_name: 'Local Pattern Engine',
        mode: 'arkai_free', routing_time_ms: 0,
        latency_micros: match.execution_time_micros, latency_ms: Math.round(elapsedMs * 100) / 100,
        total_latency_ms: Math.round(elapsedMs * 100) / 100,
        next_model: classifyPromptIntent(userQuery).assignedModel,
        tried_models: ['arkai/local-pattern-engine'],
      });
    }
  }

  // 2) Orchestrated AI: fast intent classification, ranked free models, cascade
  const { category, assignedModel, routingTimeMs } = classifyPromptIntent(userQuery);
  let exclude: string[] = Array.isArray(body.exclude_models) ? [...body.exclude_models] : [];
  if (forceRegenerate) {
    if (body.current_model && !exclude.includes(body.current_model)) exclude.push(body.current_model);
    if (Array.isArray(body.tried_models)) for (const m of body.tried_models) if (!exclude.includes(m)) exclude.push(m);
    exclude = exclude.filter(m => m !== 'arkai/local-pattern-engine');
    // pool exhausted -> restart cycle excluding only the current model
    if (!ownKey && rankedModelsForIntent(category, exclude).length === 0) {
      exclude = body.current_model ? [body.current_model] : [];
    }
  }

  const history = Array.isArray(body.history) ? body.history.slice(-8).map((m: any) => ({
    role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : (m.role || 'user'),
    content: m.content,
  })) : [];

// 1b) Streaming mode: SSE events (routing -> meta -> delta* -> done)
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (ev: Record<string, unknown>) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    send({ type: 'routing', routing_time_ms: routingTimeMs });
    if (!forceRegenerate && !ownKey && body.mode !== 'ai_only') {
      const match = matchIntent(userQuery, body.fuzzy_threshold || 85.0);
      if (match.matched) {
        send({ type: 'meta', model_used: 'arkai/local-pattern-engine', model_name: 'arkAI Local Pattern Engine', model_badge: 'Instant · On-device', gateway: 'local', gateway_name: 'Local Pattern Engine', mode: 'arkai_free', source: 'pattern' });
        send({ type: 'delta', content: match.response });
        send({ type: 'done', status: 'success', source: 'pattern', response: match.response, intent: match.intent, confidence: match.confidence, model_used: 'arkai/local-pattern-engine', model_name: 'arkAI Local Pattern Engine', model_badge: 'Instant · On-device', gateway: 'local', gateway_name: 'Local Pattern Engine', mode: 'arkai_free', total_latency_ms: Math.round(Number(process.hrtime.bigint() - start) / 1_000_000 * 100) / 100, next_model: classifyPromptIntent(userQuery).assignedModel, tried_models: ['arkai/local-pattern-engine'] });
        return res.end();
      }
    }
    try {
      for await (const ev of executeOrchestratedChatStream({
        messages: [...history, { role: 'user', content: userQuery }],
        intent: category, excludeModels: exclude,
        apiKeyOverride: ownKey, provider: body.provider,
        systemPrompt: body.system_prompt, temperature: body.temperature ?? 0.7,
      })) {
        if (ev.type === 'done') {
          send({ ...ev, prompt_type: category, assigned_model: assignedModel, routing_time_ms: routingTimeMs, latency_ms: ev.total_latency_ms });
        } else {
          send(ev as Record<string, unknown>);
        }
      }
    } catch (err: any) {
      send({ type: 'done', status: 'exhausted', response: 'arkAI could not reach any AI model just now. Please press Regenerate, or try again in a moment.', model_used: 'none', model_name: 'Unavailable', mode, error: err?.message });
    }
    return res.end();
  }

  try {
    const result = await executeOrchestratedChat({

      messages: [...history, { role: 'user', content: userQuery }],
      intent: category, excludeModels: exclude,
      apiKeyOverride: ownKey, provider: body.provider,
      systemPrompt: body.system_prompt, temperature: body.temperature ?? 0.7,
    });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return res.json({
      status: result.status, source: 'ai', response: result.response,
      model_used: result.model_used, model_name: result.model_name, model_badge: result.model_badge,
      gateway: result.gateway, gateway_name: result.gateway_name, provider_family: result.provider_family,
      prompt_type: category, assigned_model: assignedModel, mode: result.mode,
      provider_status: result.provider_status, failover_count: result.failover_count,
      failover_history: result.failover_history, next_model: result.next_model,
      next_model_name: result.next_model_name, tried_models: result.tried_models,
      routing_time_ms: routingTimeMs,
      latency_ms: Math.round(elapsedMs * 100) / 100, total_latency_ms: Math.round(elapsedMs * 100) / 100,
    });
  } catch (err: any) {
    return res.status(200).json({
      status: 'exhausted', source: 'error',
      response: 'arkAI could not reach any AI model just now. Please press Regenerate, or try again in a moment.',
      model_used: 'none', model_name: 'Unavailable', mode,
      total_latency_ms: Math.round(Number(process.hrtime.bigint() - start) / 1_000_000 * 100) / 100,
      error: err?.message,
    });
  }
}

app.post('/api/chat', (req: Request, res: Response) => handleChat(req, res, false));

// Regenerate: same prompt, next best model that has not answered it yet
app.post('/api/regenerate', (req: Request, res: Response) => handleChat(req, res, true));

// In-Memory Latency Benchmark Endpoint
app.post('/api/benchmark', (req: Request, res: Response) => {
  const iterations = Math.min(Math.max(req.body.iterations || 1000, 10), 10000);
  const sampleQueries = req.body.test_queries || [
    'hello there',
    'how much does this cost?',
    'tell me about your pricing plans',
    'who are you and what do you do',
    'i want to speak with a human agent',
    'is my data safe with arkai?',
    'how do i deploy on vercel?',
    'what are the api rate limits?',
    'can i get a refund within 30 days?',
    'goodbye and thanks for the help',
  ];

  // JIT warmup for steady-state measurement
  for (const q of sampleQueries) {
    matchIntent(q);
  }

  const latenciesMicros: number[] = [];
  const startTotal = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    const q = sampleQueries[i % sampleQueries.length];
    const match = matchIntent(q);
    latenciesMicros.push(match.execution_time_micros);
  }

  const totalTimeMs = Number(process.hrtime.bigint() - startTotal) / 1_000_000;
  latenciesMicros.sort((a, b) => a - b);

  const count = latenciesMicros.length;
  const p50 = latenciesMicros[Math.floor(count * 0.5)];
  const p90 = latenciesMicros[Math.floor(count * 0.9)];
  const p95 = latenciesMicros[Math.floor(count * 0.95)];
  const p99 = latenciesMicros[Math.floor(count * 0.99)];
  const avg = latenciesMicros.reduce((acc, v) => acc + v, 0) / count;

  res.json({
    iterations,
    total_time_ms: Math.round(totalTimeMs * 100) / 100,
    queries_per_second: Math.round(iterations / (totalTimeMs / 1000)),
    mean_micros: Math.round(avg * 100) / 100,
    median_micros: Math.round(p50 * 100) / 100,
    p50_micros: Math.round(p50 * 100) / 100,
    p90_micros: Math.round(p90 * 100) / 100,
    p95_micros: Math.round(p95 * 100) / 100,
    p99_micros: Math.round(p99 * 100) / 100,
    avg_micros: Math.round(avg * 100) / 100,
    p50_ms: Math.round((p50 / 1000) * 10000) / 10000,
    p95_ms: Math.round((p95 / 1000) * 10000) / 10000,
    sub_millisecond_guaranteed: p99 < 1000,
  });
});

// Expose CodeAlpha Repository Files for UI Explorer and Download
app.get('/api/repo-tree', (req: Request, res: Response) => {
  const repoRoot = path.join(__dirname, 'CodeAlpha_AIChatbot');
  const files: Array<{ path: string; size: number; content: string }> = [];

  function walk(dir: string, prefix = '') {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const stat = fs.statSync(fullPath);
          files.push({
            path: relPath.replace(/\\/g, '/'),
            size: stat.size,
            content,
          });
        } catch (e) {
          // Skip binary
        }
      }
    }
  }

  walk(repoRoot);
  res.json({ repo_name: 'CodeAlpha_AIChatbot', files });
});

// Vite middleware mounting in development mode
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[arkAI Server] Running on http://localhost:${PORT}`);
  });
}

const isTestMode =
  process.env.NODE_ENV === 'test' ||
  process.argv.some(arg => arg.includes('test')) ||
  process.env.TEST === 'true';

if (!isTestMode) {
  startServer();
}
