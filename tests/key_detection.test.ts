/**
 * arkAI Test Suite: Own-Key Provider Detection
 * detectProviderFromKey now returns the provider id string. It is only
 * used in Own-Key mode; with no key arkAI runs its free orchestrator.
 */
import { detectProviderFromKey, OWN_KEY_PROVIDERS } from '../src/orchestrator.ts';

export function runKeyDetectionTests(): { name: string; passed: boolean; details?: string }[] {
  const results = [];
  const cases: Array<[string, string, string]> = [
    ['sk-' + 'ant-' + 'api03-' + 'TESTKEY0000000000000000000000000001', 'claude', 'Auto-detect Anthropic Claude key (sk-ant-...)'],
    ['xai-abcdef1234567890', 'grok', 'Auto-detect xAI Grok key (xai-...)'],
    ['gsk_abcdef1234567890', 'meta', 'Auto-detect Meta LLaMA / Groq key (gsk_...)'],
    ['sk-' + 'or-' + 'v1-' + 'TESTKEY0000000000000000000000000002', 'openrouter', 'Auto-detect OpenRouter key (sk-or-...)'],
    ['AIza' + 'Sy' + 'TESTKEY000000000000000000000000003', 'gemini', 'Auto-detect Google Gemini key (AIza...)'],
    ['sk-' + 'proj-' + 'TESTKEY00000000000000000000000000004', 'openai', 'Auto-detect OpenAI key (sk-...)'],
  ];
  for (const [key, expected, name] of cases) {
    const provider = detectProviderFromKey(key);
    results.push({ name, passed: provider === expected && Boolean(OWN_KEY_PROVIDERS[provider]?.endpoint), details: `Resolved provider: ${provider} -> ${OWN_KEY_PROVIDERS[provider]?.endpoint}` });
  }
  results.push({ name: 'Explicit DeepSeek provider wins over key shape', passed: detectProviderFromKey('any-key', 'deepseek') === 'deepseek', details: 'explicit provider honoured' });
  results.push({ name: 'Explicit Qwen provider wins over key shape', passed: detectProviderFromKey('any-key', 'qwen') === 'qwen', details: 'explicit provider honoured' });
  results.push({ name: 'Every own-key provider has models configured', passed: Object.values(OWN_KEY_PROVIDERS).every(p => p.models.length > 0), details: Object.keys(OWN_KEY_PROVIDERS).join(', ') });
  return results;
}
