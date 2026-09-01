# Agent Sentinel: AI Cognitive Supervisor Agent Instructions

When the user opens this repository in an AI coding assistant (Antigravity, Cursor, Windsurf, Claude, etc.) and says **"proceed"**, **"start monitoring"**, or invokes **/goal**, you must execute the following end-to-end cognitive supervision workflow:

---

## 1. Start the Sentinel Web Server & Daemon
1. Check if the server is already running on port 3456:
   ```bash
   node -e "fetch('http://localhost:3456/api/status').then(r => r.json()).then(console.log).catch(() => console.log('offline'))"
   ```
2. If offline, start the server as a daemon process:
   ```bash
   node server.js
   ```
   The web dashboard will be immediately accessible at **http://localhost:3456**.

---

## 2. LLM Cognitive Supervision Loop (Token-Optimized Differential Checks)
**DO NOT rely on simplistic regexes to classify agent states.**
As an intelligent LLM, you are the Cognitive Supervisor. To maximize speed and minimize token consumption:

1. Fetch pending/changed agent contexts from the server:
   ```bash
   GET http://localhost:3456/api/raw-agent-context?onlyChanged=true
   ```
   *If `pendingCount === 0` and no agents have new turns, immediately end the check with zero redundant token usage.*

2. For any agents returned in `agents` (newly discovered or active changes):
   - Understand the semantics of the prompt, tool usage, error messages, and responses.
   - Accurately determine if the agent is:
     - `ACTIVE`: actively executing tools, computing, or writing code.
     - `IDLE`: completed its task, waiting for user instructions.
     - `LIMITED`: encountered a session rate limit, 5-hour ceiling, or weekly quota limit.
   - If limited, extract the exact timezone-aware reset timestamp (e.g. `resets 5:00 PM EST` or `resets Monday 9:00 AM`).

3. Post cognitive evaluations for the changed agents to the dashboard server:
   ```javascript
   POST http://localhost:3456/api/supervisor/submit-evaluation
   Content-Type: application/json
   [
     {
       "sessionId": "agent-uuid",
       "status": "ACTIVE" | "IDLE" | "LIMITED",
       "isLimited": boolean,
       "summary": "Short 1-sentence human-readable status",
       "llmReasoning": "Detailed cognitive explanation of what the agent is currently doing",
       "limitDetails": {
         "kind": "session_limit" | "weekly_limit",
         "resetAtMs": 1788264000000,
         "resetAtIso": "2026-09-01T17:00:00.000Z"
       }
     }
   ]
   ```

---

## 3. Autonomous Prompt Modes & Verification
Sentinel features three intelligent autonomous prompting modes configurable globally or overridden per agent:

1. **Auto Continue (`continue`)**:
   - Automatically triggered when an agent reaches its quota/rate limit reset timestamp.

2. **Auto Fix (The Ultimate Adversarial Bug-Free & Pixel-Perfect Hardening Loop)**:
   - When an agent completes its primary task, Sentinel detects session completion and dispatches the multi-pass review loop:
     > *"Perform an exhaustive adversarial code & visual hardening audit:*
     > *1. Multi-Dimensional Adversarial Review: Adopt a red-team mindset (or spawn adversarial subagents) to stress-test edge cases, input validation, concurrency boundaries, and verify strict adherence to specifications without charitable assumptions.*
     > *2. Bug & Functional Integrity: Meticulously review all modified/related files to guarantee 100% bug-free behavior, type safety, test passing, and edge-case resilience.*
     > *3. Pixel-Perfect Visual & UX Scrutiny: Inspect UI components, styles, animations, and layouts for responsiveness and visual polish.*
     > *4. Regression & Diff Verification: Inspect git diffs to ensure zero regressions and no unintended side effects.*
     > *5. Multi-Pass Convergence Loop: Continue independent review passes in a loop until no further issues or improvements remain."*

3. **Auto Improve (Deep Architecture, Performance & Polish Optimization - Risky)**:
   - When an agent completes its task and `Auto improve` is enabled, Sentinel prompts the agent to perform deep latency profiling, memory optimization, modular refactoring, resilience edge-case guards, and UX/UI refinement.

The verification engine monitors transcript growth and active tool streams before confirming `VERIFIED_RUNNING`.

---

## 4. Power Management & Hibernation
- If the user has enabled **Hibernate on Weekly Limit** in the Settings menu (or `config.json`), and an agent is diagnosed with a `weekly_limit`, Sentinel initiates a 30-second warning countdown and hibernates the PC via `shutdown /h` to conserve power.

---

## 5. Recurring Schedule
Schedule a recurring 2-minute timer via the `schedule` tool:
```json
{
  "CronExpression": "*/2 * * * *",
  "Prompt": "Perform LLM Cognitive Supervision check: inspect latest Claude Code agent transcript turns, interpret messages for session/weekly limits, trigger 'continue' if limit reset time arrived, verify running status, and post LLM evaluation updates to the dashboard server at http://localhost:3456."
}
```

---

## 6. Server Shutdown & Exit Policy
- If the Sentinel server is offline, down, or was explicitly stopped/logged out by the user via the dashboard/API (`/api/shutdown`), the agent **MUST NOT** attempt to restart the server.
- Immediately cancel/kill all running recurring cron schedules (`manage_task` kill), terminate any background tasks, and gracefully end the turn without performing further checks.
