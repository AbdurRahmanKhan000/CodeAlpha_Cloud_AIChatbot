/**
 * arkAI Test Suite: Adaptive Layer (TS mirror of api/adaptive.py)
 * Circuit breaker benching, learning scoreboard win-rates, retry-after
 * parsing, and the 7-model v5 pool rankings.
 */

import { isBenched, recordFailure, recordSuccess, recordFeedback, winrate, applyLearning } from '../src/adaptive.ts';
import { rankedModelsForIntent, MODEL_CATALOG, parseRetryAfter } from '../src/orchestrator.ts';

export async function runAdaptiveLearningTests(): Promise<{ name: string; passed: boolean; details?: string }[]> {
  const results = [];

  results.push({
    name: 'v5 pool has 7 logical models across 5+ families',
    passed: MODEL_CATALOG.length === 7 && new Set(MODEL_CATALOG.map(m => m.providerFamily)).size >= 5,
    details: MODEL_CATALOG.map(m => m.id).join(', '),
  });

  const code = rankedModelsForIntent('code').map(m => m.id);
  results.push({
    name: 'Code ranking: DeepSeek first, Codestral second',
    passed: code[0] === 'llm7/deepseek-v4-flash' && code[1] === 'llm7/codestral' && code.length === 7,
    details: code.join(' > '),
  });

  const mid = 'test/bench-model';
  recordFailure(mid); recordFailure(mid);
  const notYet = !isBenched(mid);
  recordFailure(mid);
  const benched = isBenched(mid);
  recordSuccess(mid);
  results.push({
    name: 'Circuit breaker benches a model after 3 straight failures, success resets',
    passed: notYet && benched && !isBenched(mid),
    details: 'Bench window: 180s per warm instance',
  });

  for (let i = 0; i < 6; i++) {
    await recordFeedback('general', 'llm7/glm-5.3-flash', 'up');
    await recordFeedback('general', 'pollinations/gpt-oss-20b', 'down');
  }
  const reordered = applyLearning('general', rankedModelsForIntent('general'));
  results.push({
    name: 'Learning scoreboard re-ranks models by observed win-rate',
    passed: winrate('general', 'llm7/glm-5.3-flash') > 0.5
      && winrate('general', 'pollinations/gpt-oss-20b') < 0.5
      && reordered[0].id === 'llm7/glm-5.3-flash',
    details: `GLM winrate ${winrate('general', 'llm7/glm-5.3-flash').toFixed(2)} vs GPT-OSS ${winrate('general', 'pollinations/gpt-oss-20b').toFixed(2)}`,
  });

  results.push({
    name: 'Retry-after patience parses gateway quota messages',
    passed: parseRetryAfter('{"error":{"message":"Daily token quota exceeded. Retry after 16 seconds."}}') === 16
      && parseRetryAfter('{"retry_after": 7}') === 7
      && parseRetryAfter('HTTP 500 boom') === 0,
    details: 'One bounded retry (max 20s) per request, with a status event to the UI',
  });

  return results;
}
