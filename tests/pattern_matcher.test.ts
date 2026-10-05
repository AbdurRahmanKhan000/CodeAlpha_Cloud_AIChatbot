/**
 * arkAI Test Suite: Sub-Millisecond Pattern Matcher
 * Verifies instant intent recognition, fuzzy matching, execution speed (<1ms), and response formats.
 */

import { matchIntent } from '../server.js';

export function runPatternMatcherTests(): { name: string; passed: boolean; details?: string }[] {
  const results = [];

  // Warm up JIT optimizer
  matchIntent('warmup');
  matchIntent('what are your pricing plans');

  // Test 1: Exact Match for Pricing
  const t1 = matchIntent('what are your pricing plans');
  results.push({
    name: 'Exact Match: Pricing query',
    passed: t1.matched && t1.intent === 'pricing_plans' && t1.confidence === 100,
    details: `Matched: ${t1.intent} in ${t1.execution_time_micros}μs`
  });

  // Test 2: Sub-1ms Latency SLA (< 1000 microseconds)
  const t2 = matchIntent('what services do you offer');
  results.push({
    name: 'Sub-1ms Latency SLA (< 1000 microseconds)',
    passed: t2.matched && t2.execution_time_micros < 1000,
    details: `Execution time: ${t2.execution_time_micros}μs (< 1000μs SLA)`
  });

  // Test 3: Security & Privacy intent
  const t3 = matchIntent('is my data safe');
  results.push({
    name: 'Exact Match: Security & privacy compliance',
    passed: t3.matched && t3.intent === 'security_compliance',
    details: `Matched: ${t3.intent} (Confidence: ${t3.confidence}%)`
  });

  // Test 4: Fuzzy Match (typos / variations)
  const t4 = matchIntent('what are your pricing plan', 60);
  results.push({
    name: 'Fuzzy Matching with minor query variation',
    passed: t4.matched && t4.intent === 'pricing_plans',
    details: `Matched with confidence: ${t4.confidence}%`
  });

  // Test 5: Empty query returns matched: false gracefully
  const t5 = matchIntent('');
  results.push({
    name: 'Empty query gracefully returns matched: false',
    passed: !t5.matched && t5.match_type === 'none',
    details: `Result: matched=${t5.matched}`
  });

  // Test 6: Open-ended query passes to AI layer (no false positive)
  const t6 = matchIntent('Write a complex neural network from scratch in C++', 85);
  results.push({
    name: 'Open-ended complex query passes to AI layer (no false positive)',
    passed: !t6.matched,
    details: `Correctly bypassed local matcher (matched: ${t6.matched})`
  });

  return results;
}
