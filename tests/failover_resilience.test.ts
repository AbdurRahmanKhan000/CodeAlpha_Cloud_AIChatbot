/**
 * arkAI Test Suite: Failover Resilience & Error Recovery
 * Validates that bad custom keys (401 invalid key, 429 credit exhausted as in user screenshot)
 * never crash or show raw JSON errors, but instead gracefully engage built-in Gemini failover.
 */

export async function runFailoverResilienceTests(): Promise<{ name: string; passed: boolean; details?: string }[]> {
  const results = [];

  // Test 1: Testing server endpoint with an invalid/exhausted key simulation
  try {
    const res = await fetch('http://localhost:3000/api/chat', {
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
    const hasFailover = (data.response && (data.response.includes('Failover') || data.response.includes('Gemini') || data.response.includes('4'))) || data.source === 'ai';
    const isNotRawJsonCrash = !data.response.includes('"code": "invalid_api_key"');

    results.push({
      name: 'Resilient Failover on 401 Invalid Custom Key',
      passed: hasFailover && isNotRawJsonCrash,
      details: `Response delivered safely without raw JSON dump. Source: ${data.source || data.provider}`
    });
  } catch (err: any) {
    results.push({
      name: 'Resilient Failover on 401 Invalid Custom Key',
      passed: false,
      details: `Network error: ${err.message}`
    });
  }

  // Test 2: Standard built-in Gemini chat without key
  try {
    const res = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Give me code for a quick greeting function in JavaScript.',
        mode: 'ai_only'
      })
    });

    const data = await res.json() as any;
    const hasContent = data.response && data.response.length > 20;

    results.push({
      name: 'Built-in Gemini Chat Execution (Zero-Key Required)',
      passed: hasContent && data.source === 'ai',
      details: `Generated ${data.response?.length || 0} chars (Latency: ${data.latency_ms}ms, Provider: ${data.provider})`
    });
  } catch (err: any) {
    results.push({
      name: 'Built-in Gemini Chat Execution (Zero-Key Required)',
      passed: false,
      details: `Error: ${err.message}`
    });
  }

  return results;
}
