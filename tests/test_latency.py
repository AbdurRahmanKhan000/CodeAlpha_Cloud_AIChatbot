"""arkAI v5.1 latency discipline tests.

The production pain: a code question took 58s to first token because a
stalling model was waited on for its full timeout before cascading.
Now: 7s first-token deadline per model, patience wait only as last resort.
"""

import asyncio
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api import router


def _model(mid):
    return {"id": mid, "gateway": "llm7", "upstream_model": "x",
            "name": mid, "badge": "Test", "provider_family": "Test",
            "strengths": ["general"]}


class TestFirstTokenDeadline(unittest.TestCase):
    def setUp(self):
        self._orig_stream = router._stream_gateway_model
        self._orig_ranked = router.ranked_models_for_intent
        self._orig_ft = router.FIRST_TOKEN_SECONDS
        router.FIRST_TOKEN_SECONDS = 1.0

    def tearDown(self):
        router._stream_gateway_model = self._orig_stream
        router.ranked_models_for_intent = self._orig_ranked
        router.FIRST_TOKEN_SECONDS = self._orig_ft

    def test_slow_model_is_abandoned_fast_model_wins(self):
        async def fake(logical, messages, temperature):
            if logical["id"] == "slow/model":
                await asyncio.sleep(30)
                yield "never"
            else:
                yield "Hello"
                yield " world"

        router._stream_gateway_model = fake
        router.ranked_models_for_intent = lambda intent, exclude=None: [
            m for m in [_model("slow/model"), _model("fast/model")]
            if m["id"] not in (exclude or [])]

        async def run():
            events = []
            async for ev in router.execute_orchestrated_chat_stream(
                    messages=[{"role": "user", "content": "hi"}], intent="general"):
                events.append(ev)
            return events

        start = time.time()
        events = asyncio.run(asyncio.wait_for(run(), timeout=15))
        elapsed = time.time() - start
        done = events[-1]
        self.assertLess(elapsed, 6, "cascade must not wait on the stalled model")
        self.assertEqual(done["status"], "success")
        self.assertEqual(done["model_used"], "fast/model")
        self.assertEqual(done["response"], "Hello world")

    def test_patience_only_as_last_resort(self):
        calls = {"n": 0}

        async def fake(logical, messages, temperature):
            calls["n"] += 1
            if calls["n"] == 1:
                raise router._StreamOpenError(429, "Daily token quota exceeded. Retry after 1 seconds.")
            yield "Recovered"

        router._stream_gateway_model = fake
        router.ranked_models_for_intent = lambda intent, exclude=None: [
            m for m in [_model("only/model")] if m["id"] not in (exclude or [])]

        async def run():
            return [ev async for ev in router.execute_orchestrated_chat_stream(
                messages=[{"role": "user", "content": "hi"}], intent="general")]

        events = asyncio.run(asyncio.wait_for(run(), timeout=20))
        types = [e["type"] for e in events]
        self.assertIn("status", types)          # patience notice was shown
        self.assertEqual(events[-1]["status"], "success")
        self.assertEqual(events[-1]["response"], "Recovered")
        self.assertEqual(calls["n"], 2)         # exactly one retry


if __name__ == "__main__":
    unittest.main()
