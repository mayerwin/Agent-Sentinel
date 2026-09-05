/**
 * Standalone CLI Supervisor & Health Inspector
 * Fetches raw context from Sentinel server, verifies active turns,
 * and prints human-readable telemetry to stdout.
 */

async function runSupervision() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Agent Sentinel CLI Inspector
Usage: node tools/supervise-cli.js [options]

Options:
  --changed, -c    Only show agents with changed turns since last inspection
  --url <url>      Sentinel server URL (default: http://localhost:3456 or $SENTINEL_URL)
  --help, -h       Show this help message
`);
    process.exit(0);
  }

  let serverUrl = process.env.SENTINEL_URL || 'http://localhost:3456';
  const urlIdx = args.findIndex(a => a === '--url');
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    serverUrl = args[urlIdx + 1];
  }

  const onlyChanged = args.includes('--changed') || args.includes('-c');
  const endpoint = `${serverUrl}/api/raw-agent-context${onlyChanged ? '?onlyChanged=true' : ''}`;

  console.log(`Connecting to Agent Sentinel at ${serverUrl}...`);

  try {
    const rawRes = await fetch(endpoint).then(r => r.json());
    if (!rawRes.ok) throw new Error(rawRes.error || 'Failed to fetch raw context');

    const agents = rawRes.agents || [];
    console.log(`Found ${agents.length} agent sessions within lookback window (pending: ${rawRes.pendingCount ?? agents.length}):\n`);

    if (agents.length === 0) {
      console.log('No matching agents found.');
      return;
    }

    for (const agent of agents) {
      console.log(`======================================================`);
      console.log(`AGENT: ${agent.name} (Session: ${(agent.sessionId || '').slice(0, 8)}...)`);
      console.log(`Status: ${agent.currentStatus} | Enabled: ${agent.enabled !== false} | PID: ${agent.pid || 'N/A'} | Alive: ${agent.isProcessAlive}`);
      console.log(`Path: ${agent.cwd}`);
      console.log(`Last Activity: ${agent.messageTimeIso || 'N/A'} (${agent.ageMinutes}m ago)`);

      if (agent.limitNotice) {
        const kind = agent.limitNotice.kind === 'weekly_limit' ? 'Weekly Limit' : 'Session Limit';
        const resetStr = agent.limitNotice.resetAtIso ? new Date(agent.limitNotice.resetAtIso).toLocaleString() : 'Unknown';
        console.log(`⚠️ Limit: ${kind} | Resets at: ${resetStr}`);
      }

      if (agent.llmEvaluation) {
        console.log(`🧠 LLM Verdict: ${agent.llmEvaluation.summary}`);
        console.log(`   Reasoning: ${agent.llmEvaluation.reasoning}`);
      }

      if (agent.activeSubagents && agent.activeSubagents.length > 0) {
        console.log(`⚙️ Active Subagents (${agent.activeSubagents.length}):`);
        for (const sub of agent.activeSubagents) {
          console.log(`   - [${sub.agentType || 'subagent'}] ${sub.description} (${sub.ageMinutes}m ago)`);
        }
      }

      if (agent.activeTasks && agent.activeTasks.length > 0) {
        console.log(`⏳ Background Tasks (${agent.activeTasks.length}):`);
        for (const t of agent.activeTasks) {
          console.log(`   - [${t.status}] ${t.command || t.description || t.taskId} (${t.ageMinutes}m ago)`);
        }
      }

      console.log(`Turns in buffer: ${agent.rawRecentTurns?.length || 0}`);
    }
  } catch (e) {
    console.error('Supervision error:', e.message);
    process.exitCode = 1;
  }
}

runSupervision();
