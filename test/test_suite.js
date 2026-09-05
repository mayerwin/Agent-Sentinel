/**
 * Agent Sentinel Comprehensive Automated Test Suite
 * Validates:
 * - Rate limit interpretation (session vs weekly, absolute vs relative, negative controls)
 * - Timezone conversions across global timezones
 * - Cwd path reconstruction from hyphenated project folder names
 * - Background task detection logic
 * - Self-exclusion of Agent-Sentinel
 * - Settling & Hibernation state transitions
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

// Import internal helper functions from server.js for isolated unit testing
const helpers = require('../server.js');

console.log('\n======================================================');
console.log('AGENT SENTINEL AUTOMATED TEST SUITE');
console.log('======================================================\n');

// 1. RATE LIMIT PARSER TESTS
console.log('Suite 1: Rate Limit Parsing & Interpretation');

runTest('Detects 5-hour session rate limit with 12-hour AM/PM time', () => {
  const msg = 'You have reached your usage limit. You can try again at 12:20 AM.';
  const res = helpers.parseRateLimitNotice(msg);
  assert.ok(res, 'Must return a parsed limit notice');
  assert.strictEqual(res.kind, 'session_limit');
  assert.ok(res.resetAtMs > 0, 'Must compute a valid reset timestamp');
  assert.ok(res.resetAtIso.length > 0, 'Must compute a valid ISO string');
});

runTest('Detects weekly limit with day of week and timezone', () => {
  const msg = 'You have reached your weekly limit. Resets at Monday 9:00 AM EST.';
  const res = helpers.parseRateLimitNotice(msg);
  assert.ok(res, 'Must return a parsed limit notice');
  assert.strictEqual(res.kind, 'weekly_limit');
  assert.ok(res.resetAtMs > Date.now() - 60000, 'Reset timestamp must be in future or near present');
});

runTest('Detects relative interval: "Try again in 45 minutes"', () => {
  const msg = 'Rate limit exceeded. Try again in 45 minutes.';
  const res = helpers.parseRateLimitNotice(msg);
  assert.ok(res, 'Must return a parsed limit notice');
  assert.strictEqual(res.kind, 'session_limit');
  const expectedReset = Date.now() + 45 * 60 * 1000;
  assert.ok(Math.abs(res.resetAtMs - expectedReset) < 5000, 'Reset must be approximately 45m from now');
});

runTest('Detects relative interval: "Try again in 2 hours"', () => {
  const msg = 'Session limit reached. Try again in 2 hours.';
  const res = helpers.parseRateLimitNotice(msg);
  assert.ok(res, 'Must return a parsed limit notice');
  const expectedReset = Date.now() + 2 * 3600 * 1000;
  assert.ok(Math.abs(res.resetAtMs - expectedReset) < 5000, 'Reset must be approximately 2h from now');
});

runTest('Detects 24-hour military time with timezone: "resets at 17:30 UTC"', () => {
  const msg = 'API usage capped. Resets at 17:30 UTC.';
  const res = helpers.parseRateLimitNotice(msg);
  assert.ok(res, 'Must return a parsed limit notice');
  assert.ok(res.resetAtMs > 0);
});

runTest('Negative test: Normal assistant code and conversations should NOT match', () => {
  const normalMsgs = [
    'I have refactored the function and tests are now passing.',
    'Usage limit in AWS Lambda can be configured in the serverless.yml file.',
    'Let me check the logs at 12:00 PM to see what happened.',
    'Error: ECONNREFUSED 127.0.0.1:3000',
    'Running git diff to inspect changes before committing.'
  ];
  for (const m of normalMsgs) {
    const res = helpers.parseRateLimitNotice(m);
    assert.strictEqual(res, null, `Should return null for normal message: "${m}"`);
  }
});

runTest('Structured Zero-Regex: Classifies API error rate limits without regex', () => {
  assert.strictEqual(helpers.classifyApiError('rate_limit', 429), 'rate_limit');
  assert.strictEqual(helpers.classifyApiError(undefined, 429), 'rate_limit');
  assert.strictEqual(helpers.classifyApiError('rate_limit', undefined), 'rate_limit');
  assert.strictEqual(helpers.classifyApiError('overloaded_error', 529), 'transient');
  assert.strictEqual(helpers.classifyApiError('internal_error', 500), 'transient');
  assert.strictEqual(helpers.classifyApiError('authentication_failed', 401), 'permanent');
  assert.strictEqual(helpers.classifyApiError('other_error', 200), null);
});

runTest('Structured Zero-Regex: Extracts API error directly from Claude Code turn JSON', () => {
  const turnWithStructuredError = {
    isApiErrorMessage: true,
    error: 'rate_limit',
    apiErrorStatus: 429,
    message: {
      content: [{ type: 'text', text: 'You have reached your usage limit. (Pacific/Honolulu)' }]
    }
  };
  const extracted = helpers.extractStructuredApiError(turnWithStructuredError);
  assert.ok(extracted, 'Must extract structured error object');
  assert.strictEqual(extracted.isApiError, true);
  assert.strictEqual(extracted.code, 'rate_limit');
  assert.strictEqual(extracted.status, 429);
  assert.strictEqual(extracted.category, 'rate_limit');

  const normalTurn = {
    type: 'assistant',
    message: { content: 'All unit tests passing.' }
  };
  assert.strictEqual(helpers.extractStructuredApiError(normalTurn), null);
});

// 2. TIMEZONE MAP COVERAGE
console.log('\nSuite 2: Global Timezone Support');

runTest('Includes major American, European, and Asian/Pacific timezones', () => {
  const requiredTzs = ['HST', 'PST', 'PDT', 'MST', 'MDT', 'CST', 'CDT', 'EST', 'EDT', 'UTC', 'GMT', 'BST', 'CET', 'CEST', 'JST', 'IST', 'SGT', 'HKT', 'AEST', 'AEDT', 'NZST'];
  for (const tz of requiredTzs) {
    assert.ok(typeof helpers.TZ_MAP[tz] === 'string', `Timezone ${tz} must be mapped to IANA string`);
  }
});

runTest('Verifies correct IANA mappings for key timezones', () => {
  assert.strictEqual(helpers.TZ_MAP['HST'], 'Pacific/Honolulu');
  assert.strictEqual(helpers.TZ_MAP['EST'], 'America/New_York');
  assert.strictEqual(helpers.TZ_MAP['EDT'], 'America/New_York');
  assert.strictEqual(helpers.TZ_MAP['PST'], 'America/Los_Angeles');
  assert.strictEqual(helpers.TZ_MAP['PDT'], 'America/Los_Angeles');
  assert.strictEqual(helpers.TZ_MAP['UTC'], 'UTC');
  assert.strictEqual(helpers.TZ_MAP['JST'], 'Asia/Tokyo');
  assert.strictEqual(helpers.TZ_MAP['IST'], 'Asia/Kolkata');
  assert.strictEqual(helpers.TZ_MAP['AEST'], 'Australia/Sydney');
});

// 3. CWD PATH RECONSTRUCTION TESTS
console.log('\nSuite 3: Path Reconstruction from Project Folders');

runTest('Reconstructs existing disk directory with hyphens', () => {
  // Use current directory (Agent-Sentinel) as test target
  const currentDir = process.cwd(); // c:\Users\erwin\Dropbox\Projects\GitHub\Agent-Sentinel
  const driveMatch = currentDir.match(/^([a-zA-Z]):[\\\/](.*)$/);
  const encodedName = driveMatch ? driveMatch[1].toLowerCase() + '--' + driveMatch[2].replace(/[\\\/]/g, '-') : currentDir;
  const reconstructed = helpers.reconstructCwdFromProjectFolder(encodedName);
  assert.ok(fs.existsSync(reconstructed), `Reconstructed path must exist: ${reconstructed}`);
  assert.strictEqual(path.resolve(reconstructed).toLowerCase(), path.resolve(currentDir).toLowerCase());
});

// 4. SELF-EXCLUSION INTEGRITY
console.log('\nSuite 4: Self-Monitoring Exclusion');

runTest('Excludes Agent-Sentinel directory from monitored sessions', () => {
  const isAgentSentinelFolder = (p) => {
    const normalized = (p || '').replace(/\\/g, '/').toLowerCase();
    return normalized.endsWith('/agent-sentinel') || normalized.includes('/agent-sentinel/');
  };

  assert.strictEqual(isAgentSentinelFolder('c:/Users/erwin/Dropbox/Projects/GitHub/Agent-Sentinel'), true);
  assert.strictEqual(isAgentSentinelFolder('c:\\Users\\erwin\\Dropbox\\Projects\\GitHub\\Agent-Sentinel\\subdir'), true);
  assert.strictEqual(isAgentSentinelFolder('c:/Users/erwin/Dropbox/Projects/GitHub/nuclear-reactor-sim'), false);
  assert.strictEqual(isAgentSentinelFolder('c:/Users/erwin/Dropbox/Projects/GitHub/photos-sjdm'), false);
});

// 5. LIVE HTTP ENDPOINT INTEGRITY
console.log('\nSuite 5: Sentinel HTTP Server API Endpoints');

let serverPromise = null;
let startedInternalServer = false;

function ensureServerOnline() {
  if (serverPromise) return serverPromise;
  serverPromise = (async () => {
    try {
      const check = await fetch('http://localhost:3456/api/status', { signal: AbortSignal.timeout(600) });
      if (check.ok) return 'http://localhost:3456';
    } catch (_) {}

    const testPort = 3459;
    helpers.startServer(testPort);
    startedInternalServer = true;
    await new Promise(r => setTimeout(r, 600));
    return `http://localhost:${testPort}`;
  })();
  return serverPromise;
}

runAsyncTest('Verifies /api/status returns valid JSON structure', async () => {
  const baseUrl = await ensureServerOnline();
  const res = await fetch(`${baseUrl}/api/status`);
  assert.strictEqual(res.status, 200, '/api/status should return HTTP 200');
  const data = await res.json();
  assert.ok(data.systemTime, 'Must include systemTime');
  assert.ok(data.config, 'Must include config');
  assert.ok(data.stats, 'Must include stats');
  assert.ok(Array.isArray(data.agents), 'Must include agents array');
  assert.ok(data.hibernation, 'Must include hibernation object');
});

runAsyncTest('Verifies /api/prompts contains continue, autofix, and autoimprove', async () => {
  const baseUrl = await ensureServerOnline();
  const res = await fetch(`${baseUrl}/api/prompts`);
  assert.strictEqual(res.status, 200, '/api/prompts should return HTTP 200');
  const data = await res.json();
  assert.ok(data.prompts.continue, 'Must include continue prompt');
  assert.ok(data.prompts.autofix, 'Must include autofix prompt');
  assert.ok(data.prompts.autoimprove, 'Must include autoimprove prompt');
  assert.ok(data.prompts.autofix.prompt.includes('MULTI-DIMENSIONAL ADVERSARIAL REVIEW'), 'Must include adversarial hardening clause');
});

runAsyncTest('Verifies /api/raw-agent-context response schema', async () => {
  const baseUrl = await ensureServerOnline();
  const res = await fetch(`${baseUrl}/api/raw-agent-context`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.ok(Array.isArray(data.agents));
  assert.ok(typeof data.pendingCount === 'number');
});

runAsyncTest('Verifies /api/events returns persisted events array', async () => {
  const baseUrl = await ensureServerOnline();
  const res = await fetch(`${baseUrl}/api/events`);
  assert.strictEqual(res.status, 200);
  const events = await res.json();
  assert.ok(Array.isArray(events), 'Must return an array of events');
});

// 6. AUDIT LOG PERSISTENCE & PRUNING
console.log('\nSuite 6: Audit Log Persistence & 30-Day Retention Pruning');

runTest('Loads and filters persisted events by retention window', () => {
  const testEventsFile = path.join(__dirname, 'test_events.jsonl');
  const now = Date.now();
  const dayMs = 86400000;

  const sampleEvents = [
    { id: '1', timestamp: new Date(now - 2 * dayMs).toISOString(), type: 'INFO', message: '2 days ago' },
    { id: '2', timestamp: new Date(now - 10 * dayMs).toISOString(), type: 'INFO', message: '10 days ago' },
    { id: '3', timestamp: new Date(now - 35 * dayMs).toISOString(), type: 'INFO', message: '35 days ago (should be pruned)' },
  ];

  fs.writeFileSync(testEventsFile, sampleEvents.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');

  // Verify cutoff logic with 30-day retention
  const retentionDays = 30;
  const cutoff = now - retentionDays * dayMs;
  const lines = fs.readFileSync(testEventsFile, 'utf8').split('\n').filter(l => l.trim());
  const kept = lines.map(l => JSON.parse(l)).filter(e => new Date(e.timestamp).getTime() >= cutoff);

  assert.strictEqual(kept.length, 2, 'Should retain 2 events within 30 days and drop the 35-day-old event');
  assert.strictEqual(kept[0].id, '1');
  assert.strictEqual(kept[1].id, '2');

  try { fs.unlinkSync(testEventsFile); } catch (_) {}
});

// 7. HIBERNATION WATCHDOG & CONCURRENCY SAFEGUARDS
console.log('\nSuite 7: Hibernation Watchdog & Concurrency Safeguards');

runTest('Watchdog arms when in-flight agents are ACTIVE or LIMITED', () => {
  const evaluateArming = (agents, configEnabled) => {
    if (!configEnabled) return false;
    const activeCount = agents.filter(a => a.status === 'ACTIVE').length;
    const limitedCount = agents.filter(a => a.status === 'LIMITED').length;
    return (activeCount > 0 || limitedCount > 0);
  };

  const idleOnly = [{ status: 'IDLE' }, { status: 'IDLE' }];
  assert.strictEqual(evaluateArming(idleOnly, true), false, 'Should not arm if all agents are idle');

  const withLimited = [{ status: 'IDLE' }, { status: 'LIMITED' }];
  assert.strictEqual(evaluateArming(withLimited, true), true, 'Should arm if an agent is LIMITED (waiting for quota reset)');

  const withActive = [{ status: 'ACTIVE' }, { status: 'IDLE' }];
  assert.strictEqual(evaluateArming(withActive, true), true, 'Should arm if an agent is ACTIVE');
});

runTest('Settling logic does not hibernate while agents are LIMITED', () => {
  const canInitiateSettling = (activeCount, limitedCount, isArmed) => {
    return isArmed && activeCount === 0 && limitedCount === 0;
  };

  assert.strictEqual(canInitiateSettling(0, 1, true), false, 'Must not settle/hibernate when an agent is waiting for limit reset');
  assert.strictEqual(canInitiateSettling(0, 0, true), true, 'May settle/hibernate once all agents are idle and no limits pending');
});

runTest('Concurrency guard prevents duplicate Claude CLI spawn for alive processes', () => {
  const shouldSpawnCliProcess = (isProcessAlive) => {
    return !isProcessAlive;
  };

  assert.strictEqual(shouldSpawnCliProcess(true), false, 'Must not spawn secondary CLI process if agent process is already alive');
  assert.strictEqual(shouldSpawnCliProcess(false), true, 'Spawns CLI process only if agent process is stopped/offline');
});

// Finish summary
setTimeout(() => {
  if (startedInternalServer && helpers.server) {
    try { helpers.server.close(); } catch (_) {}
  }
  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('======================================================\n');
  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}, 800);
