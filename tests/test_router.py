"""
arkAI Test Suite: Sub-2ms Heuristic Router, Model Pool & Cascade Failover
Validates pure OpenRouter orchestration, classification accuracy, latency SLA, and demo mode.
"""

import sys
import os
import unittest
import time

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.config import (
    FREE_MODEL_POOL,
    MODEL_REGISTRY,
    get_next_fallback_model,
    is_demo_mode,
    get_demo_mode_response,
)
from api.router import (
    classify_prompt_intent,
    build_cascade_order,
    PRIMARY_MODEL_MAPPING,
)


class TestArkAIHeuristicRouter(unittest.TestCase):

    def test_free_model_pool_order(self):
        """Verify the exact free model pool and required priority order."""
        expected_models = [
            "google/gemini-2.0-flash-lite-001:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "deepseek/deepseek-r1:free",
            "qwen/qwen-2.5-coder-32b-instruct:free",
            "mistralai/mistral-7b-instruct:free",
        ]
        self.assertEqual(FREE_MODEL_POOL, expected_models)
        for model in expected_models:
            self.assertIn(model, MODEL_REGISTRY)

    def test_sub_2ms_routing_sla(self):
        """Verify the heuristic classifier executes in < 2.0ms (Sub-2ms SLA)."""
        queries = [
            "Write a python script to parse a csv file and insert rows into sqlite",
            "Prove step by step that the square root of 2 is irrational",
            "Write a persuasive cover letter for a Senior Software Engineer position",
            "What is the capital of France and what is its population?",
        ]
        # Warmup JIT
        classify_prompt_intent("warmup query")

        for q in queries:
            category, model, latency_ms = classify_prompt_intent(q)
            self.assertLess(latency_ms, 2.0, f"Latency {latency_ms}ms exceeded 2.0ms SLA for query '{q}'")

    def test_code_routing(self):
        """Verify code and programming queries route to Qwen 2.5 Coder 32B Free."""
        code_samples = [
            "def calculate_fibonacci(n): return n if n <= 1 else calculate_fibonacci(n-1) + calculate_fibonacci(n-2)",
            "How do I fix this JavaScript TypeError: Cannot read property 'map' of undefined?",
            "Write a SQL query to select all users who registered in the last 30 days and order by signup_date",
            "Refactor this React useEffect hook to avoid memory leaks",
        ]
        for q in code_samples:
            category, model, _ = classify_prompt_intent(q)
            self.assertEqual(category, "code", f"Failed to categorize '{q}' as code")
            self.assertEqual(model, "qwen/qwen-2.5-coder-32b-instruct:free")

    def test_math_logic_routing(self):
        """Verify math, logic, and proof queries route to DeepSeek R1 Free."""
        math_samples = [
            "Solve the quadratic equation 3x^2 - 12x + 9 = 0 step by step",
            "Calculate the probability of drawing 2 aces from a standard 52-card deck without replacement",
            "Explain the logic paradox of Achilles and the Tortoise with formal deductive reasoning",
            "Find the derivative of f(x) = ln(x^2 + 1) with respect to x",
        ]
        for q in math_samples:
            category, model, _ = classify_prompt_intent(q)
            self.assertEqual(category, "math_logic", f"Failed to categorize '{q}' as math_logic")
            self.assertEqual(model, "deepseek/deepseek-r1:free")

    def test_creative_routing(self):
        """Verify creative writing, essays, and emails route to Llama 3.3 70B Instruct Free."""
        creative_samples = [
            "Write an engaging introductory email to a potential venture capital investor for our fintech startup",
            "Compose a short dystopian science-fiction story about an AI that discovers human memory",
            "Write a creative marketing blog post announcing our new developer tool launch",
            "Draft a persuasive essay arguing for open-source software in public healthcare systems",
        ]
        for q in creative_samples:
            category, model, _ = classify_prompt_intent(q)
            self.assertEqual(category, "creative", f"Failed to categorize '{q}' as creative")
            self.assertEqual(model, "meta-llama/llama-3.3-70b-instruct:free")

    def test_general_default_routing(self):
        """Verify general conversational QA routes to Gemini 2.0 Flash Lite Free."""
        general_samples = [
            "Hello, who are you and how can you help me today?",
            "What is photosynthesis and why do plants appear green?",
            "What are the best tourist attractions to visit in Kyoto, Japan?",
            "Give me a quick overview of the Renaissance period",
        ]
        for q in general_samples:
            category, model, _ = classify_prompt_intent(q)
            self.assertEqual(category, "general", f"Failed to categorize '{q}' as general")
            self.assertEqual(model, "google/gemini-2.0-flash-lite-001:free")

    def test_cascade_sequence_ordering(self):
        """Verify cascade retry list starts with the primary model and includes all free models."""
        primary = "qwen/qwen-2.5-coder-32b-instruct:free"
        cascade = build_cascade_order(primary)
        self.assertEqual(cascade[0], primary)
        self.assertEqual(len(cascade), len(FREE_MODEL_POOL))
        # Ensure all models are represented
        for m in FREE_MODEL_POOL:
            self.assertIn(m, cascade)

    def test_next_fallback_model_rotation(self):
        """Verify 'Try Next Model' correctly rotates sequentially through the free pool."""
        m1 = FREE_MODEL_POOL[0]
        m2 = get_next_fallback_model(m1)
        self.assertEqual(m2, FREE_MODEL_POOL[1])

        last_model = FREE_MODEL_POOL[-1]
        cycled_first = get_next_fallback_model(last_model)
        self.assertEqual(cycled_first, FREE_MODEL_POOL[0])

    def test_demo_mode_graceful_payload(self):
        """Verify missing API key returns structured demo mode payload without crashing."""
        query = "Can you write a fast sorting algorithm?"
        category, assigned_model, _ = classify_prompt_intent(query)
        payload = get_demo_mode_response(category, assigned_model, query)

        self.assertEqual(payload["provider_status"], "demo_mode")
        self.assertTrue(payload["demo_mode"])
        self.assertIn("response", payload)
        self.assertIn("OPENROUTER_API_KEY", payload["response"])
        self.assertEqual(payload["model_used"], assigned_model)


if __name__ == '__main__':
    unittest.main()
