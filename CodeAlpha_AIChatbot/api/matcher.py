"""
arkAI Sub-1ms Pattern Matcher (Layer 1)
High-speed intent resolution using rapidfuzz string similarity and exact trigger caching.
If similarity ratio > 85%, resolves instantly with source="pattern".
"""

import json
import time
import string
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

try:
    from rapidfuzz import fuzz, process
    RAPIDFUZZ_AVAILABLE = True
except ImportError:
    import difflib
    RAPIDFUZZ_AVAILABLE = False

from .config import settings

logger = logging.getLogger("arkai.matcher")
PUNCTUATION_TRANSLATOR = str.maketrans("", "", string.punctuation)


class PatternMatcher:
    """Sub-millisecond commercial FAQ and pattern matching engine."""

    def __init__(self, patterns_path: Optional[str] = None):
        self.patterns_path = patterns_path or self._locate_patterns_file()
        self.intents: List[Dict[str, Any]] = []
        self.trigger_index: Dict[str, Dict[str, Any]] = {}
        self.all_triggers: List[str] = []
        self.load_patterns()

    def _locate_patterns_file(self) -> str:
        """Finds patterns.json across relative runtime directories."""
        current = Path(__file__).resolve().parent
        candidates = [
            current.parent / "data" / "patterns.json",
            current.parent.parent / "data" / "patterns.json",
            Path("data/patterns.json"),
            Path("CodeAlpha_AIChatbot/data/patterns.json"),
        ]
        for c in candidates:
            if c.exists():
                return str(c)
        return str(current.parent / "data" / "patterns.json")

    def normalize(self, text: str) -> str:
        """Normalizes query text: lowercase, remove punctuation, collapse whitespace."""
        if not text:
            return ""
        cleaned = text.lower().translate(PUNCTUATION_TRANSLATOR)
        return " ".join(cleaned.split())

    def load_patterns(self) -> None:
        """Loads and pre-indexes intent knowledge base."""
        start_ns = time.perf_counter_ns()
        try:
            p_file = Path(self.patterns_path)
            if not p_file.exists():
                logger.warning(f"Patterns file missing at {self.patterns_path}")
                self.intents = []
                return

            with open(p_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            self.intents = data.get("intents", [])
            self.trigger_index.clear()
            self.all_triggers.clear()

            for item in self.intents:
                triggers = item.get("triggers", [])
                for trig in triggers:
                    norm = self.normalize(trig)
                    if norm:
                        self.trigger_index[norm] = item
                        self.all_triggers.append(norm)

            elapsed_ms = (time.perf_counter_ns() - start_ns) / 1_000_000.0
            logger.info(f"Loaded {len(self.intents)} intents, {len(self.all_triggers)} triggers in {elapsed_ms:.2f}ms.")
        except Exception as e:
            logger.error(f"Error loading patterns: {e}")

    def match(self, query: str, threshold: float = 85.0) -> Optional[Dict[str, Any]]:
        """
        Matches query against commercial intents.
        If similarity > 85%, returns response payload with source='pattern'.
        Otherwise returns None.
        """
        start_ns = time.perf_counter_ns()
        normalized_query = self.normalize(query)

        if not normalized_query or not self.all_triggers:
            return None

        # 1. Exact Trigger O(1) Fast-Path (<30 microseconds)
        if normalized_query in self.trigger_index:
            matched_intent = self.trigger_index[normalized_query]
            elapsed_micros = (time.perf_counter_ns() - start_ns) / 1000.0
            return {
                "matched": True,
                "source": "pattern",
                "intent": matched_intent.get("intent"),
                "confidence": 100.0,
                "matched_trigger": normalized_query,
                "response": matched_intent.get("response"),
                "follow_up_suggestions": matched_intent.get("follow_up_suggestions", []),
                "latency_micros": round(elapsed_micros, 2),
                "latency_ms": round(elapsed_micros / 1000.0, 4)
            }

        # 2. RapidFuzz String Matching (>85% similarity ratio)
        best_trigger = None
        best_ratio = 0.0

        if RAPIDFUZZ_AVAILABLE:
            match_candidate = process.extractOne(
                normalized_query,
                self.all_triggers,
                scorer=fuzz.token_sort_ratio
            )
            if match_candidate:
                best_trigger, best_ratio, _ = match_candidate
        else:
            import difflib
            for trig in self.all_triggers:
                ratio = difflib.SequenceMatcher(None, normalized_query, trig).ratio() * 100.0
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_trigger = trig

        # Check if similarity exceeds the 85% requirement
        if best_trigger and best_ratio > threshold:
            matched_intent = self.trigger_index[best_trigger]
            elapsed_micros = (time.perf_counter_ns() - start_ns) / 1000.0
            return {
                "matched": True,
                "source": "pattern",
                "intent": matched_intent.get("intent"),
                "confidence": round(best_ratio, 2),
                "matched_trigger": best_trigger,
                "response": matched_intent.get("response"),
                "follow_up_suggestions": matched_intent.get("follow_up_suggestions", []),
                "latency_micros": round(elapsed_micros, 2),
                "latency_ms": round(elapsed_micros / 1000.0, 4)
            }

        # No match exceeding 85% threshold
        return None


matcher = PatternMatcher()
