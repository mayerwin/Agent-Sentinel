/**
 * Agent-Sentinel Server
 * AI Cognitive Supervisor & Auto-Resume Monitor for Claude Code Agents
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync, exec } = require('child_process');

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]:', reason);
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3456;
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const AM_DIR = 'C:\\Users\\erwin\\Dropbox\\Projects\\GitHub\\Agent-Manager';
const AM_QUEUE_DIR = path.join(AM_DIR, '.data', 'queue');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const EVENTS_FILE = path.join(__dirname, 'events.jsonl');
const RESUMES_FILE = path.join(__dirname, 'resumes.json');
const SENTINEL_DIR = path.resolve(__dirname).toLowerCase();

function isSentinelPathOrFolder(cwd, projectFolder) {
  if (cwd) {
    try {
      const normCwd = path.resolve(cwd).toLowerCase();
      if (normCwd === SENTINEL_DIR ||
          normCwd.startsWith(SENTINEL_DIR + path.sep.toLowerCase()) ||
          normCwd.startsWith(SENTINEL_DIR + '/') ||
          normCwd.endsWith('agent-sentinel')) {
        return true;
      }
    } catch (e) {}
  }
  if (projectFolder) {
    const pLower = projectFolder.toLowerCase();
    const encodedSentinel = SENTINEL_DIR.replace(/^([a-z]):\\?/, '$1--').replace(/\\|\//g, '-');
    if (pLower === encodedSentinel ||
        pLower.startsWith(encodedSentinel + '-') ||
        pLower.endsWith('-agent-sentinel') ||
        pLower === 'agent-sentinel' ||
        pLower.includes('-agent-sentinel-')) {
      return true;
    }
  }
  return false;
}

function reconstructCwdFromProjectFolder(projectFolder) {
  if (!projectFolder || typeof projectFolder !== 'string') return '';
  const driveMatch = projectFolder.match(/^([a-zA-Z])--(.*)$/);
  if (!driveMatch) return projectFolder;

  const drive = driveMatch[1].toUpperCase() + ':\\';
  const rest = driveMatch[2];
  const tokens = rest.split('-');
  let currentPath = drive;
  let i = 0;

  while (i < tokens.length) {
    let matchedSegment = null;
    for (let j = tokens.length; j > i; j--) {
      const segHyphen = tokens.slice(i, j).join('-');
      const segSpace = tokens.slice(i, j).join(' ');
      if (fs.existsSync(path.join(currentPath, segHyphen))) {
        matchedSegment = segHyphen;
        currentPath = path.join(currentPath, segHyphen);
        i = j;
        break;
      }
      if (fs.existsSync(path.join(currentPath, segSpace))) {
        matchedSegment = segSpace;
        currentPath = path.join(currentPath, segSpace);
        i = j;
        break;
      }
    }
    if (!matchedSegment) {
      currentPath = path.join(currentPath, tokens[i]);
      i++;
    }
  }
  return currentPath;
}

function findClaudeBinary() {
  const roots = [
    path.join(HOME, '.vscode', 'extensions'),
    path.join(HOME, '.cursor', 'extensions'),
    path.join(HOME, '.windsurf', 'extensions'),
    path.join(HOME, 'AppData', 'Roaming', 'Claude', 'claude-code')
  ];
  const candidates = [];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const names = fs.readdirSync(root);
      for (const name of names) {
        if (!name.startsWith('anthropic.claude-code-') && !name.includes('claude')) continue;
        const bin1 = path.join(root, name, 'resources', 'native-binary', 'claude.exe');
        if (fs.existsSync(bin1)) candidates.push(bin1);
        const bin2 = path.join(root, name, 'claude.exe');
        if (fs.existsSync(bin2)) candidates.push(bin2);
      }
    } catch {}
  }
  if (candidates.length > 0) {
    // Sort descending by folder name version
    candidates.sort((a, b) => b.localeCompare(a));
    return candidates[0];
  }

  if (process.platform === 'win32') {
    const npmCmd = path.join(HOME, 'AppData', 'Roaming', 'npm', 'claude.cmd');
    if (fs.existsSync(npmCmd)) return npmCmd;
    const localExe = path.join(HOME, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe');
    if (fs.existsSync(localExe)) return localExe;
  }

  return 'claude.exe';
}

const CLAUDE_BIN = findClaudeBinary();

// Prompt Templates & Builders
const PROMPT_AUTO_CONTINUE = 'continue';

function getPromptForAction(actionType) {
  const allowSubagents = config.authorizeSubagents !== false;
  if (actionType === 'continue') {
    return PROMPT_AUTO_CONTINUE;
  }
  if (actionType === 'autofix') {
    const subagentClause = allowSubagents
      ? '(or spawn dedicated adversarial subagents)'
      : '(without spawning subagents)';
    return `Perform an exhaustive adversarial code & visual hardening audit:

1. MULTI-DIMENSIONAL ADVERSARIAL REVIEW:
Adopt a rigorous adversarial red-team mindset ${subagentClause} to stress-test your implementation against the original specifications:
- Actively attempt to break edge cases, input validation, concurrency boundaries, and error handling.
- Verify exact compliance against all stated requirements and design constraints without making charitable assumptions.

2. BUG & FUNCTIONAL INTEGRITY AUDIT:
Conduct a meticulous deep-dive across all modified and related files to guarantee 100% bug-free behavior, type safety, test passing, and robust error recovery.

3. PIXEL-PERFECT VISUAL & UX SCRUTINY:
Adversarially scrutinize all UI components, layouts, typography, animations, color palettes, and responsive breakpoints to guarantee a flawless, pixel-perfect user experience.

4. REGRESSION & DIFF VERIFICATION:
Inspect git diffs line-by-line to ensure zero regressions, no unintended side effects, and clean code hygiene.

5. MULTI-PASS CONVERGENCE LOOP:
Continue independent, adversarial review passes in a loop until no further bugs, discrepancies, edge-case failures, or improvements can be found. If any issue is discovered, fix it cleanly and re-validate before concluding.`;
  }
  if (actionType === 'autoimprove') {
    const subagentClause = allowSubagents
      ? '\n(You are explicitly authorized to spawn specialized subagents to isolate profiling and refactoring tasks.)\n'
      : '';
    return `Perform an autonomous deep enhancement and optimization cycle for this project:
${subagentClause}
1. ARCHITECTURE & CODE HEALTH:
Analyze the codebase for latency bottlenecks, unnecessary allocations, redundant disk/network I/O, and code duplication. Refactor complex or brittle logic into clean, modular, maintainable patterns while maintaining strict backward compatibility.

2. USER EXPERIENCE & VISUAL/API POLISH:
Elevate the UX/UI or API ergonomics to a world-class standard. Ensure fluid interactions, robust feedback, intuitive defaults, clean logs, and pixel-perfect presentation.

3. RESILIENCE & EDGE-CASE HARDENING:
Identify potential failure modes (network timeouts, malformed inputs, race conditions, file permission limits, cold starts) and implement defensive guards, graceful degradation, and actionable error messages.

4. COMPREHENSIVE TEST & INTEGRITY VALIDATION:
Run all test suites, linters, and type-checks. Add test coverage for newly optimized paths and verify that the system runs flawlessly at peak performance. Keep iterating until no further improvements are possible.`;
  }
  return PROMPT_AUTO_CONTINUE;
}

// Default Configuration
let config = {
  globalPaused: false,
  lookbackHours: 24,
  recheckIntervalSeconds: 120,
  hibernateOnWeeklyLimit: false,
  hibernateOnAllCompleted: false,
  autoResumeEnabled: true,
  defaultAutoContinue: true,
  defaultAutoFix: false,
  defaultAutoImprove: false,
  authorizeSubagents: true,
  verificationTimeoutSeconds: 60,
  auditRetentionDays: 30,
  disabledSessionIds: [],
  agentOverrides: {}
};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  }
} catch (e) {}

function getAgentEffectiveFeatures(sessionId) {
  const overrides = config.agentOverrides?.[sessionId] || {};
  return {
    autoContinue: overrides.autoContinue !== undefined ? overrides.autoContinue : (config.defaultAutoContinue !== undefined ? config.defaultAutoContinue : true),
    autoFix: overrides.autoFix !== undefined ? overrides.autoFix : (config.defaultAutoFix !== undefined ? config.defaultAutoFix : false),
    autoImprove: overrides.autoImprove !== undefined ? overrides.autoImprove : (config.defaultAutoImprove !== undefined ? config.defaultAutoImprove : false)
  };
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {}
}

function loadPersistedEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  try {
    const cutoffMs = Date.now() - (config.auditRetentionDays || 30) * 86400000;
    const content = fs.readFileSync(EVENTS_FILE, 'utf8');
    const lines = content.split('\n');
    const loaded = [];
    let prunedCount = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        const t = evt.timestamp ? new Date(evt.timestamp).getTime() : 0;
        if (t >= cutoffMs) {
          loaded.push(evt);
        } else {
          prunedCount++;
        }
      } catch (_) {}
    }
    // Sort descending by timestamp (newest first)
    loaded.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (prunedCount > 0) {
      setTimeout(() => pruneEventsFile(), 1000);
    }
    return loaded;
  } catch (err) {
    console.error('Failed to load persisted events:', err);
    return [];
  }
}

function pruneEventsFile() {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return;
    const cutoffMs = Date.now() - (config.auditRetentionDays || 30) * 86400000;
    const content = fs.readFileSync(EVENTS_FILE, 'utf8');
    const lines = content.split('\n');
    const keptLines = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        const t = evt.timestamp ? new Date(evt.timestamp).getTime() : 0;
        if (t >= cutoffMs) {
          keptLines.push(line.trim());
        }
      } catch (_) {}
    }
    const tmpFile = EVENTS_FILE + '.tmp';
    fs.writeFileSync(tmpFile, keptLines.length > 0 ? keptLines.join('\n') + '\n' : '', 'utf8');
    fs.renameSync(tmpFile, EVENTS_FILE);
  } catch (err) {
    console.error('Failed to prune events.jsonl:', err);
  }
}

function loadPersistedResumes() {
  if (!fs.existsSync(RESUMES_FILE)) return [];
  try {
    const cutoffMs = Date.now() - (config.auditRetentionDays || 30) * 86400000;
    const items = JSON.parse(fs.readFileSync(RESUMES_FILE, 'utf8'));
    if (!Array.isArray(items)) return [];
    return items.filter(r => {
      const t = r.triggeredAt ? new Date(r.triggeredAt).getTime() : 0;
      return t >= cutoffMs;
    });
  } catch (_) {
    return [];
  }
}

function savePersistedResumes() {
  try {
    const cutoffMs = Date.now() - (config.auditRetentionDays || 30) * 86400000;
    const toSave = (state.resumes || []).filter(r => {
      const t = r.triggeredAt ? new Date(r.triggeredAt).getTime() : 0;
      return t >= cutoffMs;
    }).slice(0, 200);
    fs.writeFileSync(RESUMES_FILE, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save resumes.json:', err);
  }
}

// Global State with Persisted History
const state = {
  startedAt: new Date().toISOString(),
  lastScanAt: null,
  agents: new Map(),
  events: loadPersistedEvents(),
  resumes: loadPersistedResumes(),
  hibernation: {
    pending: false,
    triggerType: null,
    reason: null,
    targetTimestamp: null,
    timer: null
  },
  hibernateOnAllCompletedArmed: false,
  allAgentsCompletedSince: null,
  stats: {
    totalScanned: 0,
    activeRunning: 0,
    limited: 0,
    resumedAndVerified: 0,
  }
};

function addEvent(type, sessionId, sessionName, message, metadata = {}) {
  const evt = {
    id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    timestamp: new Date().toISOString(),
    type,
    sessionId,
    sessionName,
    message,
    metadata
  };
  state.events.unshift(evt);
  if (state.events.length > 1000) state.events.pop();

  try {
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(evt) + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to persist event to events.jsonl:', err.message);
  }

  broadcastSSE('event', evt);
  return evt;
}

const transcriptCache = new Map();

function readLastRawTurns(filePath, maxLines = 15, stats = null) {
  try {
    const st = stats || fs.statSync(filePath);
    if (st.size === 0) return { turns: [], latestMessageTimestamp: null, lastMeaningfulTurn: null };

    const cached = transcriptCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return cached.data;
    }

    const bufferSize = Math.min(st.size, 256 * 1024);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(bufferSize);
    fs.readSync(fd, buf, 0, bufferSize, st.size - bufferSize);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);

    const turns = [];
    let latestMessageTimestamp = null;
    let lastMeaningfulTurn = null;

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.timestamp) {
          const t = new Date(obj.timestamp).getTime();
          if (t && (!latestMessageTimestamp || t > latestMessageTimestamp)) {
            latestMessageTimestamp = t;
          }
        }
        if (obj.type === 'user' || obj.type === 'assistant') {
          if (!lastMeaningfulTurn) lastMeaningfulTurn = obj;
          if (turns.length < maxLines) {
            turns.unshift(obj);
          }
        } else if (obj.type === 'last-prompt' && turns.length < maxLines) {
          turns.unshift(obj);
        }
      } catch (e) {}
    }

    const data = { turns, latestMessageTimestamp, lastMeaningfulTurn };
    transcriptCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, data });
    if (transcriptCache.size > 500) {
      let evicted = 0;
      for (const k of transcriptCache.keys()) {
        transcriptCache.delete(k);
        evicted++;
        if (evicted >= 100) break;
      }
    }
    return data;
  } catch (e) {
    return { turns: [], latestMessageTimestamp: null, lastMeaningfulTurn: null };
  }
}

function computeBaselineAgentStatus(lastMeaningfulTurn, messageTimeMs, isProcessAlive, now = Date.now()) {
  if (!isProcessAlive) return 'IDLE';

  const ageMinutes = Math.max(0, Math.round((now - (messageTimeMs || 0)) / 60000));
  if (ageMinutes > 10) return 'IDLE';
  if (!lastMeaningfulTurn) return 'IDLE';

  if (lastMeaningfulTurn.type === 'assistant') {
    const stopReason = lastMeaningfulTurn.message?.stop_reason;
    const content = lastMeaningfulTurn.message?.content;
    const hasToolUse = Array.isArray(content) && content.some(c => c.type === 'tool_use');
    const hasText = typeof content === 'string' ? content.trim().length > 0 : (Array.isArray(content) && content.some(c => c.type === 'text' && c.text?.trim().length > 0));

    // If assistant returned no text and no tool use (e.g. intermediate thinking-only block) while process is alive:
    if (!hasToolUse && !hasText && isProcessAlive && ageMinutes <= 3) {
      return 'ACTIVE';
    }

    if (stopReason === 'tool_use' || hasToolUse) {
      // If process is alive, agent is actively awaiting external tool execution, background task, or subagent:
      if (isProcessAlive && ageMinutes <= 60) {
        return 'ACTIVE';
      }
      return ageMinutes <= 5 ? 'ACTIVE' : 'IDLE';
    }

    if (stopReason === 'end_turn' || stopReason === 'stop') {
      const ageSeconds = Math.max(0, Math.round((now - (messageTimeMs || 0)) / 1000));
      // If process is alive and message was written less than 45 seconds ago,
      // it is in the post-turn / next-prompt transition grace period.
      if (ageSeconds < 45 && isProcessAlive) {
        return 'ACTIVE';
      }
      return 'IDLE';
    }

    return 'IDLE';
  }

  if (lastMeaningfulTurn.type === 'user') {
    return ageMinutes <= 5 ? 'ACTIVE' : 'IDLE';
  }

  return 'IDLE';
}

function scanSubagentsForSession(projectFolder, sessionId, isProcessAlive, now = Date.now()) {
  const subagentsDir = path.join(PROJECTS_DIR, projectFolder, sessionId, 'subagents');
  if (!fs.existsSync(subagentsDir)) return { activeSubagents: [], latestSubagentTime: null };

  const activeSubagents = [];
  let latestSubagentTime = null;

  try {
    const files = fs.readdirSync(subagentsDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    for (const jf of jsonlFiles) {
      const fullPath = path.join(subagentsDir, jf);
      const st = fs.statSync(fullPath);
      if (!latestSubagentTime || st.mtimeMs > latestSubagentTime) {
        latestSubagentTime = st.mtimeMs;
      }

      const ageMinutes = Math.max(0, Math.round((now - st.mtimeMs) / 60000));
      // Only inspect if modified recently (e.g. within last 30 minutes)
      if (ageMinutes <= 30) {
        const subagentId = jf.replace(/^agent-/, '').replace(/\.jsonl$/, '');
        const metaPath = path.join(subagentsDir, `agent-${subagentId}.meta.json`);
        let meta = {};
        if (fs.existsSync(metaPath)) {
          try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) {}
        }

        const { lastMeaningfulTurn } = readLastRawTurns(fullPath, 5, st);
        let subagentStatus = 'IDLE';
        if (isProcessAlive && ageMinutes <= 15) {
          if (lastMeaningfulTurn) {
            if (lastMeaningfulTurn.type === 'assistant') {
              const stopReason = lastMeaningfulTurn.message?.stop_reason;
              if (stopReason === 'tool_use' || ageMinutes <= 2) {
                subagentStatus = 'ACTIVE';
              }
            } else if (lastMeaningfulTurn.type === 'user') {
              if (ageMinutes <= 5) subagentStatus = 'ACTIVE';
            }
          } else if (ageMinutes <= 3) {
            subagentStatus = 'ACTIVE';
          }
        }

        if (subagentStatus === 'ACTIVE') {
          activeSubagents.push({
            id: subagentId,
            agentType: meta.agentType || 'subagent',
            description: meta.description || `Subagent ${subagentId.slice(0, 8)}`,
            toolUseId: meta.toolUseId || null,
            status: subagentStatus,
            ageMinutes,
            lastActivityIso: new Date(st.mtimeMs).toISOString()
          });
        }
      }
    }
  } catch (e) {}

  return { activeSubagents, latestSubagentTime };
}

function detectActiveBackgroundTasks(projectFolder, sessionId, isProcessAlive, turns = []) {
  if (!isProcessAlive) return [];

  const tasksDir = path.join(HOME, 'AppData', 'Local', 'Temp', 'claude', projectFolder, sessionId, 'tasks');
  const activeTasks = [];

  const pendingTaskCandidates = new Map();
  const finishedTaskIds = new Set();

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const content = turn.message?.content;

    // Check for task notification (completion, failure, or cancellation from Claude Code runtime)
    const textContent = typeof content === 'string' ? content : JSON.stringify(content || '');
    const notifMatches = textContent.matchAll(/<task-id>([^<]+)<\/task-id>/g);
    for (const nm of notifMatches) {
      finishedTaskIds.add(nm[1]);
    }

    // Check for tool_use with run_in_background: true
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_use' && block.input?.run_in_background) {
          const desc = block.input.description || block.name;
          const cmd = block.input.command;
          if (i + 1 < turns.length) {
            const nextTurn = turns[i + 1];
            const nextContent = typeof nextTurn.message?.content === 'string' 
              ? nextTurn.message.content 
              : JSON.stringify(nextTurn.message?.content || '');
            const idMatch = nextContent.match(/Command running in background with ID:\s*([a-zA-Z0-9_-]+)/);
            if (idMatch) {
              const turnTimestamp = turn.timestamp ? new Date(turn.timestamp).getTime() : Date.now();
              pendingTaskCandidates.set(idMatch[1], {
                taskId: idMatch[1],
                description: desc,
                command: cmd ? cmd.slice(0, 150) : null,
                turnIndex: i,
                turnTimestamp
              });
            }
          }
        }
      }
    }
  }

  const now = Date.now();

  for (const [taskId, info] of pendingTaskCandidates) {
    // 1. Authoritative check: transcript contains <task-notification> for this task
    if (finishedTaskIds.has(taskId)) continue;

    const outputFile = path.join(tasksDir, `${taskId}.output`);
    const fileExists = fs.existsSync(outputFile);
    const taskAgeMs = now - (info.turnTimestamp || now);

    // 2. If file does not exist: allow a 45s grace period for newly launched tasks
    if (!fileExists) {
      if (taskAgeMs < 45000) {
        activeTasks.push({
          taskId,
          description: info.description,
          command: info.command,
          outputSize: 0,
          mtimeMs: info.turnTimestamp,
          ageMinutes: 0
        });
      }
      continue;
    }

    // 3. Inspect output file
    let isExited = false;
    let size = 0;
    let mtimeMs = now;

    try {
      const st = fs.statSync(outputFile);
      size = st.size;
      mtimeMs = st.mtimeMs;

      // 4. Anchored trailing exit marker verification: Claude Code appends '\n\n[exited with code N]\n'
      if (st.size > 0) {
        const readLen = Math.min(st.size, 1024);
        const buf = Buffer.alloc(readLen);
        const fd = fs.openSync(outputFile, 'r');
        fs.readSync(fd, buf, 0, readLen, st.size - readLen);
        fs.closeSync(fd);
        const tailText = buf.toString('utf8');
        if (/(?:^|\r?\n)\[exited with code -?\d+\]\s*$/.test(tailText)) {
          isExited = true;
        }
      }

      // 5. Orphan/Crash Guard: if the file hasn't been modified in > 45 minutes and no exit marker exists,
      // the process died without cleanup (e.g. killed, rebooted, crash)
      const fileIdleMinutes = (now - mtimeMs) / 60000;
      if (!isExited && fileIdleMinutes > 45 && taskAgeMs > 45 * 60000) {
        isExited = true;
      }
    } catch (err) {
      // In case of read/stat errors, fallback to not exited
    }

    if (!isExited) {
      activeTasks.push({
        taskId,
        description: info.description,
        command: info.command,
        outputSize: size,
        mtimeMs,
        ageMinutes: Math.max(0, Math.round((now - mtimeMs) / 60000))
      });
    }
  }

  return activeTasks;
}

const TZ_MAP = {
  'EST': 'America/New_York',
  'EDT': 'America/New_York',
  'ET': 'America/New_York',
  'PST': 'America/Los_Angeles',
  'PDT': 'America/Los_Angeles',
  'PT': 'America/Los_Angeles',
  'CST': 'America/Chicago',
  'CDT': 'America/Chicago',
  'CT': 'America/Chicago',
  'MST': 'America/Denver',
  'MDT': 'America/Denver',
  'MT': 'America/Denver',
  'HST': 'Pacific/Honolulu',
  'HDT': 'Pacific/Honolulu',
  'AKST': 'America/Anchorage',
  'AKDT': 'America/Anchorage',
  'UTC': 'UTC',
  'GMT': 'UTC',
  'BST': 'Europe/London',
  'CET': 'Europe/Paris',
  'CEST': 'Europe/Paris',
  'WET': 'Europe/Lisbon',
  'WEST': 'Europe/Lisbon',
  'EET': 'Europe/Athens',
  'EEST': 'Europe/Athens',
  'MSK': 'Europe/Moscow',
  'JST': 'Asia/Tokyo',
  'KST': 'Asia/Seoul',
  'HKT': 'Asia/Hong_Kong',
  'SGT': 'Asia/Singapore',
  'IST': 'Asia/Kolkata',
  'AEST': 'Australia/Sydney',
  'AEDT': 'Australia/Sydney',
  'ACST': 'Australia/Adelaide',
  'ACDT': 'Australia/Adelaide',
  'AWST': 'Australia/Perth',
  'NZST': 'Pacific/Auckland',
  'NZDT': 'Pacific/Auckland'
};

const DAY_MAP = {
  'sun': 0, 'sunday': 0,
  'mon': 1, 'monday': 1,
  'tue': 2, 'tues': 2, 'tuesday': 2,
  'wed': 3, 'wednesday': 3,
  'thu': 4, 'thur': 4, 'thurs': 4, 'thursday': 4,
  'fri': 5, 'friday': 5,
  'sat': 6, 'saturday': 6
};

/**
 * Structured API Error classification (patterned from Agent-Manager @am/core).
 * Inspects structured turn properties (isApiErrorMessage, error, apiErrorStatus) directly
 * without relying on brittle text regexes.
 */
const TRANSIENT_API_CODES = new Set(['overloaded', 'overloaded_error', 'server_error', 'timeout', 'max_output_tokens']);
const PERMANENT_API_CODES = new Set(['authentication_failed', 'oauth_org_not_allowed', 'billing_error', 'invalid_request', 'model_not_found']);

function classifyApiError(code, status) {
  if (code && PERMANENT_API_CODES.has(code)) return 'permanent';
  if (code && TRANSIENT_API_CODES.has(code)) return 'transient';
  if (code === 'rate_limit' || status === 429) return 'rate_limit';
  if (status === 529 || (status >= 500 && status <= 599)) return 'transient';
  if (status === 400 || status === 401 || status === 403) return 'permanent';
  return null;
}

function extractStructuredApiError(turn) {
  if (!turn || typeof turn !== 'object') return null;
  const isApi = turn.isApiErrorMessage === true;
  const code = turn.error || turn.message?.error?.code || turn.message?.error?.type;
  const rawStatus = turn.apiErrorStatus || turn.message?.error?.status;
  const status = typeof rawStatus === 'number' ? rawStatus : (rawStatus ? parseInt(rawStatus, 10) : undefined);
  if (!isApi && !code && !status) return null;
  const parsedCode = typeof code === 'string' ? code : undefined;
  const parsedStatus = Number.isFinite(status) ? status : undefined;
  return {
    isApiError: isApi,
    isApiErrorMessage: isApi,
    code: parsedCode,
    status: parsedStatus,
    category: classifyApiError(parsedCode, parsedStatus)
  };
}

/**
 * Extract an explicit IANA timezone from parentheses (e.g. "(Pacific/Honolulu)", "(Europe/Paris)").
 * If a valid IANA zone is present, it is resolved natively without needing manual abbreviation mapping.
 */
function extractIanaZone(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/\(([A-Za-z_]+(?:\/[A-Za-z_]+){0,2}|UTC|GMT)\)/);
  if (!m || !m[1]) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: m[1] });
    return m[1];
  } catch {
    return null;
  }
}

function parseRateLimitNotice(text, now = new Date()) {
  if (!text || typeof text !== 'string') return null;

  const isWeeklyLimit = /weekly (?:usage )?limit|weekly quota/i.test(text);
  const isExplicitLimitNotice = /(?:reached|hit|exceeded) (?:your )?(?:usage|session|weekly|rate) limit/i.test(text);
  const hasTimeIndicator = /(?:resets?|try again|available again|available|wait until|retry)\s+(?:at\s+|in\s+)?/i.test(text);

  // If not an explicit limit statement and lacks any time indicator, ignore
  if (!isExplicitLimitNotice && !isWeeklyLimit && !hasTimeIndicator && !/resets?\s+(?:at\s+)?\d+/i.test(text)) {
    return null;
  }

  const kind = isWeeklyLimit ? 'weekly_limit' : 'session_limit';
  let resetAtMs = null;

  // 1. Check relative intervals first (e.g. "try again in 45 minutes", "resets in 2 hours")
  const relMatch = text.match(/(?:resets?|try again|available again|available|wait until|wait|retry)?\s*(?:in|after)\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)/i);
  if (relMatch) {
    const val = parseInt(relMatch[1], 10);
    const isHours = /h/i.test(relMatch[2]);
    resetAtMs = now.getTime() + (isHours ? val * 3600000 : val * 60000);
  } else {
    // 2. Check absolute time with specific weekday regex (prevents words like "in" from being treated as days)
    const timeMatch = text.match(/(?:resets?|try again|available again|available|wait until|retry)\s+(?:at\s+)?(?:(Sun(?:day)?|Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:sday)?)?|Fri(?:day)?|Sat(?:urday)?)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\)|\s+([A-Z]{2,5}))?/i);
    if (timeMatch) {
      const [_, dayOfWeek, rawHours, rawMins, ampm, parenTz, suffixTz] = timeMatch;
      let hours = parseInt(rawHours, 10);
      const mins = rawMins ? parseInt(rawMins, 10) : 0;
      const rawTz = parenTz || suffixTz || 'UTC';
      const tz = extractIanaZone(text) || TZ_MAP[rawTz] || rawTz;

      if (ampm) {
        if (ampm.toLowerCase() === 'pm' && hours < 12) hours += 12;
        if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;
      }

      try {
        const dtf = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric',
          weekday: 'short',
          hour12: false
        });

        const parts = Object.fromEntries(dtf.formatToParts(now).map(p => [p.type, p.value]));
        let tzYear = parseInt(parts.year, 10);
        let tzMonth = parseInt(parts.month, 10);
        let tzDay = parseInt(parts.day, 10);
        const tzHour = parseInt(parts.hour, 10);
        const tzMin = parseInt(parts.minute, 10);

        let addDays = 0;
        if (dayOfWeek && DAY_MAP[dayOfWeek.toLowerCase()] !== undefined) {
          const targetWeekday = DAY_MAP[dayOfWeek.toLowerCase()];
          const currentWeekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
          addDays = (targetWeekday - currentWeekday + 7) % 7;
          if (addDays === 0 && (hours < tzHour || (hours === tzHour && mins <= tzMin))) {
            addDays = 7;
          }
        } else {
          if (hours < tzHour || (hours === tzHour && mins < tzMin - 1)) {
            addDays = 1;
          }
        }

        const approx = new Date(Date.UTC(tzYear, tzMonth - 1, tzDay + addDays, hours, mins, 0));
        const approxParts = Object.fromEntries(dtf.formatToParts(approx).map(p => [p.type, p.value]));
        const asTzUtc = new Date(Date.UTC(
          parseInt(approxParts.year, 10),
          parseInt(approxParts.month, 10) - 1,
          parseInt(approxParts.day, 10),
          parseInt(approxParts.hour, 10) % 24,
          parseInt(approxParts.minute, 10),
          parseInt(approxParts.second, 10)
        ));
        const offsetMs = asTzUtc.getTime() - approx.getTime();
        resetAtMs = approx.getTime() - offsetMs;
      } catch (e) {
        console.error('Timezone parse error in parseRateLimitNotice:', e);
        const target = new Date(now);
        target.setHours(hours, mins, 0, 0);
        if (target.getTime() < now.getTime() - 120000) target.setDate(target.getDate() + 1);
        resetAtMs = target.getTime();
      }
    } else if (isExplicitLimitNotice) {
      // Direct explicit limit statement without parsable reset time: default to 1 hour
      resetAtMs = now.getTime() + 3600000;
    } else {
      // Merely mentions limit words in normal discussion without a time or explicit notice
      return null;
    }
  }

  let resetAtIso = null;
  if (resetAtMs) {
    resetAtIso = new Date(resetAtMs).toISOString();
  }

  return {
    kind,
    rawNotice: text,
    resetAtMs,
    resetAtIso,
    timeUntilMinutes: resetAtMs ? Math.max(0, Math.round((resetAtMs - now.getTime()) / 60000)) : null
  };
}

function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function triggerHibernationSequence(reason, triggerType = 'weekly_limit') {
  if (config.globalPaused) return;
  if (state.hibernation.pending) return;
  if (triggerType === 'weekly_limit' && !config.hibernateOnWeeklyLimit) return;
  if (triggerType === 'all_completed' && !config.hibernateOnAllCompleted) return;

  const graceSeconds = 30;
  const targetTimestamp = Date.now() + graceSeconds * 1000;

  state.hibernation.pending = true;
  state.hibernation.triggerType = triggerType;
  state.hibernation.reason = reason;
  state.hibernation.targetTimestamp = targetTimestamp;

  const title = triggerType === 'all_completed'
    ? `All agents completed! PC hibernation scheduled in ${graceSeconds}s (${reason})`
    : `⚠️ Weekly limit reached! PC hibernation scheduled in ${graceSeconds}s (${reason})`;

  const alertTitle = triggerType === 'all_completed'
    ? `ALL AGENTS COMPLETED — PC HIBERNATING IN `
    : `WEEKLY LIMIT REACHED — PC HIBERNATING IN `;

  addEvent('HIBERNATE_TRIGGERED', null, 'SYSTEM', title, {
    targetTimestamp,
    triggerType
  });
  broadcastSSE('hibernation_status', {
    pending: true,
    reason,
    targetTimestamp,
    triggerType,
    alertTitle
  });

  state.hibernation.timer = setTimeout(() => {
    if (state.hibernation.pending) {
      addEvent('HIBERNATE_EXECUTED', null, 'SYSTEM', `Executing system hibernation: shutdown /h`);
      state.hibernation.pending = false;
      state.hibernation.triggerType = null;
      state.hibernation.reason = null;
      state.hibernation.targetTimestamp = null;
      state.hibernation.timer = null;
      state.hibernateOnAllCompletedArmed = false;
      if (config.hibernateOnAllCompleted) {
        config.hibernateOnAllCompleted = false;
        saveConfig();
      }
      broadcastSSE('hibernation_status', {
        pending: false
      });
      try {
        exec('shutdown /h', (err) => {
          if (err) console.error('Hibernation error:', err.message);
        });
      } catch (e) {
        console.error('Hibernation spawn error:', e.message);
      }
    }
  }, graceSeconds * 1000);
}

function cancelHibernation() {
  if (!state.hibernation.pending) return false;
  if (state.hibernation.timer) clearTimeout(state.hibernation.timer);
  state.hibernation.pending = false;
  state.hibernation.triggerType = null;
  state.hibernation.reason = null;
  state.hibernation.targetTimestamp = null;
  state.hibernation.timer = null;
  state.hibernateOnAllCompletedArmed = false;
  state.allAgentsCompletedSince = null;
  if (config.hibernateOnAllCompleted) {
    config.hibernateOnAllCompleted = false;
    saveConfig();
  }
  addEvent('INFO', null, 'SYSTEM', `PC Hibernation cancelled by user.`);
  broadcastSSE('hibernation_status', { pending: false });
  return true;
}

function scanAgents() {
  try {
    const now = Date.now();
    const lookbackMs = (config.lookbackHours || 6) * 3600 * 1000;
    const cutoffTime = now - lookbackMs;

    const activeSessionMeta = new Map();
    if (fs.existsSync(SESSIONS_DIR)) {
      const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
          if (meta && meta.sessionId) {
            if (isSentinelPathOrFolder(meta.cwd, null)) {
              continue;
            }
            activeSessionMeta.set(meta.sessionId, meta);
          }
        } catch (e) {}
      }
    }

    const foundSessions = [];
    if (fs.existsSync(PROJECTS_DIR)) {
      const projectDirs = fs.readdirSync(PROJECTS_DIR);
      for (const pDir of projectDirs) {
        if (isSentinelPathOrFolder(null, pDir)) {
          continue;
        }
        const fullPDir = path.join(PROJECTS_DIR, pDir);
        try {
          if (!fs.statSync(fullPDir).isDirectory()) continue;
          const files = fs.readdirSync(fullPDir).filter(f => f.endsWith('.jsonl'));
          for (const f of files) {
            const fullPath = path.join(fullPDir, f);
            const sessionId = f.replace('.jsonl', '');
            const isMetaActive = activeSessionMeta.has(sessionId);

            const st = fs.statSync(fullPath);
            if (st.mtimeMs < cutoffTime && !isMetaActive) {
              continue;
            }

            const { turns, latestMessageTimestamp, lastMeaningfulTurn } = readLastRawTurns(fullPath, 15, st);
            const effectiveTime = latestMessageTimestamp || (isMetaActive ? st.mtimeMs : 0);

            if (effectiveTime >= cutoffTime) {
              foundSessions.push({
                sessionId,
                projectFolder: pDir,
                transcriptPath: fullPath,
                fileSize: st.size,
                mtimeMs: st.mtimeMs,
                messageTimeMs: effectiveTime,
                messageTimeIso: new Date(effectiveTime).toISOString(),
                ageMinutes: Math.max(0, Math.round((now - effectiveTime) / 60000)),
                turns,
                lastMeaningfulTurn
              });
            }
          }
        } catch (e) {}
      }
    }

    let activeCount = 0;
    let limitedCount = 0;
    const currentSessionIds = new Set(foundSessions.map(s => s.sessionId));

    for (const [sid, agent] of state.agents) {
      if (!currentSessionIds.has(sid) || isSentinelPathOrFolder(agent?.cwd, agent?.projectFolder)) {
        state.agents.delete(sid);
      }
    }

    for (const s of foundSessions) {
      const meta = activeSessionMeta.get(s.sessionId) || {};
      const pid = meta.pid || null;
      const isProcessAlive = pid ? isPidAlive(pid) : false;
      const sessionName = meta.name || s.sessionId.slice(0, 8);
      const cwd = meta.cwd || reconstructCwdFromProjectFolder(s.projectFolder);
      if (isSentinelPathOrFolder(cwd, s.projectFolder)) {
        continue;
      }
      const isEnabled = !(config.disabledSessionIds || []).includes(s.sessionId);
      const baselineStatus = computeBaselineAgentStatus(s.lastMeaningfulTurn, s.messageTimeMs, isProcessAlive, now);

      let agent = state.agents.get(s.sessionId);
      if (!agent) {
        agent = {
          sessionId: s.sessionId,
          name: sessionName,
          projectFolder: s.projectFolder,
          cwd,
          pid,
          enabled: isEnabled,
          isProcessAlive,
          transcriptPath: s.transcriptPath,
          fileSize: s.fileSize,
          messageTimeMs: s.messageTimeMs,
          lastActivityIso: s.messageTimeIso,
          ageMinutes: s.ageMinutes,
          status: config.globalPaused ? 'PAUSED' : (!isEnabled ? 'DISABLED' : baselineStatus),
          llmEvaluation: null,
          limitNotice: null,
          lastPrompt: '',
          lastAssistantMessage: '',
          rawRecentTurns: s.turns,
          model: 'claude-opus',
          tokenUsage: null,
          verification: null,
          resumedCount: 0,
          lastResumeAttemptAt: null,
          activeSubagents: [],
          activeTasks: [],
        };
        state.agents.set(s.sessionId, agent);
        addEvent('INFO', agent.sessionId, agent.name, `Discovered agent session (PID ${pid || 'none'}, last message ${s.ageMinutes}m ago)`);
      } else {
        agent.name = meta.name || agent.name;
        agent.cwd = meta.cwd || agent.cwd;
        agent.pid = pid || agent.pid;
        agent.enabled = isEnabled;
        agent.isProcessAlive = isProcessAlive;
        agent.fileSize = s.fileSize;
        agent.messageTimeMs = s.messageTimeMs;
        agent.lastActivityIso = s.messageTimeIso;
        agent.ageMinutes = s.ageMinutes;
        agent.rawRecentTurns = s.turns;
      }

      let latestPromptText = '';
      let latestAssistantText = '';
      let latestAssistantTimestamp = agent.messageTimeMs || now;
      let turnModel = agent.model;

      for (const obj of s.turns) {
        if (obj.type === 'last-prompt' && obj.lastPrompt) {
          latestPromptText = obj.lastPrompt;
        } else if (obj.type === 'user' && obj.message) {
          if (typeof obj.message.content === 'string') latestPromptText = obj.message.content;
          else if (Array.isArray(obj.message.content)) {
            const firstText = obj.message.content.find(c => c.type === 'text' || typeof c === 'string');
            if (firstText) latestPromptText = firstText.text || firstText;
          }
        } else if (obj.type === 'assistant' && obj.message) {
          if (obj.timestamp) latestAssistantTimestamp = new Date(obj.timestamp).getTime();
          if (obj.message.model) turnModel = obj.message.model;
          if (obj.message.usage) agent.tokenUsage = obj.message.usage;
          if (obj.message.content) {
            if (typeof obj.message.content === 'string') latestAssistantText = obj.message.content;
            else if (Array.isArray(obj.message.content)) {
              for (const block of obj.message.content) {
                if (block.type === 'text') latestAssistantText += block.text + ' ';
                else if (block.type === 'tool_use') latestAssistantText += `[Tool: ${block.name}] `;
              }
            }
          }
        }
      }

      if (latestPromptText) agent.lastPrompt = latestPromptText.slice(0, 300);
      if (latestAssistantText) agent.lastAssistantMessage = latestAssistantText.slice(0, 500);
      agent.model = turnModel;

      const features = getAgentEffectiveFeatures(agent.sessionId);

      // 1. Check structured API error fields first (zero regex — language & format agnostic)
      let structuredLimitTurn = null;
      if (s.turns && s.turns.length > 0) {
        for (let i = s.turns.length - 1; i >= Math.max(0, s.turns.length - 5); i--) {
          const t = s.turns[i];
          const apiErr = extractStructuredApiError(t);
          if (apiErr && classifyApiError(apiErr.code, apiErr.status) === 'rate_limit') {
            structuredLimitTurn = t;
            break;
          }
        }
      }

      // 2. Parse rate limit notice: text parsing is used as the fallback/separator to extract the reset timestamp
      // (Claude Code stamps human-readable prose "resets HH:MM (Zone)" into text; this is documented as brittle)
      let detectedLimit = parseRateLimitNotice(latestAssistantText, new Date(latestAssistantTimestamp));
      if (!detectedLimit && s.turns && s.turns.length > 0) {
        for (let i = s.turns.length - 1; i >= Math.max(0, s.turns.length - 5); i--) {
          const t = s.turns[i];
          const turnTime = t.timestamp ? new Date(t.timestamp).getTime() : (agent.messageTimeMs || now);
          const textCandidate = t.message?.content ? (typeof t.message.content === 'string' ? t.message.content : JSON.stringify(t.message.content)) : '';
          const l = parseRateLimitNotice(textCandidate, new Date(turnTime));
          if (l) { detectedLimit = l; break; }
        }
      }

      // If structured 429 rate limit was stamped but text lacked a parsable reset time, default to 1-hour session limit
      if (structuredLimitTurn && !detectedLimit) {
        const turnTime = structuredLimitTurn.timestamp ? new Date(structuredLimitTurn.timestamp).getTime() : (agent.messageTimeMs || now);
        detectedLimit = {
          kind: 'session_limit',
          rawNotice: 'Structured API Error: rate_limit (HTTP 429)',
          resetAtMs: turnTime + 3600000,
          resetAtIso: new Date(turnTime + 3600000).toISOString(),
          timeUntilMinutes: 60
        };
      }

      if (detectedLimit) {
        if (now >= detectedLimit.resetAtMs) {
          // Limit has arrived / expired!
          if (agent.lastAutoContinuedLimitAt !== detectedLimit.resetAtMs) {
            agent.lastAutoContinuedLimitAt = detectedLimit.resetAtMs;
            agent.limitNotice = null;
            addEvent('INFO', agent.sessionId, agent.name, `Rate limit reset window reached for ${agent.name}`);
            if (features.autoContinue && !config.globalPaused && agent.enabled) {
              dispatchPromptToAgent(agent, 'AUTO_CONTINUE', PROMPT_AUTO_CONTINUE, 'Rate Limit Reset Window Reached');
            } else if (!config.globalPaused && agent.enabled) {
              agent.status = baselineStatus;
            }
          } else if (!config.globalPaused && agent.enabled && agent.status === 'LIMITED') {
            agent.limitNotice = null;
            agent.status = baselineStatus;
          }
        } else {
          // Limit is active in the future
          const wasLimited = (agent.status === 'LIMITED' && agent.limitNotice);
          agent.limitNotice = {
            kind: detectedLimit.kind,
            rawNotice: detectedLimit.rawNotice,
            detectedAt: agent.limitNotice?.detectedAt || new Date().toISOString(),
            resetAtMs: detectedLimit.resetAtMs,
            resetAtIso: detectedLimit.resetAtIso
          };
          if (!wasLimited) {
            addEvent('LIMIT_DETECTED', agent.sessionId, agent.name, `Detected Rate Limit: ${detectedLimit.rawNotice.slice(0, 120)}`, detectedLimit);
            if (detectedLimit.kind === 'weekly_limit') {
              triggerHibernationSequence(`Agent ${agent.name} reached weekly limit`);
            }
          }
          if (!config.globalPaused && agent.enabled) {
            agent.status = 'LIMITED';
          }
        }
      } else if (agent.limitNotice && now < agent.limitNotice.resetAtMs) {
        // Still within limit reset window
        if (!config.globalPaused && agent.enabled && agent.status !== 'RESUMING' && agent.status !== 'VERIFYING') {
          agent.status = 'LIMITED';
        }
      } else if (agent.limitNotice && now >= agent.limitNotice.resetAtMs) {
        // Limit reset reached!
        const prevLimit = agent.limitNotice;
        agent.limitNotice = null;
        addEvent('INFO', agent.sessionId, agent.name, `Limit reset window reached for ${agent.name}`);
        if (features.autoContinue && !config.globalPaused && agent.enabled) {
          dispatchPromptToAgent(agent, 'AUTO_CONTINUE', PROMPT_AUTO_CONTINUE, 'Rate Limit Reset Window Reached');
        } else if (!config.globalPaused && agent.enabled) {
          agent.status = baselineStatus;
        }
      }

      if (config.globalPaused) {
        agent.status = 'PAUSED';
      } else if (!agent.enabled) {
        agent.status = 'DISABLED';
      } else if (agent.status === 'LIMITED') {
        limitedCount++;
      } else if (agent.status === 'RESUMING' || agent.status === 'VERIFYING') {
        activeCount++;
      } else {
        // Scan active subagents in <projectFolder>/<sessionId>/subagents
        const { activeSubagents } = scanSubagentsForSession(s.projectFolder, s.sessionId, isProcessAlive, now);
        agent.activeSubagents = activeSubagents;

        // Scan active background tasks in Temp/claude/<projectFolder>/<sessionId>/tasks
        const activeTasks = detectActiveBackgroundTasks(s.projectFolder, s.sessionId, isProcessAlive, s.turns);
        agent.activeTasks = activeTasks;

        const hasActiveWork = (activeSubagents && activeSubagents.length > 0) || (activeTasks && activeTasks.length > 0);

        if (agent.llmEvaluation && !agent.needsEvaluation) {
          const evalAgeMs = agent.llmEvaluation.evaluatedAt ? (now - new Date(agent.llmEvaluation.evaluatedAt).getTime()) : 0;
          if (!isProcessAlive || (!hasActiveWork && (agent.ageMinutes > 5 || evalAgeMs > 300000))) {
            agent.status = 'IDLE';
          } else {
            agent.status = agent.llmEvaluation.status || baselineStatus;
          }
        } else {
          agent.status = baselineStatus;
        }

        if (hasActiveWork) {
          if (agent.status !== 'LIMITED' && agent.status !== 'PAUSED' && agent.status !== 'DISABLED') {
            agent.status = 'ACTIVE';
          }
        }

        if (agent.status === 'IDLE') {
          // Autonomous completion triggers if enabled
          const isRecentTurn = agent.ageMinutes < (config.lookbackHours || 6) * 60;
          if (isRecentTurn && agent.lastAutonomousPromptTurn !== agent.lastActivityIso && agent.rawRecentTurns && agent.rawRecentTurns.length > 0) {
            const lastTurn = agent.rawRecentTurns[agent.rawRecentTurns.length - 1];
            const isAssistantCompleted = lastTurn?.type === 'assistant' || lastTurn?.message?.role === 'assistant';
            
            if (isAssistantCompleted) {
              if (features.autoFix) {
                dispatchPromptToAgent(agent, 'AUTO_FIX', getPromptForAction('autofix'), 'Autonomous Task Completion Review');
              } else if (features.autoImprove) {
                dispatchPromptToAgent(agent, 'AUTO_IMPROVE', getPromptForAction('autoimprove'), 'Autonomous Deep Improvement Loop');
              }
            }
          }
        } else if (agent.status === 'ACTIVE' || agent.status === 'AUTO_FIXING' || agent.status === 'AUTO_IMPROVING') {
          activeCount++;
        }
      }

      agent.activitySignature = `${agent.fileSize}_${agent.messageTimeMs}_${agent.isProcessAlive}_${agent.status}`;
      agent.needsEvaluation = (agent.lastEvaluatedSignature !== agent.activitySignature);
    }

    state.stats.totalScanned = state.agents.size;
    state.stats.activeRunning = activeCount;
    state.stats.limited = limitedCount;
    state.lastScanAt = new Date().toISOString();

    // Check for Hibernate on All Agents Completed
    if (config.hibernateOnAllCompleted) {
      if (!state.hibernateOnAllCompletedArmed && (activeCount > 0 || limitedCount > 0)) {
        state.hibernateOnAllCompletedArmed = true;
        addEvent('INFO', null, 'SYSTEM', `💤 Hibernate on Completion: Watchdog armed (monitoring ${activeCount} active, ${limitedCount} limited agent(s))`);
        broadcastSSE('hibernation_status', {
          pending: false,
          armed: true
        });
      }

      if (state.hibernateOnAllCompletedArmed) {
        if (activeCount === 0 && limitedCount === 0 && !state.hibernation.pending && !config.globalPaused) {
          if (!state.allAgentsCompletedSince) {
            state.allAgentsCompletedSince = now;
            addEvent('INFO', null, 'SYSTEM', `💤 All agents completed tasks and no limits pending. Settling for 90s before initiating hibernation...`);
            broadcastSSE('hibernation_status', {
              pending: false,
              settling: true,
              settlingSeconds: 90
            });
          } else if (now - state.allAgentsCompletedSince >= 90000) {
            state.hibernateOnAllCompletedArmed = false;
            state.allAgentsCompletedSince = null;
            triggerHibernationSequence('All active Claude Code agents have completed their tasks', 'all_completed');
          }
        } else {
          if (state.allAgentsCompletedSince) {
            addEvent('INFO', null, 'SYSTEM', `Agent activity or pending rate limit detected during settling window. Hibernation timer reset.`);
            broadcastSSE('hibernation_status', {
              pending: false,
              settling: false
            });
          }
          state.allAgentsCompletedSince = null;
        }
      }
    } else {
      state.allAgentsCompletedSince = null;
    }

    broadcastSSE('status', getSanitizedStatus());
  } catch (e) {
    console.error('Scan error:', e);
  }
}

function dispatchPromptToAgent(agent, actionType = 'AUTO_CONTINUE', promptText = PROMPT_AUTO_CONTINUE, triggerReason = 'LLM Triggered') {
  if (config.globalPaused) return;
  if (!agent.enabled) return;
  if (agent.status === 'RESUMING' || agent.status === 'VERIFYING' || agent.status === 'AUTO_FIXING' || agent.status === 'AUTO_IMPROVING') return;

  const nowMs = Date.now();
  let nextStatus = 'RESUMING';
  let eventType = 'RESUME_TRIGGERED';
  let eventMsg = `Instructing agent to "${promptText.slice(0, 30)}..." (${triggerReason})`;

  if (actionType === 'AUTO_FIX') {
    nextStatus = 'AUTO_FIXING';
    eventType = 'AUTO_FIX_TRIGGERED';
    eventMsg = `🛠️ Session complete: Dispatched Auto-Fix & Pixel-Perfect Bug Audit loop (${triggerReason})`;
  } else if (actionType === 'AUTO_IMPROVE') {
    nextStatus = 'AUTO_IMPROVING';
    eventType = 'AUTO_IMPROVE_TRIGGERED';
    eventMsg = `🚀 Session complete: Dispatched Auto-Improve Optimization & Polish loop (${triggerReason})`;
  }

  agent.status = nextStatus;
  agent.lastResumeAttemptAt = nowMs;
  agent.resumedCount = (agent.resumedCount || 0) + 1;
  agent.lastAutonomousPromptTurn = agent.lastActivityIso;

  addEvent(eventType, agent.sessionId, agent.name, eventMsg, {
    actionType,
    triggerReason,
    cwd: agent.cwd
  });

  const resumeRecord = {
    id: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    sessionId: agent.sessionId,
    sessionName: agent.name,
    triggeredAt: new Date().toISOString(),
    triggerReason,
    actionType,
    status: 'IN_PROGRESS',
    verificationDetails: null,
  };
  state.resumes.unshift(resumeRecord);
  if (state.resumes.length > 100) state.resumes.pop();
  savePersistedResumes();

  try {
    if (!fs.existsSync(AM_QUEUE_DIR)) fs.mkdirSync(AM_QUEUE_DIR, { recursive: true });
    const qFile = path.join(AM_QUEUE_DIR, `${agent.sessionId}.json`);
    fs.writeFileSync(qFile, JSON.stringify({ reason: promptText, action: actionType, createdAt: nowMs }), 'utf8');
  } catch (e) {}

  // CRITICAL SAFETY GUARD:
  // If the agent process is already alive (running in user's terminal/editor), DO NOT spawn a duplicate
  // headless CLAUDE_BIN process! Doing so creates an unwanted secondary peer session (e.g. preceptor-a3),
  // causes file lock/transcript conflicts, and aborts background tasks.
  if (agent.isProcessAlive) {
    addEvent('INFO', agent.sessionId, agent.name, `Agent process (PID ${agent.pid || 'alive'}) is already active. Queued prompt without spawning duplicate peer session.`);
    agent.status = 'VERIFYING';
    startVerificationLoop(agent, resumeRecord, nowMs);
    return;
  }

  const targetCwd = agent.cwd && fs.existsSync(agent.cwd) ? agent.cwd : HOME;
  const args = ['--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', '--resume', agent.sessionId];

  let child;
  try {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const isWindowsBatch = process.platform === 'win32' && (CLAUDE_BIN.endsWith('.cmd') || CLAUDE_BIN.endsWith('.bat'));
    child = spawn(CLAUDE_BIN, args, {
      cwd: targetCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: isWindowsBatch
    });
    if (child.stdin) {
      child.stdin.write(promptText);
      child.stdin.end();
    }
    child.on('error', (err) => {
      console.error('Failed to spawn Claude process:', err);
      resumeRecord.status = 'FAILED';
      resumeRecord.error = err.message;
      savePersistedResumes();
      addEvent('VERIFY_FAILED', agent.sessionId, agent.name, `Failed to spawn process: ${err.message}`);
    });
    let stderrBuf = '';
    child.stderr?.on('data', (d) => {
      stderrBuf += d.toString();
    });
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`Claude process exited with code ${code}: ${stderrBuf.slice(0, 300)}`);
        resumeRecord.error = stderrBuf || `Process exited with code ${code}`;
        savePersistedResumes();
      }
    });
  } catch (err) {
    agent.status = 'IDLE';
    resumeRecord.status = 'FAILED';
    resumeRecord.error = err.message;
    savePersistedResumes();
    addEvent('VERIFY_FAILED', agent.sessionId, agent.name, `Failed to dispatch action: ${err.message}`);
    return;
  }

  agent.status = 'VERIFYING';
  startVerificationLoop(agent, resumeRecord, nowMs);
}

function triggerResumeForAgent(agent, triggerReason = 'LLM Triggered Continue') {
  return dispatchPromptToAgent(agent, 'AUTO_CONTINUE', PROMPT_AUTO_CONTINUE, triggerReason);
}

function startVerificationLoop(agent, resumeRecord, startMs) {
  const initialSize = agent.fileSize || 0;
  const initialMtime = agent.mtimeMs || 0;
  const checkInterval = 2000;
  const timeoutMs = (config.verificationTimeoutSeconds || 60) * 1000;

  let elapsed = 0;
  const timer = setInterval(() => {
    elapsed += checkInterval;

    try {
      if (fs.existsSync(agent.transcriptPath)) {
        const stats = fs.statSync(agent.transcriptPath);
        const { turns } = readLastRawTurns(agent.transcriptPath, 8);

        let foundNewAssistantTurn = false;
        let activeError = null;

        for (const obj of turns) {
          if (obj.type === 'assistant' && obj.message) {
            const t = obj.timestamp ? new Date(obj.timestamp).getTime() : 0;
            if (t >= startMs - 2000) {
              foundNewAssistantTurn = true;
            }
          }
          if (obj.isApiErrorMessage) activeError = obj;
        }

        const sizeGrew = stats.size > initialSize;
        const mtimeUpdated = stats.mtimeMs > initialMtime;

        if ((foundNewAssistantTurn || (sizeGrew && mtimeUpdated)) && !activeError) {
          clearInterval(timer);
          agent.status = 'ACTIVE';
          agent.limitNotice = null;
          agent.verification = {
            verified: true,
            verifiedAt: new Date().toISOString(),
            latencyMs: elapsed,
            fileSizeChange: stats.size - initialSize,
            status: 'VERIFIED_RUNNING'
          };

          resumeRecord.status = 'VERIFIED_WORKING';
          resumeRecord.verifiedAt = new Date().toISOString();
          resumeRecord.verificationDetails = agent.verification;
          savePersistedResumes();

          state.stats.resumedAndVerified++;
          addEvent('VERIFIED_WORKING', agent.sessionId, agent.name, `Agent verified running! Responded in ${(elapsed/1000).toFixed(1)}s (+${stats.size - initialSize}B)`, agent.verification);
          broadcastSSE('status', getSanitizedStatus());
          return;
        }
      }
    } catch (e) {}

    if (elapsed >= timeoutMs) {
      clearInterval(timer);
      if (agent.status === 'VERIFYING') {
        agent.status = 'IDLE';
        resumeRecord.status = 'TIMEOUT_UNVERIFIED';
        savePersistedResumes();
        addEvent('VERIFY_FAILED', agent.sessionId, agent.name, `Verification timed out after ${config.verificationTimeoutSeconds || 60}s`);
        broadcastSSE('status', getSanitizedStatus());
      }
    }
  }, checkInterval);
}

const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function getSanitizedStatus() {
  const agentList = Array.from(state.agents.values()).map(a => ({
    sessionId: a.sessionId,
    name: a.name,
    projectFolder: a.projectFolder,
    cwd: a.cwd,
    pid: a.pid,
    enabled: a.enabled,
    isProcessAlive: a.isProcessAlive,
    fileSize: a.fileSize,
    mtimeMs: a.mtimeMs,
    messageTimeMs: a.messageTimeMs,
    lastActivityIso: a.lastActivityIso,
    ageMinutes: a.ageMinutes,
    status: a.status,
    llmEvaluation: a.llmEvaluation,
    limitNotice: a.limitNotice,
    lastPrompt: a.lastPrompt,
    lastAssistantMessage: a.lastAssistantMessage,
    model: a.model,
    tokenUsage: a.tokenUsage,
    verification: a.verification,
    resumedCount: a.resumedCount,
    features: getAgentEffectiveFeatures(a.sessionId),
    overrides: config.agentOverrides?.[a.sessionId] || null,
    activeSubagents: a.activeSubagents || [],
    activeTasks: a.activeTasks || [],
  }));

  agentList.sort((a, b) => (b.messageTimeMs || 0) - (a.messageTimeMs || 0));

  if (state.hibernation.pending && state.hibernation.targetTimestamp && Date.now() >= state.hibernation.targetTimestamp) {
    state.hibernation.pending = false;
    state.hibernation.triggerType = null;
    state.hibernation.reason = null;
    state.hibernation.targetTimestamp = null;
    state.hibernation.timer = null;
  }

  return {
    systemTime: new Date().toISOString(),
    serverStartedAt: state.startedAt,
    lastScanAt: state.lastScanAt,
    config,
    hibernation: {
      pending: state.hibernation.pending,
      triggerType: state.hibernation.triggerType || null,
      reason: state.hibernation.reason,
      targetTimestamp: state.hibernation.targetTimestamp,
      armedOnCompletion: state.hibernateOnAllCompletedArmed,
      allCompletedSettlingSeconds: state.allAgentsCompletedSince && state.hibernateOnAllCompletedArmed
        ? Math.max(0, Math.ceil((90000 - (Date.now() - state.allAgentsCompletedSince)) / 1000))
        : null
    },
    stats: state.stats,
    agents: agentList,
    resumes: state.resumes.slice(0, 50),
  };
}

const server = http.createServer((req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'INIT', time: new Date().toISOString() })}\n\n`);
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getSanitizedStatus()));
      return;
    }

    if (pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state.events));
      return;
    }

    if (pathname === '/api/events/clear' && req.method === 'POST') {
      try {
        state.events = [];
        if (fs.existsSync(EVENTS_FILE)) {
          fs.writeFileSync(EVENTS_FILE, '', 'utf8');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Audit stream cleared' }));
        addEvent('INFO', null, 'SYSTEM', 'Audit log history cleared by user.');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // POST /api/pause (Toggle Global Pause)
    if (pathname === '/api/pause' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { paused } = JSON.parse(body || '{}');
          config.globalPaused = typeof paused === 'boolean' ? paused : !config.globalPaused;
          saveConfig();
          addEvent('INFO', null, 'SYSTEM', `Global Monitoring ${config.globalPaused ? 'PAUSED' : 'RESUMED'}`);
          scanAgents();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, globalPaused: config.globalPaused }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // POST /api/shutdown (Graceful Exit Server)
    if (pathname === '/api/shutdown' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Server shutting down gracefully' }));
      console.log('\n[Agent Sentinel]: Received shutdown command. Stopping server...');
      setTimeout(() => {
        process.exit(0);
      }, 500);
      return;
    }

    if (pathname === '/api/config') {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const updates = JSON.parse(body || '{}');
            const wasHibernateOnAllEnabled = !!config.hibernateOnAllCompleted;
            const willHibernateOnAllBeEnabled = updates.hibernateOnAllCompleted !== undefined
              ? !!updates.hibernateOnAllCompleted
              : wasHibernateOnAllEnabled;

            config = { ...config, ...updates };

            if (updates.auditRetentionDays !== undefined) {
              pruneEventsFile();
              savePersistedResumes();
            }

            // Handle arming logic for Hibernate on All Completed
            if (willHibernateOnAllBeEnabled && !wasHibernateOnAllEnabled) {
              const currentInFlightCount = Array.from(state.agents.values()).filter(a =>
                a.enabled && (a.status === 'ACTIVE' || a.status === 'LIMITED' || a.status === 'RESUMING' || a.status === 'VERIFYING' || a.status === 'AUTO_FIXING' || a.status === 'AUTO_IMPROVING')
              ).length;

              if (currentInFlightCount > 0) {
                state.hibernateOnAllCompletedArmed = true;
                addEvent('INFO', null, 'SYSTEM', `💤 Hibernate on Completion: ARMED (monitoring ${currentInFlightCount} in-flight/pending agent${currentInFlightCount > 1 ? 's' : ''})`);
              } else {
                state.hibernateOnAllCompletedArmed = false;
                addEvent('INFO', null, 'SYSTEM', `💤 Hibernate on Completion: Enabled. Watchdog will arm automatically as soon as in-flight/pending agents are detected.`);
              }
            } else if (!willHibernateOnAllBeEnabled && wasHibernateOnAllEnabled) {
              state.hibernateOnAllCompletedArmed = false;
              state.allAgentsCompletedSince = null;
              if (state.hibernation.pending && state.hibernation.triggerType === 'all_completed') {
                cancelHibernation();
              }
              addEvent('INFO', null, 'SYSTEM', `💤 Hibernate on Completion: Disarmed.`);
            }

            saveConfig();
            addEvent('INFO', null, 'SYSTEM', 'Configuration updated', { config });
            scanAgents();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, config, armedOnCompletion: state.hibernateOnAllCompletedArmed }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, config, armedOnCompletion: state.hibernateOnAllCompletedArmed }));
      return;
    }

    if (pathname === '/api/toggle-agent' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { sessionId, enabled } = JSON.parse(body || '{}');
          if (!sessionId) throw new Error('sessionId required');
          
          config.disabledSessionIds = config.disabledSessionIds || [];
          if (enabled) {
            config.disabledSessionIds = config.disabledSessionIds.filter(id => id !== sessionId);
          } else {
            if (!config.disabledSessionIds.includes(sessionId)) {
              config.disabledSessionIds.push(sessionId);
            }
          }
          saveConfig();
          
          const agent = state.agents.get(sessionId);
          if (agent) {
            agent.enabled = enabled;
            agent.status = enabled ? (agent.isProcessAlive ? 'ACTIVE' : 'IDLE') : 'DISABLED';
            addEvent('INFO', sessionId, agent.name, `Agent monitoring ${enabled ? 'ENABLED' : 'DISABLED'}`);
          }
          scanAgents();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, enabled, disabledSessionIds: config.disabledSessionIds }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (pathname === '/api/cancel-hibernation' && req.method === 'POST') {
      const cancelled = cancelHibernation();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cancelled }));
      return;
    }

    if (pathname === '/api/raw-agent-context') {
      const onlyChanged = req.url.includes('onlyChanged=true') || req.url.includes('onlyPending=true');
      const allAgents = Array.from(state.agents.values()).map(a => ({
        sessionId: a.sessionId,
        name: a.name,
        cwd: a.cwd,
        pid: a.pid,
        enabled: a.enabled,
        isProcessAlive: a.isProcessAlive,
        ageMinutes: a.ageMinutes,
        messageTimeIso: a.lastActivityIso,
        currentStatus: a.status,
        needsEvaluation: !!a.needsEvaluation,
        lastPrompt: a.lastPrompt,
        lastAssistantMessage: a.lastAssistantMessage,
        limitNotice: a.limitNotice,
        llmEvaluation: a.llmEvaluation,
        rawRecentTurns: a.rawRecentTurns
      }));
      const returnedList = onlyChanged ? allAgents.filter(a => a.needsEvaluation) : allAgents;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        totalAgents: allAgents.length,
        pendingCount: allAgents.filter(a => a.needsEvaluation).length,
        agents: returnedList
      }));
      return;
    }

    if (pathname === '/api/supervisor/submit-evaluation' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const evaluations = JSON.parse(body || '[]');
          const evalList = Array.isArray(evaluations) ? evaluations : [evaluations];

          for (const ev of evalList) {
            const agent = state.agents.get(ev.sessionId);
            if (!agent) continue;

            agent.llmEvaluation = {
              status: ev.status || agent.status,
              reasoning: ev.llmReasoning || '',
              summary: ev.summary || '',
              isLimited: !!ev.isLimited,
              limitKind: ev.limitDetails?.kind || null,
              resetAtIso: ev.limitDetails?.resetAtIso || null,
              resetAtMs: ev.limitDetails?.resetAtMs || null,
              evaluatedAt: new Date().toISOString()
            };

            if (config.globalPaused) {
              agent.status = 'PAUSED';
            } else if (agent.enabled) {
              if (ev.isLimited && ev.limitDetails) {
                const wasAlreadyLimited = (agent.status === 'LIMITED' && agent.limitNotice && Math.abs((agent.limitNotice.resetAtMs || 0) - (ev.limitDetails.resetAtMs || 0)) < 60000);
                agent.status = 'LIMITED';
                agent.limitNotice = {
                  kind: ev.limitDetails.kind || 'session_limit',
                  rawNotice: ev.limitDetails.rawNotice || ev.llmReasoning,
                  detectedAt: agent.limitNotice?.detectedAt || new Date().toISOString(),
                  resetAtMs: ev.limitDetails.resetAtMs || (Date.now() + 3600000),
                  resetAtIso: ev.limitDetails.resetAtIso || new Date(Date.now() + 3600000).toISOString()
                };

                if (!wasAlreadyLimited) {
                  addEvent('LIMIT_DETECTED', agent.sessionId, agent.name, `🧠 LLM Identified Limit: ${ev.summary}`, ev.limitDetails);

                  if (agent.limitNotice.kind === 'weekly_limit') {
                    triggerHibernationSequence(`Agent ${agent.name} reached weekly limit`);
                  }
                }
              } else {
                if (agent.status === 'LIMITED' && !ev.isLimited) {
                  agent.limitNotice = null;
                  addEvent('INFO', agent.sessionId, agent.name, `🧠 LLM Determined Limit Cleared: ${ev.summary}`);
                }
                if (agent.status !== 'RESUMING' && agent.status !== 'VERIFYING') {
                  agent.status = ev.status || agent.status || 'IDLE';
                }
              }
            } else {
              agent.status = 'DISABLED';
            }

            agent.activitySignature = `${agent.fileSize}_${agent.messageTimeMs}_${agent.isProcessAlive}_${agent.status}`;
            agent.lastEvaluatedSignature = agent.activitySignature;
            agent.needsEvaluation = false;
          }

          scanAgents();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, evaluatedCount: evalList.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (pathname === '/api/toggle-agent-feature' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { sessionId, feature, enabled } = JSON.parse(body || '{}');
          if (!sessionId) throw new Error('sessionId required');
          if (!['autoContinue', 'autoFix', 'autoImprove'].includes(feature)) {
            throw new Error(`Invalid feature: ${feature}. Must be autoContinue, autoFix, or autoImprove`);
          }

          config.agentOverrides = config.agentOverrides || {};
          config.agentOverrides[sessionId] = config.agentOverrides[sessionId] || {};
          config.agentOverrides[sessionId][feature] = !!enabled;
          saveConfig();

          const features = getAgentEffectiveFeatures(sessionId);
          addEvent('INFO', sessionId, state.agents.get(sessionId)?.name || sessionId, `Feature toggle updated: ${feature} = ${enabled}`);
          broadcastSSE('status', getSanitizedStatus());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, sessionId, feature, enabled: !!enabled, features }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (pathname === '/api/trigger-agent-action' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { sessionId, action } = JSON.parse(body || '{}');
          const agent = state.agents.get(sessionId);
          if (!agent) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Agent not found' }));
            return;
          }

          if (action === 'autofix') {
            dispatchPromptToAgent(agent, 'AUTO_FIX', getPromptForAction('autofix'), 'Manual Auto-Fix Trigger');
          } else if (action === 'autoimprove') {
            dispatchPromptToAgent(agent, 'AUTO_IMPROVE', getPromptForAction('autoimprove'), 'Manual Auto-Improve Trigger');
          } else {
            dispatchPromptToAgent(agent, 'AUTO_CONTINUE', getPromptForAction('continue'), 'Manual Dispatch');
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: `Dispatched ${action || 'continue'} to ${agent.name}` }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (pathname === '/api/prompts' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        authorizeSubagents: config.authorizeSubagents !== false,
        prompts: {
          continue: {
            title: 'Auto Continue',
            action: 'continue',
            trigger: 'Triggered when session rate limit or 5-hour quota ceiling resets',
            prompt: getPromptForAction('continue')
          },
          autofix: {
            title: 'Auto Fix (Adversarial Hardening Loop)',
            action: 'autofix',
            trigger: 'Triggered when agent completes its task with Auto-Fix enabled',
            prompt: getPromptForAction('autofix')
          },
          autoimprove: {
            title: 'Auto Improve (Optimization & Architecture Loop)',
            action: 'autoimprove',
            trigger: 'Triggered when agent completes its task with Auto-Improve enabled',
            prompt: getPromptForAction('autoimprove')
          }
        }
      }));
      return;
    }

    if (pathname === '/api/resume-agent' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { sessionId } = JSON.parse(body || '{}');
          const agent = state.agents.get(sessionId);
          if (!agent) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Agent not found' }));
            return;
          }
          triggerResumeForAgent(agent, 'Manual Dispatch');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: `Resume command sent to ${agent.name}` }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (pathname === '/api/scan' && req.method === 'POST') {
      scanAgents();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Scan complete' }));
      return;
    }

    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(__dirname, 'public', 'index.html');
    }

    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp'
    };
    const contentType = mimeTypes[ext] || 'text/plain';

    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  } catch (err) {
    console.error('Server error:', err);
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    } catch (_) {}
  }
});

function startServer(targetPort, maxAttempts = 10) {
  server.once('error', async (err) => {
    if (err.code === 'EADDRINUSE') {
      // Test if occupant is an existing Agent Sentinel instance
      let isSentinel = false;
      try {
        const checkRes = await new Promise((resolve) => {
          const req = http.get(`http://localhost:${targetPort}/api/status`, { timeout: 1500 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                resolve(!!json.systemTime && !!json.agents);
              } catch (_) { resolve(false); }
            });
          });
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
        });
        isSentinel = checkRes;
      } catch (_) { isSentinel = false; }

      if (isSentinel) {
        console.log(`\n[Agent Sentinel]: An instance is already running on port ${targetPort}.`);
        console.log(`Access active dashboard at: http://localhost:${targetPort}\n`);
        process.exit(0);
      } else {
        console.warn(`\n[Agent Sentinel Warning]: Port ${targetPort} is occupied by an unrelated application.`);
        if (maxAttempts > 1) {
          const nextPort = targetPort + 1;
          console.warn(`[Agent Sentinel]: Attempting fallback port http://localhost:${nextPort}...\n`);
          setTimeout(() => startServer(nextPort, maxAttempts - 1), 200);
        } else {
          console.error(`[Agent Sentinel Error]: Could not find an available port after multiple attempts. Please specify a free port via PORT=xxxx node server.js\n`);
          process.exit(1);
        }
      }
    } else {
      console.error('[Agent Sentinel Server Error]:', err);
      process.exit(1);
    }
  });

  server.listen(targetPort, 'localhost', () => {
    console.log(`\n======================================================`);
    console.log(`  AGENT SENTINEL — LLM COGNITIVE MONITOR`);
    console.log(`  Dashboard: http://localhost:${targetPort}`);
    console.log(`======================================================\n`);

    addEvent('INFO', null, 'SYSTEM', `Agent Sentinel Server Online on Port ${targetPort}`);
    scanAgents();
    setInterval(() => {
      scanAgents();
    }, 3000);

    // Prune audit logs and resumes older than auditRetentionDays once every 24 hours
    setInterval(() => {
      pruneEventsFile();
      savePersistedResumes();
    }, 24 * 3600 * 1000);
  });
}

module.exports = {
  server,
  TZ_MAP,
  DAY_MAP,
  EVENTS_FILE,
  RESUMES_FILE,
  extractIanaZone,
  classifyApiError,
  extractStructuredApiError,
  parseRateLimitNotice,
  reconstructCwdFromProjectFolder,
  isSentinelPathOrFolder,
  loadPersistedEvents,
  pruneEventsFile,
  loadPersistedResumes,
  savePersistedResumes,
  startServer
};

if (require.main === module) {
  startServer(PORT);
}
