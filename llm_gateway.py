"""In-process reliability layer around the multi-provider LLM chain.

`_complete_with_fallback` in V3_updates.py already tries each free model in order
(Groq's free models first, then Gemini). That raw loop worked, but on a bad day it
would keep hammering a provider that was already rate-limited or down — eating a
timeout on every single call before failing over. This module adds the three things
a production LLM gateway is expected to have, around that same chain:

  1. Circuit breaker  — after N consecutive failures a provider is "opened" and
     skipped for a short cooldown, so we fail over INSTANTLY instead of paying the
     failing provider's latency on every request. It half-opens after the cooldown
     and closes again on the first success.
  2. Rate limiter     — a per-provider sliding-window cap keeps us under free-tier
     RPM. When the window is full the provider is skipped (soft) and the next one in
     the chain answers, instead of us earning a hard 429.
  3. Live metrics     — snapshot() exposes each provider's circuit state and counters
     for the Insights dashboard (GET /api/insights/llm).

Design rules:
  * Pure-Python, stdlib only, process-local (a single free-tier instance, so no
    cross-process coordination is needed).
  * Fails OPEN everywhere. A bug in this reliability layer must never be able to
    block a real LLM call — every method swallows its own exceptions, and the caller
    is expected to force-try the full chain if the gateway would skip everything.
"""
from __future__ import annotations

import threading
import time


class _ProviderState:
    __slots__ = ("consecutive_fails", "opened_until", "calls", "successes",
                 "failures", "rate_limit_skips", "breaker_trips", "window")

    def __init__(self) -> None:
        self.consecutive_fails = 0   # resets on any success; drives the breaker
        self.opened_until = 0.0      # epoch until which the circuit stays open
        self.calls = 0               # attempts actually sent to the provider
        self.successes = 0
        self.failures = 0
        self.rate_limit_skips = 0    # times the limiter held this provider back
        self.breaker_trips = 0       # times the breaker opened
        self.window = []             # recent attempt timestamps (rate-limit window)


class LLMGateway:
    """Circuit breaker + rate limiter + counters, keyed by provider name."""

    def __init__(self, *, fail_threshold: int = 4, cooldown_secs: float = 30.0,
                 rpm_limit: int = 25, window_secs: float = 60.0) -> None:
        self.fail_threshold = fail_threshold
        self.cooldown_secs = cooldown_secs
        self.rpm_limit = rpm_limit
        self.window_secs = window_secs
        self._lock = threading.Lock()
        self._providers: dict[str, _ProviderState] = {}

    def _state(self, provider: str) -> _ProviderState:
        s = self._providers.get(provider)
        if s is None:
            s = _ProviderState()
            self._providers[provider] = s
        return s

    # ── decision (consulted before trying a provider) ────────────────────────
    def should_skip(self, provider: str) -> tuple[bool, str]:
        """Return (skip, reason). reason is "circuit_open" | "rate_limited" | ""."""
        try:
            now = time.time()
            with self._lock:
                s = self._state(provider)
                if now < s.opened_until:
                    return True, "circuit_open"
                s.window = [t for t in s.window if now - t < self.window_secs]
                if len(s.window) >= self.rpm_limit:
                    s.rate_limit_skips += 1
                    return True, "rate_limited"
            return False, ""
        except Exception:
            return False, ""  # fail open — never block a call on the gateway's account

    # ── outcome recording ────────────────────────────────────────────────────
    def record_attempt(self, provider: str) -> None:
        try:
            now = time.time()
            with self._lock:
                s = self._state(provider)
                s.calls += 1
                s.window.append(now)
        except Exception:
            pass

    def record_success(self, provider: str) -> None:
        try:
            with self._lock:
                s = self._state(provider)
                s.successes += 1
                s.consecutive_fails = 0
                s.opened_until = 0.0  # close the circuit on any good response
        except Exception:
            pass

    def record_failure(self, provider: str) -> None:
        try:
            with self._lock:
                s = self._state(provider)
                s.failures += 1
                s.consecutive_fails += 1
                if s.consecutive_fails >= self.fail_threshold:
                    s.opened_until = time.time() + self.cooldown_secs
                    s.breaker_trips += 1
                    s.consecutive_fails = 0  # start the cooldown clean
        except Exception:
            pass

    # ── metrics for the Insights dashboard ───────────────────────────────────
    def snapshot(self) -> dict:
        try:
            now = time.time()
            with self._lock:
                providers = {}
                for name, s in self._providers.items():
                    is_open = now < s.opened_until
                    live_window = len([t for t in s.window if now - t < self.window_secs])
                    providers[name] = {
                        "circuit": "open" if is_open else "closed",
                        "opens_in_secs": round(max(0.0, s.opened_until - now), 1),
                        "calls": s.calls,
                        "successes": s.successes,
                        "failures": s.failures,
                        "rate_limit_skips": s.rate_limit_skips,
                        "breaker_trips": s.breaker_trips,
                        "window_used": live_window,
                        "rpm_limit": self.rpm_limit,
                    }
                return {
                    "providers": providers,
                    "config": {
                        "fail_threshold": self.fail_threshold,
                        "cooldown_secs": self.cooldown_secs,
                        "rpm_limit": self.rpm_limit,
                        "window_secs": self.window_secs,
                    },
                }
        except Exception:
            return {"providers": {}, "config": {}}


# Module-level singleton shared by every LLM call in the process.
GATEWAY = LLMGateway()
