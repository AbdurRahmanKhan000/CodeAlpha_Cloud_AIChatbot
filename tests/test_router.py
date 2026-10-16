"""
arkAI Test Suite: Sub-2ms Heuristic Router, Free Model Catalog & Regenerate
Validates free multi-gateway orchestration (NO API key required),
classification accuracy, latency SLA, and model-hopping regeneration.
"""

import sys
import os
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.config import (
    MODEL_CATALOG, MODEL_REGISTRY, FREE_GATEWAYS, INTENT_RANKINGS,
    ranked_models_for_intent, next_model_for_regenerate,
    detect_provider_from_key, is_demo_mode, get_next_fallback_model,
)
from api.router import classify_prompt_intent


class TestArkAIOrchestrator(unittest.TestCase):

    def test_free_catalog_uses_only_anonymous_gateways(self):
        self.assertGreaterEqual(len(MODEL_CATALOG), 4)
        for m in MODEL_CATALOG:
            self.assertIn(m["gateway"], FREE_GATEWAYS)
            self.assertFalse(FREE_GATEWAYS[m["gateway"]]["requires_key"])
            self.assertIn(m["id"], MODEL_REGISTRY)

    def test_no_demo_mode(self):
        self.assertFalse(is_demo_mode())
        self.assertFalse(is_demo_mode("anything"))

    def test_sub_2ms_routing_sla(self):
        queries = [
            "Write a python script to parse a csv file and insert rows into sqlite",
            "Prove step by step that the square root of 2 is irrational",
            "Write a persuasive cover letter for a Senior Software Engineer position",
            "What is the capital of France and what is its population?",
        ]
        for q in queries:
            _, _, ms = classify_prompt_intent(q)
            self.assertLess(ms, 2.0, f"Routing took {ms}ms for: {q}")

    def test_code_routing(self):
        cat, model, _ = classify_prompt_intent("Debug this python function, it throws a traceback")
        self.assertEqual(cat, "code")
        self.assertEqual(model, "llm7/deepseek-v4-flash")

    def test_math_logic_routing(self):
        cat, model, _ = classify_prompt_intent("Calculate the derivative and solve this equation step by step")
        self.assertEqual(cat, "math_logic")
        self.assertEqual(model, INTENT_RANKINGS["math_logic"][0])

    def test_creative_routing(self):
        cat, model, _ = classify_prompt_intent("Write an essay and a poem about the sea")
        self.assertEqual(cat, "creative")
        self.assertEqual(model, "llm7/glm-5.3-flash")

    def test_general_default_routing(self):
        cat, model, _ = classify_prompt_intent("What is the capital of France?")
        self.assertEqual(cat, "general")
        self.assertEqual(model, "pollinations/gpt-oss-20b")

    def test_rankings_cover_intents_and_are_distinct(self):
        for intent, ranking in INTENT_RANKINGS.items():
            self.assertGreaterEqual(len(ranking), 3, intent)
            self.assertEqual(len(ranking), len(set(ranking)), intent)
            for mid in ranking:
                self.assertIn(mid, MODEL_REGISTRY)

    def test_regenerate_never_repeats_a_tried_model(self):
        tried = []
        seen = []
        for _ in range(len(MODEL_CATALOG)):
            nxt = next_model_for_regenerate("general", tried)
            self.assertIsNotNone(nxt)
            self.assertNotIn(nxt["id"], tried)
            tried.append(nxt["id"]); seen.append(nxt["id"])
        self.assertEqual(len(seen), len(set(seen)))
        self.assertIsNone(next_model_for_regenerate("general", tried))

    def test_next_fallback_rotation_compat(self):
        nxt = get_next_fallback_model(MODEL_CATALOG[0]["id"])
        self.assertEqual(nxt, MODEL_CATALOG[1]["id"])

    def test_own_key_provider_detection(self):
        self.assertEqual(detect_provider_from_key("sk-ant-xyz"), "claude")
        self.assertEqual(detect_provider_from_key("sk-or-xyz"), "openrouter")
        self.assertEqual(detect_provider_from_key("xai-xyz"), "grok")
        self.assertEqual(detect_provider_from_key("gsk_xyz"), "meta")
        self.assertEqual(detect_provider_from_key("AIza-xyz"), "gemini")
        self.assertEqual(detect_provider_from_key("sk-xyz"), "openai")
        self.assertEqual(detect_provider_from_key("whatever", "deepseek"), "deepseek")


if __name__ == '__main__':
    unittest.main()
