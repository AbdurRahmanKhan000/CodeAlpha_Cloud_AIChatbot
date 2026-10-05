/**
 * arkAI Test Suite: Speed, Latency SLA & Comprehensive Intelligence
 * Validates sub-millisecond execution (<1ms) for commercial FAQs and
 * verifies that arkAI answers are structured, detailed, and not truncated.
 */

import { matchIntent } from '../server.js';

export function runSpeedAndIntelligenceTests(): { name: string; passed: boolean; details?: string }[] {
  const results = [];

  // Warmup JIT
  matchIntent('warmup');
  matchIntent('what are your pricing plans');
  matchIntent('what are your business hours');

  // Test 1: Pricing SLA
  const pricingMatch = matchIntent('what are your pricing plans');
  results.push({
    name: 'Pricing intent execution under 1000μs (1ms SLA)',
    passed: Boolean(pricingMatch.matched && pricingMatch.execution_time_micros < 1000),
    details: `Execution time: ${pricingMatch.execution_time_micros}μs (< 1000μs SLA)`
  });

  // Test 2: Rich, non-truncated answers
  const responseLen = pricingMatch.response?.length || 0;
  const hasMarkdownStructure = Boolean(pricingMatch.response?.includes('**') && pricingMatch.response?.includes('- **'));
  results.push({
    name: 'Responses are comprehensive, structured, and not overly brief',
    passed: Boolean(responseLen > 150 && hasMarkdownStructure),
    details: `Response length: ${responseLen} chars with rich markdown bullet structure`
  });

  // Test 3: Natural greetings like "hello there" match accurately
  const greetingMatch = matchIntent('hello there');
  results.push({
    name: 'Natural greetings like "hello there" match accurately',
    passed: Boolean(greetingMatch.matched && greetingMatch.intent === 'greeting'),
    details: `Matched intent: ${greetingMatch.intent} in ${greetingMatch.execution_time_micros}μs`
  });

  // Test 4: Business hours query SLA
  const hoursMatch = matchIntent('what are your business hours');
  results.push({
    name: 'Business hours intent resolution under 1ms',
    passed: Boolean(hoursMatch.matched && hoursMatch.execution_time_micros < 1000),
    details: `Execution time: ${hoursMatch.execution_time_micros}μs`
  });

  // Test 5: Follow-up suggestions included for intelligence
  const hasFollowUps = Array.isArray(pricingMatch.follow_up_suggestions) && pricingMatch.follow_up_suggestions.length > 0;
  results.push({
    name: 'Intelligent follow-up suggestions generated for continuous dialogue',
    passed: Boolean(hasFollowUps),
    details: `Suggestions count: ${pricingMatch.follow_up_suggestions?.length || 0}`
  });

  return results;
}
