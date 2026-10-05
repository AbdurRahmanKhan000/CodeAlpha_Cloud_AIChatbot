/**
 * arkAI Core AI Engine Utilities
 * Provides:
 * - Universal provider and key resolution (OpenAI, Gemini, Claude, Grok, DeepSeek, Meta, Qwen)
 * - Sub-millisecond local pattern matcher (< 1ms SLA)
 * - Levenshtein & token similarity functions
 */

import fs from 'fs';
import path from 'path';

export interface IntentPattern {
  id: string;
  intent: string;
  priority?: number;
  tags?: string[];
  triggers?: string[];
  regex_patterns?: string[];
  response: string;
  follow_up_suggestions?: string[];
}

export interface PatternsData {
  version: string;
  name: string;
  intents: IntentPattern[];
}

// Find patterns file safely across module contexts
function findPatternsFile(): string {
  const possiblePaths = [
    path.join(process.cwd(), 'data', 'patterns.json'),
    path.join(process.cwd(), '..', 'data', 'patterns.json'),
    path.resolve('data/patterns.json'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.cwd(), 'data', 'patterns.json');
}

export const patternsPath = findPatternsFile();
let patternsData: PatternsData = { version: '2.0.0', name: 'arkAI Knowledgebase', intents: [] };
if (fs.existsSync(patternsPath)) {
  try {
    patternsData = JSON.parse(fs.readFileSync(patternsPath, 'utf8'));
  } catch (err) {
    console.error('[arkAI] Error parsing patterns.json:', err);
  }
}

// Pre-compute lookup structures
const exactTriggers = new Map<string, IntentPattern>();
const compiledRegexes: { regex: RegExp; pattern: IntentPattern }[] = [];
const allTriggerPhrases: string[] = [];

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

for (const item of patternsData.intents) {
  if (Array.isArray(item.triggers)) {
    for (const trig of item.triggers) {
      const clean = normalize(trig);
      if (clean) {
        exactTriggers.set(clean, item);
        allTriggerPhrases.push(clean);
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
        // Ignored
      }
    }
  }
}

// Rapid token sort similarity scoring (sub-millisecond in JS)
export function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 100;
  const words1 = str1.split(' ').sort().join(' ');
  const words2 = str2.split(' ').sort().join(' ');
  if (words1 === words2) return 96;

  const track = Array(words2.length + 1).fill(null).map(() =>
    Array(words1.length + 1).fill(null));
  for (let i = 0; i <= words1.length; i += 1) track[0][i] = i;
  for (let j = 0; j <= words2.length; j += 1) track[j][0] = j;
  for (let j = 1; j <= words2.length; j += 1) {
    for (let i = 1; i <= words1.length; i += 1) {
      const indicator = words1[i - 1] === words2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }
  const distance = track[words2.length][words1.length];
  const maxLen = Math.max(words1.length, words2.length);
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

  // 1. Exact Trigger O(1) Lookup (~10 - 25 microseconds)
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

  // 2. Pre-Compiled Regex Matching (~40 - 80 microseconds)
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

  // 3. Fast Fuzzy Matching (~120 - 350 microseconds)
  let bestScore = 0;
  let bestTrigger = '';
  let bestPattern: IntentPattern | null = null;

  for (const trig of allTriggerPhrases) {
    const score = calculateSimilarity(clean, trig);
    if (score > bestScore) {
      bestScore = score;
      bestTrigger = trig;
      bestPattern = exactTriggers.get(trig) || null;
    }
    if (bestScore >= 95) break; // Early exit on near-exact
  }

  const elapsedMicros = Number(process.hrtime.bigint() - start) / 1000;

  if (bestScore >= threshold && bestPattern) {
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

  return {
    matched: false,
    confidence: bestScore,
    match_type: 'none',
    execution_time_micros: Math.round(elapsedMicros * 100) / 100,
    execution_time_ms: Math.round((elapsedMicros / 1000) * 10000) / 10000,
  };
}

// Universal Provider & Key Resolver
export function detectProviderFromKey(key?: string, explicitProvider?: string): {
  provider: 'gemini' | 'openai' | 'claude' | 'grok' | 'deepseek' | 'meta' | 'qwen' | 'openrouter';
  model: string;
  endpoint?: string;
  name: string;
} {
  const trimmed = (key || '').trim();
  const explicit = (explicitProvider || '').toLowerCase().trim();

  // If user selected explicit provider other than 'auto' or 'gemini'
  if (explicit === 'claude') {
    return { provider: 'claude', model: 'claude-3-5-sonnet-20241022', endpoint: 'https://api.anthropic.com/v1/messages', name: 'Anthropic Claude' };
  }
  if (explicit === 'deepseek') {
    return { provider: 'deepseek', model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/chat/completions', name: 'DeepSeek' };
  }
  if (explicit === 'meta') {
    return { provider: 'meta', model: 'llama-3.3-70b-versatile', endpoint: 'https://api.groq.com/openai/v1/chat/completions', name: 'Meta LLaMA' };
  }
  if (explicit === 'qwen') {
    return { provider: 'qwen', model: 'qwen-plus', endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', name: 'Alibaba Qwen' };
  }
  if (explicit === 'grok') {
    return { provider: 'grok', model: 'grok-2', endpoint: 'https://api.x.ai/v1/chat/completions', name: 'xAI Grok' };
  }
  if (explicit === 'openai') {
    return { provider: 'openai', model: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1/chat/completions', name: 'OpenAI ChatGPT' };
  }

  // Auto-detection based on key signature
  if (trimmed.startsWith('sk-ant-')) {
    return { provider: 'claude', model: 'claude-3-5-sonnet-20241022', endpoint: 'https://api.anthropic.com/v1/messages', name: 'Anthropic Claude' };
  }
  if (trimmed.startsWith('xai-')) {
    return { provider: 'grok', model: 'grok-2', endpoint: 'https://api.x.ai/v1/chat/completions', name: 'xAI Grok' };
  }
  if (trimmed.startsWith('gsk_')) {
    return { provider: 'meta', model: 'llama-3.3-70b-versatile', endpoint: 'https://api.groq.com/openai/v1/chat/completions', name: 'Meta LLaMA (Groq)' };
  }
  if (trimmed.startsWith('sk-or-')) {
    return { provider: 'openrouter', model: 'deepseek/deepseek-chat', endpoint: 'https://openrouter.ai/api/v1/chat/completions', name: 'OpenRouter' };
  }
  if (trimmed.startsWith('AIzaSy')) {
    return { provider: 'gemini', model: 'gemini-flash-latest', name: 'Google Gemini' };
  }
  if (trimmed.startsWith('sk-')) {
    return { provider: 'openai', model: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1/chat/completions', name: 'OpenAI ChatGPT' };
  }

  // Default: Gemini built-in
  return { provider: 'gemini', model: 'gemini-flash-latest', name: 'Google Gemini (Default)' };
}
