/**
 * Standalone CLI Supervisor & Health Inspector
 * Fetches raw context from Sentinel server, verifies active turns,
 * and prints human-readable telemetry to stdout.
 */

async function runSupervision() {
  const SERVER_URL = process.env.SENTINEL_URL || 'http://localhost:3456';
  console.log(`Connecting to Agent Sentinel at ${SERVER_URL}...`);

  try {
    const rawRes = await fetch(`${SERVER_URL}/api/raw-agent-context`).then(r => r.json());
    if (!rawRes.ok) throw new Error('Failed to fetch raw context');

    console.log(`Found ${rawRes.agents.length} agent sessions within lookback window:\n`);

    for (const agent of rawRes.agents) {
      console.log(`======================================================`);
      console.log(`AGENT: ${agent.name} (Session: ${agent.sessionId.slice(0, 8)}...)`);
      console.log(`Status: ${agent.currentStatus} | Enabled: ${agent.enabled !== false} | PID: ${agent.pid || 'N/A'} | Alive: ${agent.isProcessAlive}`);
      console.log(`Path: ${agent.cwd}`);
      console.log(`Last Activity: ${agent.messageTimeIso} (${agent.ageMinutes}m ago)`);
      if (agent.llmEvaluation) {
        console.log(`🧠 LLM Verdict: ${agent.llmEvaluation.summary}`);
        console.log(`Reasoning: ${agent.llmEvaluation.reasoning}`);
      }
      console.log(`Turns in buffer: ${agent.rawRecentTurns?.length || 0}`);
    }
  } catch (e) {
    console.error('Supervision error:', e.message);
  }
}

runSupervision();
