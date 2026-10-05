"""
arkAI Generative AI Bridge (Layer 2)
Integrates with Google GenAI SDK (google-genai) using Gemini Flash models.
Includes safe fallbacks, zero-crash error handling for missing keys, rate limits, and network timeouts.
"""

import os
import logging
from typing import Dict, Any, Optional

from .config import settings

logger = logging.getLogger("arkai.ai_engine")

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    logger.warning("google-genai SDK not installed in environment.")


class GenerativeAIEngine:
    """Enterprise Gemini Flash bridge with comprehensive exception handling."""

    def __init__(self):
        self.client: Optional[Any] = None
        self._init_client()

    def _init_client(self) -> None:
        """Initializes client if valid API key is available."""
        if not GENAI_AVAILABLE:
            return

        api_key = os.getenv("GEMINI_API_KEY") or settings.GEMINI_API_KEY
        if api_key and api_key.strip() not in ("", "MY_GEMINI_API_KEY", "your_gemini_api_key_here"):
            try:
                self.client = genai.Client(
                    api_key=api_key.strip(),
                    http_options={"headers": {"User-Agent": "arkAI-Engine/2.0"}}
                )
                logger.info(f"Initialized Google GenAI client targeting {settings.GEMINI_MODEL}.")
            except Exception as e:
                logger.error(f"Failed to initialize GenAI client: {e}")
                self.client = None
        else:
            self.client = None

    async def generate(
        self,
        message: str,
        session_id: Optional[str] = None,
        custom_system_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes generative completion using Gemini Flash.
        Guarantees safe 200 response without crashing on missing keys, rate limits, or timeouts.
        """
        api_key = os.getenv("GEMINI_API_KEY") or settings.GEMINI_API_KEY

        # Check for missing API Key safely
        if not api_key or api_key.strip() in ("", "MY_GEMINI_API_KEY", "your_gemini_api_key_here"):
            return {
                "response": (
                    "**arkAI Setup Notice**: The local pattern engine did not find a direct FAQ match, "
                    "and `GEMINI_API_KEY` is not configured in your environment. "
                    "Please configure your Gemini API Key in your Vercel project environment variables "
                    "(or in the AI Studio Settings > Secrets panel) to enable generative AI reasoning."
                ),
                "source": "diagnostic",
                "status": "unconfigured_key",
                "model": "offline-fallback"
            }

        if not self.client:
            self._init_client()

        if not self.client:
            return {
                "response": (
                    "**arkAI Notice**: The generative reasoning service is currently initializing or unreachable. "
                    "Please verify your `GEMINI_API_KEY` in settings and retry."
                ),
                "source": "diagnostic",
                "status": "client_error",
                "model": "offline-fallback"
            }

        # System Instruction for arkAI
        system_instruction = (
            custom_system_prompt
            or settings.DEFAULT_SYSTEM_PROMPT
            or "You are arkAI, an ultra-capable, professional, and intelligent commercial assistant."
        )

        try:
            config = types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
                max_output_tokens=1024,
            )

            # Target Gemini Flash model (gemini-2.5-flash or configured)
            response = self.client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=message,
                config=config,
            )

            answer_text = response.text or "I was unable to formulate a response to that question."
            return {
                "response": answer_text,
                "source": "ai",
                "status": "success",
                "model": settings.GEMINI_MODEL
            }

        except Exception as e:
            err_str = str(e).lower()
            logger.error(f"GenAI generation exception: {e}")

            # Safe error handling for rate limits or network timeouts
            if "resource_exhausted" in err_str or "quota" in err_str or "429" in err_str:
                return {
                    "response": "⚠️ **Rate Limit**: The AI service is experiencing high request volume. Please wait a moment before trying again.",
                    "source": "ai_rate_limited",
                    "status": "rate_limited",
                    "model": settings.GEMINI_MODEL
                }
            elif "deadline_exceeded" in err_str or "timeout" in err_str:
                return {
                    "response": "⏱️ **Network Timeout**: The reasoning request timed out while communicating with upstream services. Please retry.",
                    "source": "ai_timeout",
                    "status": "timeout",
                    "model": settings.GEMINI_MODEL
                }
            elif "api_key" in err_str or "unauthenticated" in err_str or "401" in err_str or "403" in err_str:
                return {
                    "response": "🔑 **Invalid API Key**: The provided `GEMINI_API_KEY` was not accepted. Please verify your credentials in your Vercel or environment settings.",
                    "source": "diagnostic",
                    "status": "invalid_key",
                    "model": settings.GEMINI_MODEL
                }

            return {
                "response": f"⚠️ An error occurred while generating the response: {str(e)}",
                "source": "error",
                "status": "error",
                "model": settings.GEMINI_MODEL
            }


ai_engine = GenerativeAIEngine()
