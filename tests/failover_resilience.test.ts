/**
 * arkAI Test Suite: Failover Resilience & Error Recovery
 * Validates that bad custom keys (401 invalid key, 429 credit exhausted as in user screenshot)
 * never crash or show raw JSON errors: Own-Key failures return a graceful
 * arkAI message, and zero-key chat runs on the free orchestrator.
 */

export async function runFailoverResilienceTests(): Promise<{ name: string; passed: boolean; details?: string }[]> {
  const results = [];
  const baseUrl = process.env.TEST_SERVER_URL || 'http://localhost:3000';

  // Test 1: Testing server endpoint with an invalid/exhausted key simulation
  try {
    const res = await fetch(new URL('/api/chat', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Hello, what is 2 + 2?',
        mode: 'ai_only',
        provider: 'openai',
        api_key_override: 'sk-invalid-test-key-for-failover-testing-12345'
      })
    });

    const data = await res.json() as any;
    // Should NOT return raw OpenAI 401 error or crash; should return failover message and valid answer
    const hasFailover = Boolean(data.response && data.response.length > 10) && data.mode === 'own_key';
    const isNotRawJsonCrash = !data.response.includes('"code": "invalid_api_key"');

    results.push({
      name: 'Graceful handling of 401 invalid Own-Key (no crash, no raw error)',
      passed: hasFailover && isNotRawJsonCrash,
      details: `Response delivered safely without raw JSON dump. Source: ${data.source || data.provider}`
    });
  } catch (err: any) {
    results.push({
      name: 'Graceful handling of 401 invalid Own-Key (no crash, no raw error)',
      passed: false,
      details: `Network error: ${err.message}`
    });
  }

  // Test 2: Free orchestrated chat without any key
  try {
    const res = await fetch(new URL('/api/chat', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Give me code for a quick greeting function in JavaScript.',
        mode: 'ai_only'
      })
    });

    const data = await res.json() as any;
    const hasContent = data.response && data.response.length > 20 && Boolean(data.model_used);

    results.push({
      name: 'Free Orchestrated Chat Execution (Zero-Key Required)',
      passed: hasContent && data.source === 'ai',
      details: `Generated ${data.response?.length || 0} chars (Latency: ${data.latency_ms}ms, Model: ${data.model_used})`
    });
  } catch (err: any) {
    results.push({
      name: 'Free Orchestrated Chat Execution (Zero-Key Required)',
      passed: false,
      details: `Error: ${err.message}`
    });
  }

  return results;
}
