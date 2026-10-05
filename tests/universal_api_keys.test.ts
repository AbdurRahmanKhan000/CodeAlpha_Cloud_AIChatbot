/**
 * arkAI Test Suite: Universal API Key Integration & Zero-Model Config
 * Verifies that arkAI accepts ANY key (ChatGPT, Gemini, Grok, Claude, DeepSeek, Meta, Qwen)
 * without requiring the user to choose specific models, and uses Gemini by default.
 */

import { detectProviderFromKey } from '../server.js';

export function runUniversalKeyTests(): { name: string; passed: boolean; details?: string }[] {
  const results = [];

  // 1. ChatGPT (OpenAI) Key
  const chatGptKey = 'sk-proj-abc1234567890XYZ';
  const chatGptResult = detectProviderFromKey(chatGptKey);
  results.push({
    name: 'Accepts ChatGPT (OpenAI) API key without manual model setup',
    passed: chatGptResult.provider === 'openai' && chatGptResult.model === 'gpt-4o' && chatGptResult.fallbackModels.length > 0,
    details: `Provider: ${chatGptResult.name}, Primary Model: ${chatGptResult.model}, Fallback: ${chatGptResult.fallbackModels.join(', ')}`
  });

  // 2. Google Gemini Key
  const geminiKey = 'AIzaSyDemoKey1234567890';
  const geminiResult = detectProviderFromKey(geminiKey);
  results.push({
    name: 'Accepts Google Gemini API key with optimal speed model',
    passed: geminiResult.provider === 'gemini' && geminiResult.model === 'gemini-flash-latest',
    details: `Provider: ${geminiResult.name}, Model: ${geminiResult.model}`
  });

  // 3. xAI Grok Key
  const grokKey = 'xai-demo-key-123456789';
  const grokResult = detectProviderFromKey(grokKey);
  results.push({
    name: 'Accepts xAI Grok API key automatically',
    passed: grokResult.provider === 'grok' && Boolean(grokResult.endpoint?.includes('x.ai')),
    details: `Provider: ${grokResult.name}, Model: ${grokResult.model}`
  });

  // 4. Anthropic Claude Key
  const claudeKey = 'sk-ant-api03-demo-key-12345';
  const claudeResult = detectProviderFromKey(claudeKey);
  results.push({
    name: 'Accepts Anthropic Claude API key automatically',
    passed: claudeResult.provider === 'claude' && claudeResult.endpoint === 'https://api.anthropic.com/v1/messages',
    details: `Provider: ${claudeResult.name}, Model: ${claudeResult.model}`
  });

  // 5. DeepSeek Key
  const deepseekResult = detectProviderFromKey('sk-deepseek-demo-key', 'deepseek');
  results.push({
    name: 'Accepts DeepSeek API key without specific model configuration',
    passed: deepseekResult.provider === 'deepseek' && deepseekResult.endpoint === 'https://api.deepseek.com/chat/completions',
    details: `Provider: ${deepseekResult.name}, Model: ${deepseekResult.model}`
  });

  // 6. Meta AI (Groq/LLaMA) Key
  const metaKey = 'gsk_meta_demo_key_12345';
  const metaResult = detectProviderFromKey(metaKey);
  results.push({
    name: 'Accepts Meta AI (Groq/LLaMA) API key',
    passed: metaResult.provider === 'meta' && Boolean(metaResult.endpoint?.includes('chat/completions')),
    details: `Provider: ${metaResult.name}, Model: ${metaResult.model}`
  });

  // 7. Alibaba Qwen Key
  const qwenResult = detectProviderFromKey('sk-qwen-demo-key', 'qwen');
  results.push({
    name: 'Accepts Alibaba Qwen API key without specific model selection',
    passed: qwenResult.provider === 'qwen' && Boolean(qwenResult.endpoint?.includes('aliyuncs.com')),
    details: `Provider: ${qwenResult.name}, Model: ${qwenResult.model}`
  });

  // 8. Zero-Key Default Behavior (User requirement: "By default, the existing model of Gemini is correct/best on its place")
  const defaultResult = detectProviderFromKey('');
  results.push({
    name: 'Zero-key default uses existing best Gemini model (Zero setup required)',
    passed: defaultResult.provider === 'gemini' && defaultResult.model === 'gemini-flash-latest',
    details: `Default Provider: ${defaultResult.name}, Model: ${defaultResult.model}`
  });

  return results;
}
