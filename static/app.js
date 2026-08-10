/* ------------------------------------------------------------------ *
 * Pomoflow — single-source-of-truth state, drift-free timer driver    *
 * ------------------------------------------------------------------ */

(() => {
  "use strict";

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const DEFAULTS = {
    focus_minutes: 25,
    short_break_minutes: 5,
    long_break_minutes: 15,
    sessions_before_long_break: 4,
    sound_enabled: true,
    notifications_enabled: true,
  };

  const BOUNDS = {
    focus_minutes: [1, 120],
    short_break_minutes: [1, 30],
    long_break_minutes: [5, 60],
    sessions_before_long_break: [2, 10],
  };

  const state = {
    preferences: { ...DEFAULTS },
    phase: "focus",        // 'focus' | 'short_break' | 'long_break'
    phaseIndex: 0,         // number of focus completions since last long break
    running: false,
    endAt: null,           // epoch ms when timer ends; null when paused/idle
    remainingMs: null,     // remaining ms when paused; null when running
    today: {
      sessions_completed: 0,
      focus_minutes: 0,
      history: [],         // last 10
    },
  };

  const PREFS_KEYS = Object.keys(DEFAULTS);

  // ------------------------------------------------------------------
  // DOM lookups
  // ------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const body = document.body;
  const timeDisplay    = $("#time-display");
  const ringProgress   = $("#ring-progress");
  const phaseLabel     = $("#phase-label");
  const cycleDisplay   = $("#cycle-display");
  const startBtn       = $("#start-btn");
  const resetBtn       = $("#reset-btn");
  const skipBtn        = $("#skip-btn");
  const saveBtn        = $("#save-preferences");
  const saveStatus     = $("#save-status");
  const toggleCfgBtn   = $("#toggle-config");
  const configBody     = $("#config-body");
  const configPanel    = $(".config-panel");
  const statSessions   = $("#stat-sessions");
  const statMinutes    = $("#stat-minutes");
  const historyList    = $("#history-list");

  const RING_CIRCUMFERENCE = 2 * Math.PI * 100; // matches r="100" in styles.css

  // ------------------------------------------------------------------
  // Persistence (debounced)
  // ------------------------------------------------------------------
  let prefsSaveTimer = null;
  function savePrefsDebounced() {
    clearTimeout(prefsSaveTimer);
    prefsSaveTimer = setTimeout(savePrefsNow, 600);
  }

  async function savePrefsNow() {
    setSaveStatus("Saving…");
    try {
      const res = await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: state.preferences }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Trust server clamp.
      state.preferences = { ...state.preferences, ...data.preferences };
      setSaveStatus("Saved ✓", "ok");
    } catch (err) {
      setSaveStatus(`Save failed: ${err.message}`, "err");
    }
  }

  async function postSession(phase, durationMinutes) {
    try {
      const timestamp = new Date().toISOString();
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, duration_minutes: durationMinutes, timestamp }),
      });
      if (!res.ok) return; // non-fatal; we'll re-pull on next state refresh
      const data = await res.json();
      hydrateTodayFromServer(data);
      render();
    } catch (_) {
      // Network error — keep running locally; degrade gracefully.
    }
  }

  function hydrateTodayFromServer(server) {
    state.today.sessions_completed = server.sessions_completed_today ?? 0;
    state.today.focus_minutes      = server.focus_minutes_today ?? 0;
    state.today.history            = Array.isArray(server.history) ? server.history : [];
  }

  let saveStatusClearTimer = null;
  function setSaveStatus(text, cls) {
    if (saveStatusClearTimer) {
      clearTimeout(saveStatusClearTimer);
      saveStatusClearTimer = null;
    }
    saveStatus.textContent = text;
    saveStatus.className = "save-status" + (cls ? " " + cls : "");
    if (cls === "ok") {
      saveStatusClearTimer = setTimeout(() => {
        saveStatus.textContent = "";
        saveStatus.className = "save-status";
        saveStatusClearTimer = null;
      }, 1800);
    }
  }

  // ------------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------------
  async function loadInitialState() {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.preferences = { ...DEFAULTS, ...data.preferences };
      hydrateTodayFromServer(data);
    } catch (err) {
      // Network down: keep defaults; user can still configure locally.
      console.warn("Could not load server state:", err);
    }
    // Sync inputs from preferences.
    PREFS_KEYS.forEach((key) => syncInputFromPrefs(key));
    if (state.running) {
      // not possible on fresh load, but be defensive
    } else {
      state.remainingMs = phaseDurationMs(state.phase);
    }
    render();
  }

  // ------------------------------------------------------------------
  // Phase math
  // ------------------------------------------------------------------
  function phaseDurationMs(phase) {
    const mins = state.preferences[`${phase}_minutes`];
    return Math.max(0, mins) * 60 * 1000;
  }

  function nextPhase(current, phaseIndex) {
    if (current === "focus") {
      const n = state.preferences.sessions_before_long_break;
      return phaseIndex % n === 0 ? "long_break" : "short_break";
    }
    return "focus";
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  function render() {
    // Time + ring
    const totalMs = phaseDurationMs(state.phase);
    const remainingMs = state.running && state.endAt
      ? Math.max(0, state.endAt - Date.now())
      : (state.remainingMs != null ? state.remainingMs : totalMs);

    timeDisplay.textContent = formatMS(remainingMs);
    const progress = totalMs > 0 ? 1 - remainingMs / totalMs : 0;
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    ringProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE - offset);
    // also ensure dasharray matches (in case of CSS overrides)
    ringProgress.style.strokeDasharray = String(RING_CIRCUMFERENCE);

    // Phase label
    body.setAttribute("data-phase", state.phase);
    phaseLabel.textContent = labelFor(state.phase);

    // Cycle (current focus index within the long-break set; capped to n)
    const n = state.preferences.sessions_before_long_break;
    const focusNum = (state.phaseIndex % n) + 1;
    const cappedFocusNum = Math.min(focusNum, n);
    cycleDisplay.textContent =
      state.phase === "focus"
        ? `Focus ${cappedFocusNum} / ${n}`
        : state.phase === "long_break"
        ? "Long break earned"
        : "Quick breather";

    // Buttons — "Resume" only when a phase was paused mid-countdown.
    const paused = !state.running &&
                   state.remainingMs != null &&
                   state.remainingMs < totalMs;
    startBtn.textContent = state.running ? "Pause" : (paused ? "Resume" : "Start");
    startBtn.classList.toggle("btn-primary", !state.running);
    startBtn.classList.toggle("btn-secondary", state.running);

    // Stats
    statSessions.textContent = state.today.sessions_completed;
    statMinutes.textContent  = state.today.focus_minutes;
    renderHistory();
  }

  function renderHistory() {
    const items = state.today.history.slice(-10).reverse();
    historyList.innerHTML = "";
    for (const entry of items) {
      const li = document.createElement("li");
      li.className = entry.phase;
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent =
        entry.phase === "focus" ? "FOCUS" :
        entry.phase === "short_break" ? "SHORT" : "LONG";
      const ts = document.createElement("span");
      ts.textContent = formatTimestamp(entry.timestamp);
      li.appendChild(pill);
      li.appendChild(ts);
      historyList.appendChild(li);
    }
  }

  function formatMS(ms) {
    if (ms < 0) ms = 0;
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function labelFor(phase) {
    return phase === "focus" ? "Focus"
         : phase === "short_break" ? "Short break"
         : "Long break";
  }

  function formatTimestamp(iso) {
    try {
      const d = new Date(iso);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${d.getMonth()+1}/${d.getDate()} ${hh}:${mm}`;
    } catch (_) {
      return iso;
    }
  }

  // ------------------------------------------------------------------
  // Timer driver — drift-free, ticks at 250ms
  // ------------------------------------------------------------------
  let tickHandle = null;

  function startTickLoop() {
    stopTickLoop();
    tickHandle = setInterval(onTick, 250);
  }
  function stopTickLoop() {
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
  }

  function onTick() {
    if (!state.running || state.endAt == null) return;
    const remaining = state.endAt - Date.now();
    if (remaining <= 0) {
      onPhaseComplete();
      return;
    }
    // Throttle DOM updates: only render full UI when seconds change,
    // but always update on the boundary. Re-rendering every 250ms is fine
    // for this layout; we keep it simple.
    render();
  }

  // `credit` is false when the user skips: the phase advances and the cycle
  // position moves on, but a skipped focus is not a completed Pomodoro (F11),
  // so it never touches the counters, the history, or the chime.
  function onPhaseComplete({ credit = true } = {}) {
    // Capture the phase that just finished for persistence / feedback.
    const justFinished = state.phase;
    const finishedMinutes = Math.round(phaseDurationMs(justFinished) / 60000);

    if (credit) {
      playChime();
      fireNotification(justFinished);
    }

    // Persist + update local counters for focus completions.
    if (justFinished === "focus") {
      state.phaseIndex += 1;
      if (credit) {
        state.today.sessions_completed += 1;
        state.today.focus_minutes += finishedMinutes;
        postSession("focus", finishedMinutes);
      }
    }
    // For breaks we don't bump the on-disk counter (only focus counts).

    // Advance phase.
    state.phase = nextPhase(justFinished, state.phaseIndex);
    state.remainingMs = phaseDurationMs(state.phase);
    if (state.running) {
      state.endAt = Date.now() + state.remainingMs;
    }
    render();
  }

  // ------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------
  startBtn.addEventListener("click", () => {
    if (state.running) {
      // Pause
      state.remainingMs = Math.max(0, state.endAt - Date.now());
      state.endAt = null;
      state.running = false;
      stopTickLoop();
    } else {
      // Start / Resume
      if (state.remainingMs == null || state.remainingMs <= 0) {
        state.remainingMs = phaseDurationMs(state.phase);
      }
      state.endAt = Date.now() + state.remainingMs;
      state.running = true;
      // Ask for notification permission on first focus start, if user opted in.
      if (state.phase === "focus" &&
          state.preferences.notifications_enabled &&
          "Notification" in window &&
          Notification.permission === "default") {
        try { Notification.requestPermission(); } catch (_) {}
      }
      startTickLoop();
    }
    render();
  });

  resetBtn.addEventListener("click", () => {
    state.running = false;
    state.endAt = null;
    state.remainingMs = phaseDurationMs(state.phase);
    stopTickLoop();
    render();
  });

  skipBtn.addEventListener("click", () => {
    // Skip advances to the next phase immediately (F9) whether running or
    // paused. It never credits stats — the phase wasn't completed.
    onPhaseComplete({ credit: false });
  });

  // ------------------------------------------------------------------
  // Preferences UI wiring
  // ------------------------------------------------------------------
  function syncInputFromPrefs(key) {
    const el = document.getElementById(key);
    if (!el) return;
    const value = state.preferences[key];
    el.value = (typeof value === "boolean") ? (value ? "true" : "false") : String(value);
    el.checked = typeof value === "boolean" ? value : el.checked;
  }

  function bindNumericStepper(key) {
    const input = document.getElementById(key);
    if (!input) return;
    const [lo, hi] = BOUNDS[key];
    input.min = String(lo);
    input.max = String(hi);

    input.addEventListener("input", () => {
      let v = parseInt(input.value, 10);
      if (Number.isNaN(v)) v = lo;
      v = Math.max(lo, Math.min(hi, v));
      state.preferences[key] = v;
      // Reset remaining time to reflect new duration if paused/idle.
      if (!state.running && state.phase === phaseForPrefKey(key)) {
        state.remainingMs = phaseDurationMs(state.phase);
      }
      render();
      savePrefsDebounced();
    });
  }

  function phaseForPrefKey(key) {
    // sessions_before_long_break maps to no phase: changing the cycle length
    // must not reset the countdown currently on screen.
    return ({
      focus_minutes: "focus",
      short_break_minutes: "short_break",
      long_break_minutes: "long_break",
    })[key] ?? null;
  }

  PREFS_KEYS.filter((k) => BOUNDS[k]).forEach(bindNumericStepper);

  // ± buttons
  document.querySelectorAll(".stepper-control button[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-target");
      const step = parseInt(btn.getAttribute("data-step"), 10);
      const [lo, hi] = BOUNDS[key];
      const cur = parseInt(document.getElementById(key).value, 10) || lo;
      const next = Math.max(lo, Math.min(hi, cur + step));
      state.preferences[key] = next;
      document.getElementById(key).value = String(next);
      if (!state.running && state.phase === phaseForPrefKey(key)) {
        state.remainingMs = phaseDurationMs(state.phase);
      }
      render();
      savePrefsDebounced();
    });
  });

  // Toggles
  document.getElementById("sound_enabled").addEventListener("change", (e) => {
    state.preferences.sound_enabled = e.target.checked;
    savePrefsDebounced();
  });
  document.getElementById("notifications_enabled").addEventListener("change", (e) => {
    state.preferences.notifications_enabled = e.target.checked;
    savePrefsDebounced();
    if (e.target.checked &&
        "Notification" in window &&
        Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (_) {}
    }
  });

  // Explicit save button (force-flush the debounce + show status)
  saveBtn.addEventListener("click", () => {
    clearTimeout(prefsSaveTimer);
    savePrefsNow();
  });

  // Collapse/expand config drawer
  toggleCfgBtn.addEventListener("click", () => {
    const collapsed = configPanel.classList.toggle("is-collapsed");
    toggleCfgBtn.setAttribute("aria-expanded", String(!collapsed));
    if (window.innerWidth <= 700 && !collapsed) {
      configPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  if (window.innerWidth <= 700) {
    configPanel.classList.add("is-collapsed");
    toggleCfgBtn.setAttribute("aria-expanded", "false");
  }

  // ------------------------------------------------------------------
  // Audio (synthesized chime via WebAudio)
  // ------------------------------------------------------------------
  let audioCtx = null;
  function getAudio() {
    if (audioCtx) return audioCtx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    } catch (_) {
      audioCtx = null;
    }
    return audioCtx;
  }
  function playChime() {
    if (!state.preferences.sound_enabled) return;
    const ctx = getAudio();
    if (!ctx) return;
    // Resume if suspended (autoplay policy).
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const tone = (freq, start, dur, gain = 0.18) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + start);
      g.gain.linearRampToValueAtTime(gain, now + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };
    // Two-note ascending chime for completion.
    tone(660, 0.00, 0.25);
    tone(880, 0.18, 0.35);
  }

  function fireNotification(phase) {
    if (!state.preferences.notifications_enabled) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const title =
      phase === "focus" ? "Focus complete — time for a break 🍵" :
      phase === "short_break" ? "Break over — back to focus 🔥" :
      "Long break over — well done ✨";
    try {
      new Notification("Pomoflow", { body: title, silent: true });
    } catch (_) { /* some browsers throw when called from background tabs */ }
  }

  // ------------------------------------------------------------------
  // Keyboard shortcuts
  // ------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return; // don't hijack typing
    if (e.key === " ") {
      e.preventDefault();
      startBtn.click();
    } else if (e.key === "r" || e.key === "R") {
      resetBtn.click();
    } else if (e.key === "s" || e.key === "S") {
      skipBtn.click();
    }
  });

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  loadInitialState();
})();
