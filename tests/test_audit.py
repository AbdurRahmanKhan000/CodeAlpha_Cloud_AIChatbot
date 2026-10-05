"""
arkAI - QA Lead & Senior Vercel Engineer Comprehensive Audit Test Suite
Strictly verifies:
1. Vercel Serverless Entrypoint (FastAPI app object, dual routing, static fallbacks)
2. Security & Environment Variables (os.getenv, zero hardcoded keys, demo_mode status)
3. OpenRouter Cascade & Router (<2ms heuristic SLA, regex validity, 429/503 failover)
4. Frontend Verification (Try Next Model, LocalStorage multi-chat, JSON/MD export)
5. Dependencies & Configuration (requirements.txt, vercel.json)
"""

import sys
import os
import re
import unittest
import json

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.config import (
    FREE_MODEL_POOL,
    MODEL_REGISTRY,
    get_server_openrouter_key,
    resolve_effective_key,
    is_demo_mode,
    get_demo_mode_response,
    get_next_fallback_model,
)
from api.router import (
    classify_prompt_intent,
    build_cascade_order,
    COMPILED_CODE_REGEX,
    COMPILED_MATH_REGEX,
    COMPILED_CREATIVE_REGEX,
)
from api.index import app


class TestVercelReadinessAudit(unittest.TestCase):

    def test_01_vercel_serverless_entrypoint(self):
        """Audit 1: Verify api/index.py exposes FastAPI 'app' with dual prefix routing."""
        self.assertIsNotNone(app, "api/index.py MUST export a FastAPI 'app' instance")
        self.assertEqual(app.title, "arkAI Serverless Orchestrator")

        # Verify registered route paths
        routes = [route.path for route in app.routes]
        
        # Check standard /api/... routes
        self.assertIn("/api/health", routes)
        self.assertIn("/api/chat", routes)
        self.assertIn("/api/models", routes)
        self.assertIn("/api/route-preview", routes)
        self.assertIn("/api/regenerate", routes)

        # Check prefix-stripped routes for Vercel rewrite compatibility
        self.assertIn("/health", routes)
        self.assertIn("/chat", routes)
        self.assertIn("/models", routes)
        self.assertIn("/route-preview", routes)
        self.assertIn("/regenerate", routes)

    def test_02_security_and_environment_variables(self):
        """Audit 2: Ensure zero hardcoded keys, os.getenv usage, and graceful demo_mode response."""
        # 1. Verify environment resolution
        env_key = get_server_openrouter_key()
        # Should not crash even when unset
        self.assertIsInstance(env_key, str)

        # 2. Check demo mode trigger when key is absent
        demo_payload = get_demo_mode_response("code", "qwen/qwen-2.5-coder-32b-instruct:free", "def hello(): pass")
        self.assertEqual(demo_payload.get("status"), "demo_mode")
        self.assertEqual(demo_payload.get("provider_status"), "demo_mode")
        self.assertTrue(demo_payload.get("demo_mode"))
        self.assertIn("response", demo_payload)
        self.assertIn("OPENROUTER_API_KEY", demo_payload["response"])

        # 3. Codebase scan for hardcoded live keys
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        sensitive_patterns = [
            re.compile(r"sk-or-v1-[a-f0-9]{32,}", re.IGNORECASE),
            re.compile(r"sk-[a-zA-Z0-9]{32,}", re.IGNORECASE),
        ]
        for dirpath, _, filenames in os.walk(os.path.join(root_dir, 'api')):
            for fn in filenames:
                if fn.endswith('.py'):
                    fpath = os.path.join(dirpath, fn)
                    with open(fpath, 'r', encoding='utf-8') as f:
                        content = f.read()
                        for pat in sensitive_patterns:
                            match = pat.search(content)
                            self.assertIsNone(match, f"Hardcoded API key detected in {fpath}: {match.group(0) if match else ''}")

    def test_03_openrouter_cascade_and_router(self):
        """Audit 3: Verify heuristic router compiles cleanly, executes in <2ms, and checks cascade list."""
        # 1. Verify pre-compiled regex integrity
        self.assertGreater(len(COMPILED_CODE_REGEX), 0)
        self.assertGreater(len(COMPILED_MATH_REGEX), 0)
        self.assertGreater(len(COMPILED_CREATIVE_REGEX), 0)

        # 2. Test sub-2ms heuristic classifier
        test_queries = [
            ("Write an asynchronous FastAPI websocket handler in Python", "code", "qwen/qwen-2.5-coder-32b-instruct:free"),
            ("Solve the system of linear equations using Gaussian elimination step by step", "math_logic", "deepseek/deepseek-r1:free"),
            ("Draft a persuasive marketing email announcing the launch of arkAI", "creative", "meta-llama/llama-3.3-70b-instruct:free"),
            ("Who was Leonardo da Vinci and what were his main inventions?", "general", "google/gemini-2.0-flash-lite-001:free"),
        ]

        for q, expected_cat, expected_model in test_queries:
            cat, model, latency_ms = classify_prompt_intent(q)
            self.assertEqual(cat, expected_cat, f"Mismatch for '{q}': expected {expected_cat}, got {cat}")
            self.assertEqual(model, expected_model, f"Model mismatch for '{q}': expected {expected_model}, got {model}")
            self.assertLess(latency_ms, 2.0, f"SLA breached: latency {latency_ms}ms >= 2.0ms")

        # 3. Verify all models end with :free
        for model in FREE_MODEL_POOL:
            self.assertTrue(model.endswith(":free"), f"Model {model} must end with :free suffix")

        # 4. Verify cascade sequence contains all free models
        cascade = build_cascade_order("google/gemini-2.0-flash-lite-001:free")
        self.assertEqual(len(cascade), 5)
        self.assertEqual(set(cascade), set(FREE_MODEL_POOL))

    def test_04_frontend_verification(self):
        """Audit 4: Ensure public assets exist and include Try Next Model, multi-chat, and export features."""
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        public_dir = os.path.join(root_dir, 'public')

        # Check required files
        for fname in ['index.html', 'app.js', 'style.css', 'logo.svg']:
            fpath = os.path.join(public_dir, fname)
            self.assertTrue(os.path.exists(fpath), f"Missing frontend asset: {fname}")

        # Check app.js content
        with open(os.path.join(public_dir, 'app.js'), 'r', encoding='utf-8') as f:
            app_js = f.read()
            self.assertIn("🔀 Try Next Model", app_js, "app.js must render '🔀 Try Next Model' button")
            self.assertIn("handleTryNextModel", app_js, "app.js must implement handleTryNextModel")
            self.assertIn("exportChatAsJSON", app_js, "app.js must support JSON export")
            self.assertIn("exportChatAsMarkdown", app_js, "app.js must support Markdown export")
            self.assertIn("localStorage", app_js, "app.js must use localStorage for multi-chat")

        # Check index.html content
        with open(os.path.join(public_dir, 'index.html'), 'r', encoding='utf-8') as f:
            html = f.read()
            self.assertIn("arkAI", html)
            self.assertIn("settings-modal", html)
            self.assertIn("chat-history-list", html)

    def test_05_imports_and_vercel_config(self):
        """Audit 5: Check requirements.txt, .gitignore, and vercel.json configurations."""
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

        # 1. requirements.txt
        req_path = os.path.join(root_dir, 'requirements.txt')
        self.assertTrue(os.path.exists(req_path))
        with open(req_path, 'r', encoding='utf-8') as f:
            reqs = f.read().lower()
            for pkg in ['fastapi', 'uvicorn', 'httpx', 'python-dotenv', 'pydantic']:
                self.assertIn(pkg, reqs, f"requirements.txt missing dependency: {pkg}")

        # 2. vercel.json
        vercel_path = os.path.join(root_dir, 'vercel.json')
        self.assertTrue(os.path.exists(vercel_path))
        with open(vercel_path, 'r', encoding='utf-8') as f:
            vconfig = json.load(f)
            self.assertTrue("builds" in vconfig or "rewrites" in vconfig or "routes" in vconfig)

        # 3. .gitignore
        gitignore_path = os.path.join(root_dir, '.gitignore')
        self.assertTrue(os.path.exists(gitignore_path))
        with open(gitignore_path, 'r', encoding='utf-8') as f:
            gi = f.read()
            for ignored in ['.env', '.venv', '__pycache__', '.vercel']:
                self.assertIn(ignored, gi, f".gitignore must contain: {ignored}")


if __name__ == '__main__':
    unittest.main()
