"""
arkAI - QA Lead Comprehensive Audit Test Suite (v4 Orchestrator)
1. Serverless Entrypoint (FastAPI app, dual routing, static fallbacks)
2. Security (zero hardcoded keys, NO server key required, no demo mode)
3. Free Orchestrator & Router (<2ms SLA, regex validity, cascade rankings)
4. Frontend Verification (Regenerate, PDF/Word export, model label)
5. Dependencies & Configuration (requirements.txt, vercel.json)
"""
import sys, os, re, unittest, json
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.config import MODEL_CATALOG, FREE_GATEWAYS, is_demo_mode
from api.router import classify_prompt_intent, COMPILED_CODE_REGEX, COMPILED_MATH_REGEX, COMPILED_CREATIVE_REGEX
from api.index import app


class TestReadinessAudit(unittest.TestCase):

    def test_01_serverless_entrypoint(self):
        self.assertIsNotNone(app)
        self.assertEqual(app.title, "arkAI Orchestrated Chatbot")
        routes = [getattr(route, "path", "") for route in app.routes]
        # newer FastAPI stores included routers lazily - expand them too
        for route in app.routes:
            orig = getattr(route, "original_router", None)
            if orig is not None:
                prefix = getattr(getattr(route, "include_context", None), "prefix", "") or ""
                routes += [prefix + getattr(x, "path", "") for x in orig.routes]
        for p in ("/api/health", "/api/chat", "/api/models", "/api/route-preview", "/api/regenerate",
                  "/health", "/chat", "/models", "/route-preview", "/regenerate"):
            self.assertIn(p, routes)

    def test_02_security_no_keys_needed(self):
        self.assertFalse(is_demo_mode())
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        sensitive = [re.compile(r"sk-or-v1-[a-f0-9]{32,}"), re.compile(r"sk-[a-zA-Z0-9]{40,}")]
        for dirpath, _, filenames in os.walk(os.path.join(root_dir, 'api')):
            for fn in filenames:
                if fn.endswith('.py'):
                    content = open(os.path.join(dirpath, fn), encoding='utf-8').read()
                    for pat in sensitive:
                        self.assertIsNone(pat.search(content), f"Hardcoded key in {fn}")
        # default mode must not depend on Gemini or OpenRouter env keys
        config_src = open(os.path.join(root_dir, 'api', 'config.py'), encoding='utf-8').read()
        self.assertIn("pollinations", config_src)
        self.assertIn("llm7", config_src)
        for gw in FREE_GATEWAYS.values():
            self.assertFalse(gw["requires_key"])

    def test_03_orchestrator_router(self):
        self.assertGreater(len(COMPILED_CODE_REGEX), 0)
        self.assertGreater(len(COMPILED_MATH_REGEX), 0)
        self.assertGreater(len(COMPILED_CREATIVE_REGEX), 0)
        cases = [
            ("Write an asynchronous FastAPI websocket handler in Python", "code", "llm7/deepseek-v4-flash"),
            ("Solve the system of linear equations using Gaussian elimination step by step", "math_logic", "llm7/deepseek-v4-flash"),
            ("Draft a persuasive marketing email announcing the launch of arkAI", "creative", "llm7/glm-5.3-flash"),
            ("Who was Leonardo da Vinci and what were his main inventions?", "general", "pollinations/gpt-oss-20b"),
        ]
        for q, cat_exp, model_exp in cases:
            cat, model, ms = classify_prompt_intent(q)
            self.assertEqual(cat, cat_exp, q)
            self.assertEqual(model, model_exp, q)
            self.assertLess(ms, 2.0)

    def test_04_frontend_verification(self):
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        for fname in ('index.html', 'app.js', 'style.css', 'logo.svg'):
            self.assertTrue(os.path.exists(os.path.join(root_dir, 'public', fname)), fname)
        app_js = open(os.path.join(root_dir, 'public', 'app.js'), encoding='utf-8').read()
        self.assertIn("handleTryNextModel", app_js)
        self.assertIn("/api/regenerate", app_js)
        self.assertIn("localStorage", app_js)
        # React app: regenerate, per-reply PDF/Word download, model label, cleaned settings
        app_tsx = open(os.path.join(root_dir, 'src', 'App.tsx'), encoding='utf-8').read()
        self.assertIn("handleRegenerate", app_tsx)
        self.assertIn("Download as PDF", app_tsx)
        self.assertIn("Download as Word", app_tsx)
        self.assertIn("Model used:", app_tsx)
        self.assertIn("arkAI Models (Recommended)", app_tsx)
        self.assertIn("Use My Own API Key", app_tsx)
        self.assertNotIn("Vercel Deployment & Key Safety Guide", app_tsx)
        export_ts = open(os.path.join(root_dir, 'src', 'export.ts'), encoding='utf-8').read()
        self.assertIn("downloadAnswerPdf", export_ts)
        self.assertIn("downloadAnswerDocx", export_ts)
        self.assertIn("logo", export_ts.lower())

    def test_05_imports_and_config(self):
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        reqs = open(os.path.join(root_dir, 'requirements.txt'), encoding='utf-8').read().lower()
        for pkg in ('fastapi', 'uvicorn', 'httpx', 'python-dotenv', 'pydantic'):
            self.assertIn(pkg, reqs)
        vconfig = json.load(open(os.path.join(root_dir, 'vercel.json'), encoding='utf-8'))
        self.assertTrue("rewrites" in vconfig or "services" in vconfig)
        gi = open(os.path.join(root_dir, '.gitignore'), encoding='utf-8').read()
        for ignored in ('.env', '__pycache__'):
            self.assertIn(ignored, gi)
        pkg = json.load(open(os.path.join(root_dir, 'package.json'), encoding='utf-8'))
        self.assertIn('jspdf', pkg['dependencies'])
        self.assertIn('docx', pkg['dependencies'])
        self.assertNotIn('@google/genai', pkg.get('dependencies', {}))


if __name__ == '__main__':
    unittest.main()
