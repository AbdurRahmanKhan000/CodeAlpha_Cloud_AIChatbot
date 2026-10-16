/**
 * arkAI Orchestrator (TypeScript mirror of api/router.py + api/config.py)
 *
 * Default mode needs NO API key and does NOT depend on Gemini, OpenRouter
 * or any single vendor. A <2ms local heuristic classifier ranks logical
 * models per intent; the orchestrator calls free anonymous gateways
 * (Pollinations, LLM7) in ranked order and cascades on any failure.
 * Regenerate = re-run with excludeModels containing every model that has
 * already answered the prompt, so a *different* model answers.
 *
 * Own-Key mode: if the user supplies their own key, ONLY that provider's
 * models are used.
 */

export interface LogicalModel {
  id: string;
  gateway: string;
  upstreamModel: string;
  name: string;
  providerFamily: string;
  badge: string;
  strengths: string[];
}

export const FREE_GATEWAYS: Record<string, { name: string; endpoint: string; timeoutMs: number }> = {
  pollinations: { name: 'Pollinations', endpoint: 'https://text.pollinations.ai/openai', timeoutMs: 45000 },
  llm7: { name: 'LLM7', endpoint: 'https://api.llm7.io/v1/chat/completions', timeoutMs: 30000 },
};

export const MODEL_CATALOG: LogicalModel[] = [
  { id: 'pollinations/gpt-oss-20b', gateway: 'pollinations', upstreamModel: 'openai-fast', name: 'GPT-OSS 20B', providerFamily: 'OpenAI (open weights)', badge: 'Reasoning', strengths: ['math_logic', 'general', 'code', 'creative'] },
  { id: 'llm7/deepseek-v4-flash', gateway: 'llm7', upstreamModel: 'DeepSeek-V4-Flash-0731', name: 'DeepSeek V4 Flash', providerFamily: 'DeepSeek', badge: 'Deep Reasoning & Code', strengths: ['code', 'math_logic', 'general'] },
  { id: 'llm7/glm-5.3-flash', gateway: 'llm7', upstreamModel: 'GLM-5.3-Flash', name: 'GLM 5.3 Flash', providerFamily: 'Z.ai (GLM)', badge: 'Ultra-Fast', strengths: ['general', 'creative', 'code'] },
  { id: 'llm7/gpt-oss-20b', gateway: 'llm7', upstreamModel: 'gpt-oss:20b', name: 'GPT-OSS 20B (LLM7)', providerFamily: 'OpenAI (open weights)', badge: 'Reasoning', strengths: ['general', 'math_logic', 'creative'] },
];

export const MODEL_REGISTRY: Record<string, LogicalModel> = Object.fromEntries(MODEL_CATALOG.map(m => [m.id, m]));

export const INTENT_RANKINGS: Record<string, string[]> = {
  code: ['llm7/deepseek-v4-flash', 'pollinations/gpt-oss-20b', 'llm7/glm-5.3-flash', 'llm7/gpt-oss-20b'],
  math_logic: ['llm7/deepseek-v4-flash', 'pollinations/gpt-oss-20b', 'llm7/gpt-oss-20b', 'llm7/glm-5.3-flash'],
  creative: ['llm7/glm-5.3-flash', 'pollinations/gpt-oss-20b', 'llm7/gpt-oss-20b', 'llm7/deepseek-v4-flash'],
  general: ['pollinations/gpt-oss-20b', 'llm7/glm-5.3-flash', 'llm7/deepseek-v4-flash', 'llm7/gpt-oss-20b'],
};

export function rankedModelsForIntent(intent: string, exclude: string[] = []): LogicalModel[] {
  const ranking = INTENT_RANKINGS[intent] || INTENT_RANKINGS.general;
  const ordered = ranking.map(id => MODEL_REGISTRY[id]).filter(Boolean);
  for (const m of MODEL_CATALOG) if (!ranking.includes(m.id)) ordered.push(m);
  return ordered.filter(m => !exclude.includes(m.id));
}

// ------------------------------------------------------------ classifier
const CODE_RE = [/\b(def\s+\w+|function\s*\(|function\s+\w+|class\s+\w+|async\s+def|return\s+\S+)\b/i, /\b(python|javascript|typescript|react|vue|angular|node|express|fastapi|django|flask)\b/i, /\b(c\+\+|c#|golang|rust|java|kotlin|swift|php|ruby|scala|sql|nosql|postgres|mysql|sqlite)\b/i, /\b(html|css|tailwind|scss|json|yaml|xml|bash|shell|docker|kubernetes|git|github)\b/i, /\b(code|coding|script|algorithm|refactor|debug|compile|syntax|regex)\b/i, /\b(bug|error|exception|traceback|stacktrace|segfault|undefined|nullpointer|fix this code)\b/i, /\b(api|rest|graphql|sdk|endpoint|crud|webhook|npm|pip|cargo)\b/i, /```[\s\S]*?```/, /=>|===|!==|::/];
const MATH_RE = [/\b(math|mathematics|algebra|calculus|geometry|trigonometry|arithmetic|derivative|integral)\b/i, /\b(calculate|computation|solve|equation|formula|matrix|vector|probability|statistics|theorem)\b/i, /\b(logic|deduction|premise|syllogism|riddle|puzzle|proof|prove that)\b/i, /\b(step[- ]by[- ]step|reasoning|deep reasoning)\b/i, /[0-9]+\s*[\+\-\*\/\^%]\s*[0-9]+/, /\b(sqrt|pi|summation|infinity|factorial)\b/i];
const CREATIVE_RE = [/\b(essay|story|poem|poetry|novel|narrative|dialogue|screenplay)\b/i, /\b(email|letter|proposal|pitch|press release|memo|newsletter|cover letter|resume)\b/i, /\b(blog|article|content|copywriting|headline|slogan|marketing|social media post)\b/i, /\b(write a|compose|draft|brainstorm|rewrite|paraphrase|summarize|critique|rephrase)\b/i, /\b(creative|metaphor|analogy|persuasive)\b/i];

export function classifyPromptIntent(prompt: string): { category: string; assignedModel: string; routingTimeMs: number } {
  const start = process.hrtime.bigint();
  const text = (prompt || '').trim();
  const done = (category: string) => {
    const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
    const best = rankedModelsForIntent(category);
    return { category, assignedModel: best[0]?.id || MODEL_CATALOG[0].id, routingTimeMs: Math.round(ms * 1000) / 1000 };
  };
  if (!text) return done('general');
  if (CODE_RE.some(r => r.test(text))) return done('code');
  if (MATH_RE.some(r => r.test(text))) return done('math_logic');
  if (CREATIVE_RE.some(r => r.test(text))) return done('creative');
  return done('general');
}

// ------------------------------------------------------------ own-key mode
export const OWN_KEY_PROVIDERS: Record<string, { name: string; endpoint: string; models: string[] }> = {
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', models: ['gpt-4o-mini', 'gpt-4o'] },
  openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', models: ['deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'] },
  deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', models: ['deepseek-chat', 'deepseek-reasoner'] },
  grok: { name: 'xAI Grok', endpoint: 'https://api.x.ai/v1/chat/completions', models: ['grok-2', 'grok-2-mini'] },
  meta: { name: 'Meta LLaMA (Groq)', endpoint: 'https://api.groq.com/openai/v1/chat/completions', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  qwen: { name: 'Alibaba Qwen', endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', models: ['qwen-plus', 'qwen-turbo'] },
  gemini: { name: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: ['gemini-2.0-flash', 'gemini-1.5-flash'] },
  claude: { name: 'Anthropic Claude', endpoint: 'https://api.anthropic.com/v1/messages', models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'] },
};

export function detectProviderFromKey(key?: string, explicitProvider?: string): string {
  const explicit = (explicitProvider || '').toLowerCase().trim();
  if (explicit && OWN_KEY_PROVIDERS[explicit]) return explicit;
  const k = (key || '').trim();
  if (k.startsWith('sk-or-')) return 'openrouter';
  if (k.startsWith('sk-ant-')) return 'claude';
  if (k.startsWith('xai-')) return 'grok';
  if (k.startsWith('gsk_')) return 'meta';
  if (k.startsWith('AIza')) return 'gemini';
  return 'openai';
}

// ------------------------------------------------------------ transport
export interface ChatTurn { role: string; content: string }
export interface OrchestratorResult {
  response: string; model_used: string; model_name: string; model_badge: string;
  gateway: string; gateway_name: string; provider_family?: string;
  provider_status: string; status: string; mode: string;
  failover_count: number; failover_history: any[]; next_model: string | null;
  next_model_name?: string | null; tried_models: string[]; total_latency_ms: number;
}

async function postJson(url: string, payload: any, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; data: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload), signal: ctrl.signal });
    let data: any = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
  } finally { clearTimeout(t); }
}

function extractContent(data: any): string {
  return (data?.choices?.[0]?.message?.content || '').trim();
}
function errText(data: any, status: number): string {
  const e = data?.error;
  return (typeof e === 'string' ? e : e?.message || `HTTP ${status}`).slice(0, 160);
}

async function callOwnKey(provider: string, apiKey: string, messages: ChatTurn[], temperature: number, exclude: string[]): Promise<OrchestratorResult> {
  const spec = OWN_KEY_PROVIDERS[provider];
  const history: any[] = [];
  const overall = process.hrtime.bigint();
  for (const model of spec.models) {
    const logicalId = `ownkey/${provider}/${model}`;
    if (exclude.includes(logicalId) || exclude.includes(model)) continue;
    const start = process.hrtime.bigint();
    try {
      let status: number, data: any, content = '';
      if (provider === 'claude') {
        const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        const chat = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
        ({ status, data } = await postJson(spec.endpoint, { model, max_tokens: 4096, temperature, messages: chat, ...(sys ? { system: sys } : {}) }, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, 45000));
        content = (data?.content?.[0]?.text || '').trim();
      } else {
        ({ status, data } = await postJson(spec.endpoint, { model, messages, temperature }, { Authorization: `Bearer ${apiKey}` }, 45000));
        content = extractContent(data);
      }
      const latency = Math.round(Number(process.hrtime.bigint() - start) / 1_000_000 * 100) / 100;
      if (status === 200 && content) {
        const ranked = spec.models.map(m => `ownkey/${provider}/${m}`);
        const tried = [...exclude, logicalId];
        return { response: content, model_used: logicalId, model_name: model, model_badge: spec.name, gateway: provider, gateway_name: spec.name, provider_status: 'success', status: 'success', mode: 'own_key', failover_count: history.length, failover_history: history, next_model: ranked.find(m => !tried.includes(m)) || null, tried_models: tried, total_latency_ms: Math.round(Number(process.hrtime.bigint() - overall) / 1_000_000 * 100) / 100 };
      }
      history.push({ model: logicalId, status_code: status, latency_ms: latency, reason: errText(data, status) });
    } catch (e: any) {
      history.push({ model: logicalId, reason: String(e?.message || e) });
    }
  }
  return { response: "Your API key's provider did not return an answer. Check the key and provider in Settings, then try again.", model_used: `ownkey/${provider}`, model_name: spec.name, model_badge: spec.name, gateway: provider, gateway_name: spec.name, provider_status: 'exhausted', status: 'exhausted', mode: 'own_key', failover_count: history.length, failover_history: history, next_model: null, tried_models: exclude, total_latency_ms: Math.round(Number(process.hrtime.bigint() - overall) / 1_000_000 * 100) / 100 };
}

export async function executeOrchestratedChat(opts: {
  messages: ChatTurn[]; intent?: string; excludeModels?: string[];
  apiKeyOverride?: string; provider?: string; systemPrompt?: string; temperature?: number;
}): Promise<OrchestratorResult> {
  const overall = process.hrtime.bigint();
  const messages = [...opts.messages];
  if (opts.systemPrompt && messages[0]?.role !== 'system') messages.unshift({ role: 'system', content: opts.systemPrompt });
  const temperature = opts.temperature ?? 0.7;
  const exclude = opts.excludeModels || [];

  if ((opts.apiKeyOverride || '').trim()) {
    return callOwnKey(detectProviderFromKey(opts.apiKeyOverride, opts.provider), opts.apiKeyOverride!.trim(), messages, temperature, exclude);
  }

  const intent = opts.intent || 'general';
  const ranked = rankedModelsForIntent(intent, exclude);
  const history: any[] = [];
  for (const logical of ranked) {
    const gw = FREE_GATEWAYS[logical.gateway];
    const start = process.hrtime.bigint();
    try {
      const { status, data } = await postJson(gw.endpoint, { model: logical.upstreamModel, messages, temperature }, {}, gw.timeoutMs);
      const latency = Math.round(Number(process.hrtime.bigint() - start) / 1_000_000 * 100) / 100;
      const content = extractContent(data);
      if (status === 200 && content) {
        const tried = [...exclude, logical.id];
        const remaining = rankedModelsForIntent(intent, tried);
        return { response: content, model_used: logical.id, model_name: logical.name, model_badge: logical.badge, gateway: logical.gateway, gateway_name: gw.name, provider_family: logical.providerFamily, provider_status: 'success', status: 'success', mode: 'arkai_free', failover_count: history.length, failover_history: history, next_model: remaining[0]?.id || null, next_model_name: remaining[0]?.name || null, tried_models: tried, total_latency_ms: Math.round(Number(process.hrtime.bigint() - overall) / 1_000_000 * 100) / 100 };
      }
      history.push({ model: logical.id, gateway: logical.gateway, latency_ms: latency, reason: errText(data, status) });
    } catch (e: any) {
      history.push({ model: logical.id, gateway: logical.gateway, reason: String(e?.message || e) });
    }
  }
  return { response: 'All free AI gateways are busy right now. arkAI tried ' + history.length + ' model(s) across Pollinations and LLM7. Please press Regenerate in a moment, or add your own API key in Settings.', model_used: 'none', model_name: 'All free models busy', model_badge: 'Failover Exhausted', gateway: 'none', gateway_name: '-', provider_status: 'exhausted', status: 'exhausted', mode: 'arkai_free', failover_count: history.length, failover_history: history, next_model: null, tried_models: exclude, total_latency_ms: Math.round(Number(process.hrtime.bigint() - overall) / 1_000_000 * 100) / 100 };
}

// ------------------------------------------------------------ streaming
export type StreamEvent = { type: string; [key: string]: unknown };
export interface ChatOptions {
  messages: ChatTurn[]; intent?: string; excludeModels?: string[];
  apiKeyOverride?: string; provider?: string; systemPrompt?: string; temperature?: number;
}

function parseSseDelta(line: string): string {
  if (!line.startsWith('data:')) return '';
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return '';
  try {
    const obj = JSON.parse(data);
    const ch = (obj.choices || [])[0];
    const delta = ch?.delta || ch?.message || {};
    return delta.content || '';
  } catch { return ''; }
}

async function* streamPostLines(url: string, payload: Record<string, unknown>, headers: Record<string, string>, timeoutMs: number): AsyncGenerator<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload), signal: ctrl.signal });
    if (!resp.ok || !resp.body) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${body.slice(0, 160)}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) yield line;
      }
    }
    if (buffer.trim()) yield buffer.trim();
  } finally { clearTimeout(timer); }
}

async function* streamGatewayDeltas(logical: LogicalModel, messages: ChatTurn[], temperature: number): AsyncGenerator<string> {
  const gw = FREE_GATEWAYS[logical.gateway];
  let any = false;
  for await (const line of streamPostLines(gw.endpoint, { model: logical.upstreamModel, messages, temperature, stream: true }, {}, gw.timeoutMs + 60000)) {
    const d = parseSseDelta(line);
    if (d) { any = true; yield d; }
  }
  if (!any) throw new Error('Empty stream from model');
}

export async function* executeOrchestratedChatStream(opts: ChatOptions): AsyncGenerator<StreamEvent> {
  const started = Date.now();
  const exclude = opts.excludeModels || [];
  const messages = [...opts.messages];
  if (opts.systemPrompt && (!messages.length || messages[0].role !== 'system')) {
    messages.unshift({ role: 'system', content: opts.systemPrompt });
  }
  const temperature = opts.temperature ?? 0.7;
  const done = (r: Record<string, unknown>): StreamEvent => ({ ...r, type: 'done', total_latency_ms: Date.now() - started });

  if ((opts.apiKeyOverride || '').trim()) {
    const provider = detectProviderFromKey(opts.apiKeyOverride, opts.provider);
    const spec = OWN_KEY_PROVIDERS[provider];
    if (provider === 'claude') {
      const result: any = await executeOrchestratedChat(opts);
      yield { type: 'meta', model_used: result.model_used, model_name: result.model_name, model_badge: result.model_badge, gateway: provider, gateway_name: spec.name, mode: 'own_key' };
      if (result.response) yield { type: 'delta', content: result.response };
      yield done({ ...result });
      return;
    }
    const headers = { Authorization: `Bearer ${opts.apiKeyOverride!.trim()}` };
    const history: Array<Record<string, unknown>> = [];
    for (const model of spec.models) {
      const logicalId = `ownkey/${provider}/${model}`;
      if (exclude.includes(logicalId) || exclude.includes(model)) continue;
      let collected = '';
      try {
        const gen = streamPostLines(spec.endpoint, { model, messages, temperature, stream: true }, headers, 120000);
        // pull until first delta so meta is only announced for a model that answers
        let firstDelta = '';
        let pending: string[] = [];
        for await (const line of gen) {
          const d = parseSseDelta(line);
          if (d) { firstDelta = d; break; }
        }
        if (!firstDelta) throw new Error('Empty stream');
        yield { type: 'meta', model_used: logicalId, model_name: model, model_badge: spec.name, gateway: provider, gateway_name: spec.name, mode: 'own_key' };
        collected += firstDelta;
        yield { type: 'delta', content: firstDelta };
        for await (const line of gen) {
          const d = parseSseDelta(line);
          if (d) { collected += d; yield { type: 'delta', content: d }; }
        }
        void pending;
      } catch (e) {
        if (!collected) { history.push({ model: logicalId, reason: String(e) }); continue; }
      }
      const ranked = spec.models.map(m => `ownkey/${provider}/${m}`);
      const tried = [...exclude, logicalId];
      const remaining = ranked.filter(m => !tried.includes(m));
      yield done({ response: collected, model_used: logicalId, model_name: model, model_badge: spec.name, gateway: provider, gateway_name: spec.name, provider_status: 'success', status: 'success', mode: 'own_key', failover_count: history.length, failover_history: history, next_model: remaining[0] || null, tried_models: tried });
      return;
    }
    yield done({ response: "Your API key's provider did not return an answer. Check the key and provider in Settings, then try again.", model_used: `ownkey/${provider}`, model_name: spec.name, model_badge: spec.name, gateway: provider, gateway_name: spec.name, provider_status: 'exhausted', status: 'exhausted', mode: 'own_key', failover_count: history.length, failover_history: history, next_model: null, tried_models: exclude });
    return;
  }

  const ranked = rankedModelsForIntent(opts.intent || 'general', exclude);
  const failover: Array<Record<string, unknown>> = [];
  for (const logical of ranked) {
    let collected = '';
    try {
      const gen = streamGatewayDeltas(logical, messages, temperature);
      let first = await gen.next();
      if (first.done || !first.value) throw new Error('Empty stream');
      yield { type: 'meta', model_used: logical.id, model_name: logical.name, model_badge: logical.badge, gateway: logical.gateway, gateway_name: FREE_GATEWAYS[logical.gateway].name, provider_family: logical.providerFamily, mode: 'arkai_free' };
      collected += first.value;
      yield { type: 'delta', content: first.value };
      for await (const d of gen) { collected += d; yield { type: 'delta', content: d }; }
    } catch (e) {
      if (!collected) { failover.push({ model: logical.id, gateway: logical.gateway, reason: String(e) }); continue; }
    }
    const tried = [...exclude, logical.id];
    const remaining = rankedModelsForIntent(opts.intent || 'general', tried);
    yield done({ response: collected, model_used: logical.id, model_name: logical.name, model_badge: logical.badge, gateway: logical.gateway, gateway_name: FREE_GATEWAYS[logical.gateway].name, provider_family: logical.providerFamily, provider_status: 'success', status: 'success', mode: 'arkai_free', failover_count: failover.length, failover_history: failover, next_model: remaining[0]?.id || null, next_model_name: remaining[0]?.name || null, tried_models: tried });
    return;
  }
  yield done({ response: `All free AI gateways are busy right now. arkAI tried ${failover.length} model(s) across Pollinations and LLM7. Please press Regenerate in a moment, or add your own API key in Settings.`, model_used: 'none', model_name: 'All free models busy', model_badge: 'Failover Exhausted', gateway: 'none', gateway_name: '-', provider_status: 'exhausted', status: 'exhausted', mode: 'arkai_free', failover_count: failover.length, failover_history: failover, next_model: null, tried_models: exclude });
}
