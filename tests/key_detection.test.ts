/**
 * arkAI Test Suite: Universal API Key & Provider Detection
 * Tests that any API key (ChatGPT, Gemini, Claude, Grok, DeepSeek, Meta, Qwen) is correctly detected.
 */

import { detectProviderFromKey } from '../server.js';

export function runKeyDetectionTests(): { name: string; passed: boolean; details?: string }[] {
  const results = [];

  // Test 1: Anthropic Claude key
  const claudeTest = detectProviderFromKey('sk-ant-api03-abcdef1234567890');
  results.push({
    name: 'Auto-detect Anthropic Claude key (sk-ant-...)',
    passed: claudeTest.provider === 'claude' && claudeTest.endpoint === 'https://api.anthropic.com/v1/messages',
    details: `Resolved: ${claudeTest.provider} (${claudeTest.model})`
  });

  // Test 2: xAI Grok key
  const grokTest = detectProviderFromKey('xai-abcdef1234567890');
  results.push({
    name: 'Auto-detect xAI Grok key (xai-...)',
    passed: grokTest.provider === 'grok' && grokTest.endpoint === 'https://api.x.ai/v1/chat/completions',
    details: `Resolved: ${grokTest.provider} (${grokTest.model})`
  });

  // Test 3: Meta LLaMA via Groq key
  const metaTest = detectProviderFromKey('gsk_abcdef1234567890');
  results.push({
    name: 'Auto-detect Meta LLaMA key (gsk_...)',
    passed: metaTest.provider === 'meta' && Boolean(metaTest.endpoint?.includes('chat/completions')),
    details: `Resolved: ${metaTest.provider} (${metaTest.model})`
  });

  // Test 4: OpenRouter key
  const orTest = detectProviderFromKey('sk-or-v1-abcdef1234567890');
  results.push({
    name: 'Auto-detect OpenRouter key (sk-or-...)',
    passed: orTest.provider === 'openrouter' && orTest.endpoint === 'https://openrouter.ai/api/v1/chat/completions',
    details: `Resolved: ${orTest.provider} (${orTest.model})`
  });

  // Test 5: Google Gemini key
  const geminiTest = detectProviderFromKey('AIzaSyAbcdEfGhIjKlMnOpQrStUvWxYz');
  results.push({
    name: 'Auto-detect Google Gemini key (AIzaSy...)',
    passed: geminiTest.provider === 'gemini',
    details: `Resolved: ${geminiTest.provider} (${geminiTest.model})`
  });

  // Test 6: OpenAI ChatGPT key
  const openaiTest = detectProviderFromKey('sk-proj-abcdef1234567890');
  results.push({
    name: 'Auto-detect OpenAI ChatGPT key (sk-...)',
    passed: openaiTest.provider === 'openai' && openaiTest.endpoint === 'https://api.openai.com/v1/chat/completions',
    details: `Resolved: ${openaiTest.provider} (${openaiTest.model})`
  });

  // Test 7: Empty key defaults to built-in Gemini
  const defaultTest = detectProviderFromKey('');
  results.push({
    name: 'Empty key defaults to built-in Gemini engine',
    passed: defaultTest.provider === 'gemini' && defaultTest.name.includes('Default'),
    details: `Resolved: ${defaultTest.provider} (${defaultTest.model})`
  });

  // Test 8: Explicit DeepSeek provider
  const deepseekTest = detectProviderFromKey('any-key-here', 'deepseek');
  results.push({
    name: 'Explicit DeepSeek provider routing',
    passed: deepseekTest.provider === 'deepseek' && deepseekTest.endpoint === 'https://api.deepseek.com/chat/completions',
    details: `Resolved: ${deepseekTest.provider} (${deepseekTest.model})`
  });

  // Test 9: Explicit Qwen provider
  const qwenTest = detectProviderFromKey('any-key-here', 'qwen');
  results.push({
    name: 'Explicit Alibaba Qwen provider routing',
    passed: qwenTest.provider === 'qwen' && Boolean(qwenTest.endpoint?.includes('aliyuncs.com')),
    details: `Resolved: ${qwenTest.provider} (${qwenTest.model})`
  });

  return results;
}
