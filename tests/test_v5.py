"""arkAI v5 tests: pattern engine in the Python backend, adaptive layer
(circuit breaker + learning scoreboard), 7-model pool, booster house keys."""

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api import adaptive, patterns
from api.config import MODEL_CATALOG, house_models, ranked_models_for_intent
from api.router import _parse_retry_after


class TestPatternEnginePython(unittest.TestCase):
    def test_pricing_question_matches_exactly(self):
        m = patterns.match_intent("What are your pricing plans?", 85.0)
        self.assertTrue(m["matched"])
        self.assertEqual(m["intent"], "pricing_plans")
        self.assertIn("Pricing", m["response"])

    def test_greeting_matches(self):
        m = patterns.match_intent("hello there", 85.0)
        self.assertTrue(m["matched"])
        self.assertEqual(m["intent"], "greeting")

    def test_unrelated_question_does_not_match(self):
        m = patterns.match_intent("Explain quantum entanglement simply", 85.0)
        self.assertFalse(m["matched"])

    def test_patterns_loaded(self):
        self.assertGreaterEqual(patterns.intents_count(), 9)
        self.assertGreater(patterns.triggers_count(), 50)


class TestPoolV5(unittest.TestCase):
    def test_seven_models_five_families(self):
        self.assertEqual(len(MODEL_CATALOG), 7)
        families = {m["provider_family"] for m in MODEL_CATALOG}
        self.assertGreaterEqual(len(families), 5)

    def test_new_models_ranked(self):
        code = [m["id"] for m in ranked_models_for_intent("code")]
        self.assertEqual(code[0], "llm7/deepseek-v4-flash")
        self.assertEqual(code[1], "llm7/codestral")
        general = [m["id"] for m in ranked_models_for_intent("general")]
        self.assertEqual(general[0], "pollinations/gpt-oss-20b")
        self.assertEqual(len(general), 7)

    def test_regenerate_walk_visits_all_seven(self):
        tried, seen = [], []
        for _ in range(7):
            nxt = ranked_models_for_intent("general", exclude=tried)
            self.assertTrue(nxt)
            seen.append(nxt[0]["id"])
            tried.append(nxt[0]["id"])
        self.assertEqual(len(set(seen)), 7)
        self.assertEqual(ranked_models_for_intent("general", exclude=tried), [])


class TestAdaptive(unittest.TestCase):
    def test_breaker_benches_after_three_failures(self):
        mid = "test/bench-model"
        self.assertFalse(adaptive.is_benched(mid))
        for _ in range(3):
            adaptive.record_failure(mid)
        self.assertTrue(adaptive.is_benched(mid))
        adaptive.record_success(mid)
        self.assertFalse(adaptive.is_benched(mid))

    def test_learning_reorders_after_feedback(self):
        async def feed():
            for _ in range(6):
                await adaptive.record_feedback("general", "llm7/glm-5.3-flash", "up")
                await adaptive.record_feedback("general", "pollinations/gpt-oss-20b", "down")
        asyncio.run(feed())
        self.assertGreater(adaptive.winrate("general", "llm7/glm-5.3-flash"), 0.5)
        self.assertLess(adaptive.winrate("general", "pollinations/gpt-oss-20b"), 0.5)
        ordered = adaptive.apply_learning("general", ranked_models_for_intent("general"))
        self.assertEqual(ordered[0]["id"], "llm7/glm-5.3-flash")

    def test_unknown_event_ignored(self):
        rec = asyncio.run(adaptive.record_feedback("general", "x/y", "bogus"))
        self.assertEqual(rec, {})


class TestPatienceAndBoosters(unittest.TestCase):
    def test_parse_retry_after_message(self):
        self.assertEqual(_parse_retry_after('{"error":{"message":"Daily token quota exceeded. Retry after 16 seconds."}}'), 16.0)

    def test_parse_retry_after_field(self):
        self.assertEqual(_parse_retry_after('{"error":"quota","retry_after": 7}'), 7.0)

    def test_parse_retry_after_none(self):
        self.assertEqual(_parse_retry_after("HTTP 500 boom"), 0.0)

    def test_no_house_models_without_keys(self):
        # test env sets no ARKAI_*_API_KEY booster vars
        if not any(os.environ.get(k) for k in ("ARKAI_GROQ_API_KEY", "GROQ_API_KEY",
                                               "ARKAI_LLM7_API_KEY", "LLM7_API_KEY",
                                               "ARKAI_OPENROUTER_API_KEY", "OPENROUTER_API_KEY")):
            self.assertEqual(house_models(), [])


if __name__ == "__main__":
    unittest.main()
