# 🚀 arkAI — Orchestrated Chatbot (Free Multi-Model AI)

**ARK Ecosystem | CodeAlpha_AIChatbot**

arkAI is an **orchestrated chatbot**: it is **not tied to any single AI company** and needs **no API key at all** to work. Every question is classified locally in **under 2 milliseconds**, then dispatched to the **best available free AI model** for that kind of question, through free anonymous AI gateways. If a model is busy, arkAI automatically cascades to the next best model — the conversation never drops.

---

## ✨ What changed in v4

| Feature | How it works |
| :--- | :--- |
| **No API dependency** | Default mode uses free anonymous gateways — **Pollinations** and **LLM7** — not Gemini, not OpenRouter, not any single vendor. Zero keys, zero cost, zero setup for every user. |
| **Best model per question** | A sub-2ms heuristic router classifies each prompt (code / maths & logic / creative / general) and ranks the free model catalog per intent. Code goes to DeepSeek first, general questions to GPT-OSS, creative work to GLM Flash, and so on. |
| **Regenerate (model hop)** | Every AI reply has a **Regenerate** button. It re-asks the *same* question on the **next best model that has not answered it yet** — repeated clicks keep hopping to fresh models, never a repeat. |
| **Download any reply** | Every AI reply can be downloaded as **PDF** or **Word (.docx)**. Both are professionally designed with the **arkAI logo at the top of every page**, the model used, the question, and page numbers. |
| **Model always shown** | Every answer ends with the exact model (and gateway) that produced it. |
| **Clean Settings** | One choice: **arkAI Models** (free, orchestrated, recommended) *or* **Use My Own API Key** — in which case **only** that provider's models are used. No deployment steps, no vendor guides. |

## 🧠 Free model catalog (default mode)

| Logical model | Gateway | Best at |
| :--- | :--- | :--- |
| GPT-OSS 20B | Pollinations (anonymous) | Reasoning, general, maths |
| DeepSeek V4 Flash | LLM7 (anonymous) | Code, deep reasoning |
| GLM 5.3 Flash | LLM7 (anonymous) | General, creative, speed |
| GPT-OSS 20B (LLM7 route) | LLM7 (anonymous) | A genuinely different route for Regenerate |

> Gateways are interchangeable: adding a new free gateway or model is a one-line catalog entry in `api/config.py` / `src/orchestrator.ts`. Anonymous gateway quotas are shared per IP — when one is exhausted, the cascade simply moves on.

## 🏗️ Architecture

```
User → React UI (src/App.tsx)
        │  POST /api/chat        (Regenerate → POST /api/regenerate)
        ▼
FastAPI orchestrator (api/)  ── also mirrored in TypeScript (server.ts + src/orchestrator.ts) for local dev
        │  1. Local pattern engine (data/patterns.json) — instant FAQ answers
        │  2. Heuristic classifier (<2ms) — code / math_logic / creative / general
        │  3. Ranked free models for the intent → call gateway → cascade on 429/503/timeout/quota
        ▼
Pollinations · LLM7   (free, anonymous, no key)
        — or, in Own-Key mode only: the user's own provider, exclusively —
```

- **Frontend:** React 19 + Vite + Tailwind (`src/App.tsx`), export engine in `src/export.ts` (jsPDF + docx).
- **Backend:** FastAPI (`api/index.py`, `api/router.py`, `api/config.py`), deployed as a Vercel service from `CodeAlpha_AIChatbot/` (kept in sync with the root `api/`).
- **Endpoints:** `GET /api/health`, `GET /api/models`, `POST /api/route-preview`, `POST /api/chat`, `POST /api/regenerate` (body: `message`, `current_model`, `tried_models[]`).
- **Every response** includes `model_used`, `model_name`, `gateway_name`, `routing_time_ms`, `total_latency_ms`, `failover_history`, `next_model`, `tried_models`.

## 🔑 Own-Key mode (optional)

In **Settings → Use My Own API Key**, a user may paste a key from OpenAI, Claude, Gemini, Grok, DeepSeek, Meta (Groq), Qwen or OpenRouter. The provider is auto-detected from the key, and arkAI then uses **only that provider's models**. The key is stored only in the user's browser. Leaving Settings on **arkAI Models** restores free orchestration instantly.

## 🧪 Tests

```bash
npm test                                   # TypeScript suites (needs the dev server for endpoint suites)
python3 -m unittest tests/test_router.py   # Router, catalog, regenerate-hop logic
python3 -m unittest tests/test_audit.py    # Full readiness audit
```

## 🚀 Run locally

```bash
npm install --legacy-peer-deps
npm run dev        # React + Express orchestrator on :3000
# or the Python backend:
pip install -r requirements.txt
uvicorn api.index:app --port 8000
```

No environment variables are required. Deploy to Vercel as before — the owner republishes; no keys need to be configured in the project settings for the default free mode.

**License:** MIT
