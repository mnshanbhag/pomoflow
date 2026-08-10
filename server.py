"""Pomoflow Flask backend.

Three JSON endpoints (GET /api/state, POST /api/preferences, POST /api/sessions)
backed by a single progress.json file with atomic writes.
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
PROGRESS_PATH = BASE_DIR / "progress.json"
STATIC_DIR = BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")

# ---------------------------------------------------------------------------
# Defaults & validation bounds (mirror the spec's F1-F6)
# ---------------------------------------------------------------------------

DEFAULTS: dict[str, Any] = {
    "preferences": {
        "focus_minutes": 25,
        "short_break_minutes": 5,
        "long_break_minutes": 15,
        "sessions_before_long_break": 4,
        "sound_enabled": True,
        "notifications_enabled": True,
    },
    "history": [],
    "sessions_completed_today": 0,
    "focus_minutes_today": 0,
    "day_marker": "",
}

BOUNDS = {
    "focus_minutes": (1, 120),
    "short_break_minutes": (1, 30),
    "long_break_minutes": (5, 60),
    "sessions_before_long_break": (2, 10),
}

BOOLEAN_KEYS = {"sound_enabled", "notifications_enabled"}

ALLOWED_PREFERENCE_KEYS = set(BOUNDS) | BOOLEAN_KEYS


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

# The dev server is threaded, so the load -> mutate -> write cycle must be
# serialized; otherwise concurrent POSTs read the same state and the last
# writer silently drops the others' increments.
STATE_LOCK = threading.Lock()


def _today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _seed_state() -> dict[str, Any]:
    state = {**DEFAULTS, "preferences": dict(DEFAULTS["preferences"])}
    state["day_marker"] = _today_str()
    return state


def _load_state() -> dict[str, Any]:
    if not PROGRESS_PATH.exists():
        return _seed_state()
    try:
        with PROGRESS_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        # Corrupt file: start clean rather than crash the app.
        return _seed_state()

    # Backfill any missing keys with defaults.
    merged: dict[str, Any] = {
        **DEFAULTS,
        "preferences": {**DEFAULTS["preferences"], **data.get("preferences", {})},
        "history": list(data.get("history", [])),
    }
    for key in ("sessions_completed_today", "focus_minutes_today", "day_marker"):
        if key in data:
            merged[key] = data[key]
    return merged


def _atomic_write(state: dict[str, Any]) -> None:
    tmp = PROGRESS_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, PROGRESS_PATH)


def _maybe_rollover(state: dict[str, Any]) -> dict[str, Any]:
    """Reset today counters if the calendar day has changed."""
    today = _today_str()
    if state.get("day_marker") != today:
        state["day_marker"] = today
        state["sessions_completed_today"] = 0
        state["focus_minutes_today"] = 0
        # History is global, not per-day — keep it.
    return state


def _clamp_preferences(prefs_in: dict[str, Any]) -> dict[str, Any]:
    """Clamp out-of-range numerics, coerce booleans, drop unknown keys."""
    cleaned: dict[str, Any] = {}
    for key, value in prefs_in.items():
        if key not in ALLOWED_PREFERENCE_KEYS:
            continue
        if key in BOUNDS:
            lo, hi = BOUNDS[key]
            try:
                iv = int(value)
            except (TypeError, ValueError):
                continue
            cleaned[key] = max(lo, min(hi, iv))
        elif key in BOOLEAN_KEYS:
            cleaned[key] = bool(value)
    # Re-apply defaults for anything missing after cleaning.
    out = {**DEFAULTS["preferences"], **cleaned}
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index() -> Any:
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/state", methods=["GET"])
def get_state() -> Any:
    with STATE_LOCK:
        state = _maybe_rollover(_load_state())
        _atomic_write(state)
    return jsonify(state)


@app.route("/api/preferences", methods=["POST"])
def post_preferences() -> Any:
    body = request.get_json(silent=True) or {}
    prefs_in = body.get("preferences")
    if not isinstance(prefs_in, dict):
        return jsonify({"error": "preferences must be an object"}), 400

    with STATE_LOCK:
        state = _maybe_rollover(_load_state())
        # Partial update: merge with current persisted preferences first so that
        # unspecified keys (e.g. toggles) keep the user's existing values.
        merged_in = {**state["preferences"], **prefs_in}
        state["preferences"] = _clamp_preferences(merged_in)
        _atomic_write(state)
    return jsonify(state)


@app.route("/api/sessions", methods=["POST"])
def post_session() -> Any:
    body = request.get_json(silent=True) or {}
    phase = body.get("phase")
    duration = body.get("duration_minutes")
    timestamp = body.get("timestamp")

    if phase not in ("focus", "short_break", "long_break"):
        return jsonify({"error": "phase must be focus|short_break|long_break"}), 400
    try:
        duration_int = int(duration)
    except (TypeError, ValueError):
        return jsonify({"error": "duration_minutes must be an integer"}), 400
    if duration_int <= 0 or duration_int > 180:
        return jsonify({"error": "duration_minutes out of range"}), 400
    if not isinstance(timestamp, str) or not re.match(r"^\d{4}-\d{2}-\d{2}T", timestamp):
        return jsonify({"error": "timestamp must be ISO-8601"}), 400

    with STATE_LOCK:
        state = _maybe_rollover(_load_state())

        history = list(state.get("history", []))
        history.append(
            {"timestamp": timestamp, "phase": phase, "duration_minutes": duration_int}
        )
        state["history"] = history[-10:]  # cap at last 10

        if phase == "focus":
            state["sessions_completed_today"] = int(
                state.get("sessions_completed_today", 0)
            ) + 1
            state["focus_minutes_today"] = int(
                state.get("focus_minutes_today", 0)
            ) + duration_int

        _atomic_write(state)
    return jsonify(state)


if __name__ == "__main__":
    # Spec (N7) pins 3100; PORT overrides it.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "3100")), debug=False)
