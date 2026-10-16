/**
 * arkAI Test Suite: Own-Key Integration + Free Default
 * - Own-Key mode accepts any major provider key with zero model setup.
 * - Zero-key default is the arkAI FREE orchestrator (no vendor dependency).
 */
import { detectProviderFromKey, OWN_KEY_PROVIDERS, MODEL_CATALOG, rankedModelsForIntent } from '../src/orchestrator.ts';

export function runUniversalKeyTests(): { name: string; passed: boolean; details?: string }[] {
  const results = [];
  const cases: Array<[string, string | undefined, string, string]> = [
    ['sk-' + 'proj-' + 'TESTKEY00000000000000000000000000004', undefined, 'openai', 'Accepts ChatGPT (OpenAI) key without manual model setup'],
    ['AIza' + 'Sy' + 'TESTKEY000000000000000000000000003', undefined, 'gemini', 'Accepts Google Gemini key (Own-Key mode only)'],
    ['xai-demo-key-123', undefined, 'grok', 'Accepts xAI Grok key automatically'],
    ['sk-' + 'ant-' + 'api03-' + 'TESTKEY0000000000000000000000000001', undefined, 'claude', 'Accepts Anthropic Claude key automatically'],
    ['sk-' + 'TESTKEY000000000000000000000000000005', 'deepseek', 'deepseek', 'Accepts DeepSeek key without model configuration'],
    ['gsk_meta_demo_key', undefined, 'meta', 'Accepts Meta AI (Groq/LLaMA) key'],
    ['sk-' + 'TESTKEY000000000000000000000000000006', 'qwen', 'qwen', 'Accepts Alibaba Qwen key without model selection'],
    ['sk-' + 'or-' + 'v1-' + 'TESTKEY0000000000000000000000000002', undefined, 'openrouter', 'Accepts OpenRouter key (Own-Key mode only)'],
  ];
  for (const [key, explicit, expected, name] of cases) {
    const provider = detectProviderFromKey(key, explicit);
    const spec = OWN_KEY_PROVIDERS[provider];
    results.push({ name, passed: provider === expected && spec.models.length > 0, details: `Provider: ${spec.name}, models: ${spec.models.join(', ')}` });
  }
  results.push({
    name: 'Zero-key default = free arkAI orchestration (no Gemini/OpenRouter dependency)',
    passed: MODEL_CATALOG.length >= 4 && MODEL_CATALOG.every(m => ['pollinations', 'llm7'].includes(m.gateway)),
    details: `Free catalog: ${MODEL_CATALOG.map(m => m.id).join(', ')}`,
  });
  results.push({
    name: 'Intent rankings give a distinct best model per intent (Regenerate can hop)',
    passed: rankedModelsForIntent('code')[0].id !== rankedModelsForIntent('creative')[0].id && rankedModelsForIntent('general').length >= 4,
    details: `code->${rankedModelsForIntent('code')[0].id}, creative->${rankedModelsForIntent('creative')[0].id}, general->${rankedModelsForIntent('general')[0].id}`,
  });
  return results;
}
