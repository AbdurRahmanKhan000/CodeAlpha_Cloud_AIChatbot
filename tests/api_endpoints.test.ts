/**
 * arkAI Test Suite: API Endpoints & Health Check
 * Validates /api/health, /api/patterns, /api/match, /api/benchmark.
 */

export async function runApiEndpointTests(): Promise<{ name: string; passed: boolean; details?: string }[]> {
  const results = [];

  // Test 1: GET /api/health
  try {
    const res = await fetch('http://localhost:3000/api/health');
    const data = await res.json() as any;
    results.push({
      name: 'GET /api/health returns operational status',
      passed: res.status === 200 && data.status === 'operational' && data.engine === 'arkAI Sub-1ms Hybrid',
      details: `Status: ${data.status}, Uptime: ${data.uptime?.toFixed(1)}s`
    });
  } catch (e: any) {
    results.push({ name: 'GET /api/health', passed: false, details: e.message });
  }

  // Test 2: GET /api/patterns
  try {
    const res = await fetch('http://localhost:3000/api/patterns');
    const data = await res.json() as any;
    results.push({
      name: 'GET /api/patterns lists knowledge base intents',
      passed: res.status === 200 && typeof data.count === 'number' && data.count > 0,
      details: `Total cached intents: ${data.count}`
    });
  } catch (e: any) {
    results.push({ name: 'GET /api/patterns', passed: false, details: e.message });
  }

  // Test 3: POST /api/match direct sub-millisecond execution
  try {
    const res = await fetch('http://localhost:3000/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'hello there', threshold: 85.0 })
    });
    const data = await res.json() as any;
    results.push({
      name: 'POST /api/match executes sub-millisecond pattern lookup',
      passed: res.status === 200 && data.matched === true && data.execution_time_micros < 1000,
      details: `Execution time: ${data.execution_time_micros}μs (< 1000μs SLA)`
    });
  } catch (e: any) {
    results.push({ name: 'POST /api/match', passed: false, details: e.message });
  }

  // Test 4: POST /api/benchmark verifies in-memory performance
  try {
    const res = await fetch('http://localhost:3000/api/benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iterations: 100 })
    });
    const data = await res.json() as any;
    results.push({
      name: 'POST /api/benchmark verifies high-throughput in-memory execution',
      passed: res.status === 200 && (data.mean_micros < 1000 || data.median_micros < 1000),
      details: `Mean: ${data.mean_micros}μs, Median: ${data.median_micros}μs`
    });
  } catch (e: any) {
    results.push({ name: 'POST /api/benchmark', passed: false, details: e.message });
  }

  return results;
}
