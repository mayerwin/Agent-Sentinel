// Agent Sentinel Client Application
let currentStatus = null;
let currentFilter = 'all';
let countdownInterval = null;
let hibernationInterval = null;

const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';

// DOM Elements
const systemClock = document.getElementById('systemClock');
const statTotalAgents = document.getElementById('statTotalAgents');
const statActiveAgents = document.getElementById('statActiveAgents');
const statLimitedAgents = document.getElementById('statLimitedAgents');
const statResumedVerified = document.getElementById('statResumedVerified');
const statLookbackLabel = document.getElementById('statLookbackLabel');
const agentCountBadge = document.getElementById('agentCountBadge');
const agentsContainer = document.getElementById('agentsContainer');
const eventsContainer = document.getElementById('eventsContainer');
const limitHeroSection = document.getElementById('limitHeroSection');
const heroCountdownTimer = document.getElementById('heroCountdownTimer');
const heroResetTarget = document.getElementById('heroResetTarget');
const limitAgentStrip = document.getElementById('limitAgentStrip');
const toastContainer = document.getElementById('toastContainer');
const btnScanNow = document.getElementById('btnScanNow');
const btnClearLogs = document.getElementById('btnClearLogs');
const filterTabs = document.querySelectorAll('.filter-tab');

// Header Status & Controls
const sentinelStatusBadge = document.getElementById('sentinelStatusBadge');
const sentinelStatusText = document.getElementById('sentinelStatusText');
const headerSubtitleText = document.getElementById('headerSubtitleText');
const btnTogglePause = document.getElementById('btnTogglePause');
const pauseIcon = document.getElementById('pauseIcon');
const pauseLabel = document.getElementById('pauseLabel');
const btnExitServer = document.getElementById('btnExitServer');
const exitModal = document.getElementById('exitModal');
const btnCloseExit = document.getElementById('btnCloseExit');
const btnCancelExit = document.getElementById('btnCancelExit');
const btnConfirmExit = document.getElementById('btnConfirmExit');

// Hibernation Elements
const hibernationBanner = document.getElementById('hibernationBanner');
const hibernateCountdownSec = document.getElementById('hibernateCountdownSec');
const hibernationDesc = document.getElementById('hibernationDesc');
const btnCancelHibernate = document.getElementById('btnCancelHibernate');

// Settling Alert Elements
const settlingBanner = document.getElementById('settlingBanner');
const settlingCountdownSec = document.getElementById('settlingCountdownSec');
const settlingDesc = document.getElementById('settlingDesc');
const btnDisarmSettling = document.getElementById('btnDisarmSettling');


// Settings Modal Elements
const btnOpenSettings = document.getElementById('btnOpenSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const btnCancelSettings = document.getElementById('btnCancelSettings');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const settingsModal = document.getElementById('settingsModal');
const inputLookback = document.getElementById('inputLookback');
const inputRecheck = document.getElementById('inputRecheck');
const modalToggleHibernate = document.getElementById('modalToggleHibernate');
const modalToggleHibernateOnCompletion = document.getElementById('modalToggleHibernateOnCompletion');
const modalToggleAutoContinue = document.getElementById('modalToggleAutoContinue');
const modalToggleAutoFix = document.getElementById('modalToggleAutoFix');
const modalToggleAutoImprove = document.getElementById('modalToggleAutoImprove');
const modalToggleAuthorizeSubagents = document.getElementById('modalToggleAuthorizeSubagents');
const inputVerifyTimeout = document.getElementById('inputVerifyTimeout');
const inputAuditRetention = document.getElementById('inputAuditRetention');

// Prompt Inspector Elements
const btnOpenPrompts = document.getElementById('btnOpenPrompts');
const btnSettingsInspectPrompts = document.getElementById('btnSettingsInspectPrompts');
const promptsModal = document.getElementById('promptsModal');
const btnClosePrompts = document.getElementById('btnClosePrompts');
const btnClosePromptsFooter = document.getElementById('btnClosePromptsFooter');
const promptTextAutoFix = document.getElementById('promptTextAutoFix');
const promptTextAutoImprove = document.getElementById('promptTextAutoImprove');
const promptTextContinue = document.getElementById('promptTextContinue');
const subagentStatusIndicatorFix = document.getElementById('subagentStatusIndicatorFix');
const subagentStatusIndicatorImprove = document.getElementById('subagentStatusIndicatorImprove');

function updateClock() {
  const now = new Date();
  systemClock.textContent = now.toLocaleTimeString();
}
setInterval(updateClock, 1000);
updateClock();

function formatTimeRemaining(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateCountdowns() {
  if (!currentStatus || !currentStatus.agents) return;
  const now = Date.now();

  const limitedAgents = currentStatus.agents.filter(a => a.status === 'LIMITED' && a.limitNotice && a.enabled && !currentStatus.config?.globalPaused);
  if (limitedAgents.length === 0) {
    limitHeroSection.style.display = 'none';
    return;
  }

  limitHeroSection.style.display = 'block';

  let minResetMs = Infinity;

  for (const a of limitedAgents) {
    if (a.limitNotice.resetAtMs && a.limitNotice.resetAtMs < minResetMs) {
      minResetMs = a.limitNotice.resetAtMs;
    }
  }

  if (Number.isFinite(minResetMs)) {
    const diff = minResetMs - now;
    if (diff <= 0) {
      heroCountdownTimer.textContent = 'READY — Auto-resuming...';
    } else {
      heroCountdownTimer.textContent = formatTimeRemaining(diff);
    }
    heroResetTarget.textContent = `Resets at: ${new Date(minResetMs).toLocaleTimeString()} (${new Date(minResetMs).toLocaleDateString()})`;
  }

  document.querySelectorAll('.live-card-countdown').forEach(el => {
    const resetMs = parseInt(el.dataset.resetMs, 10);
    if (resetMs) {
      const cDiff = resetMs - now;
      if (cDiff <= 0) {
        el.textContent = 'READY — Auto-resuming...';
      } else {
        el.textContent = formatTimeRemaining(cDiff);
      }
    }
  });
}

function startCountdownTicking() {
  if (countdownInterval) clearInterval(countdownInterval);
  updateCountdowns();
  countdownInterval = setInterval(updateCountdowns, 500);
}

function handleHibernationBanner(hibernation) {
  if (!hibernation || !hibernation.pending) {
    hibernationBanner.style.display = 'none';
    if (hibernationInterval) clearInterval(hibernationInterval);
    return;
  }

  const remaining = Math.max(0, Math.ceil((hibernation.targetTimestamp - Date.now()) / 1000));
  if (remaining <= 0) {
    hibernationBanner.style.display = 'none';
    if (hibernationInterval) clearInterval(hibernationInterval);
    return;
  }

  hibernationBanner.style.display = 'flex';
  const titleEl = document.querySelector('.hibernation-alert-title');
  const isAllCompleted = hibernation.triggerType === 'all_completed';
  if (titleEl) {
    const titlePrefix = isAllCompleted ? 'ALL AGENTS COMPLETED — PC HIBERNATING IN ' : 'WEEKLY LIMIT REACHED — PC HIBERNATING IN ';
    titleEl.innerHTML = `${titlePrefix}<span id="hibernateCountdownSec">${remaining}</span>s`;
  }
  hibernationDesc.textContent = hibernation.reason || (isAllCompleted ? 'All active agents completed their tasks. Hibernating to conserve power.' : 'Weekly limit detected. Hibernating to conserve power.');

  if (hibernationInterval) clearInterval(hibernationInterval);
  hibernationInterval = setInterval(() => {
    const cdSpan = document.getElementById('hibernateCountdownSec');
    const rem = Math.max(0, Math.ceil((hibernation.targetTimestamp - Date.now()) / 1000));
    if (cdSpan) cdSpan.textContent = rem;
    if (rem <= 0) {
      clearInterval(hibernationInterval);
      hibernationBanner.style.display = 'none';
    }
  }, 250);
}

let settlingInterval = null;

function handleSettlingBanner(settling) {
  if (!settling || !settling.settling) {
    if (settlingBanner) settlingBanner.style.display = 'none';
    if (settlingInterval) clearInterval(settlingInterval);
    return;
  }

  const remaining = Math.max(0, Math.ceil((settling.targetTimestamp - Date.now()) / 1000));
  if (remaining <= 0) {
    if (settlingBanner) settlingBanner.style.display = 'none';
    if (settlingInterval) clearInterval(settlingInterval);
    return;
  }

  if (settlingBanner) settlingBanner.style.display = 'flex';
  if (settlingCountdownSec) settlingCountdownSec.textContent = remaining;

  if (settlingInterval) clearInterval(settlingInterval);
  settlingInterval = setInterval(() => {
    const rem = Math.max(0, Math.ceil((settling.targetTimestamp - Date.now()) / 1000));
    if (settlingCountdownSec) settlingCountdownSec.textContent = rem;
    if (rem <= 0) {
      clearInterval(settlingInterval);
      if (settlingBanner) settlingBanner.style.display = 'none';
    }
  }, 250);
}


function showToast(message, icon = 'ℹ️') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function syncSettingsToModal(cfg) {
  if (!cfg) return;
  if (cfg.lookbackHours) inputLookback.value = cfg.lookbackHours;
  if (cfg.recheckIntervalSeconds) inputRecheck.value = cfg.recheckIntervalSeconds;
  if (typeof cfg.hibernateOnWeeklyLimit === 'boolean') modalToggleHibernate.checked = cfg.hibernateOnWeeklyLimit;
  if (typeof cfg.hibernateOnAllCompleted === 'boolean') modalToggleHibernateOnCompletion.checked = cfg.hibernateOnAllCompleted;
  if (typeof cfg.defaultAutoContinue === 'boolean') {
    modalToggleAutoContinue.checked = cfg.defaultAutoContinue;
  } else if (typeof cfg.autoResumeEnabled === 'boolean') {
    modalToggleAutoContinue.checked = cfg.autoResumeEnabled;
  }
  if (typeof cfg.defaultAutoFix === 'boolean') modalToggleAutoFix.checked = cfg.defaultAutoFix;
  if (typeof cfg.defaultAutoImprove === 'boolean') modalToggleAutoImprove.checked = cfg.defaultAutoImprove;
  if (typeof cfg.authorizeSubagents === 'boolean') modalToggleAuthorizeSubagents.checked = cfg.authorizeSubagents;
  if (cfg.verificationTimeoutSeconds) inputVerifyTimeout.value = cfg.verificationTimeoutSeconds;
  if (inputAuditRetention && cfg.auditRetentionDays) inputAuditRetention.value = cfg.auditRetentionDays;
  
  if (statLookbackLabel) {
    statLookbackLabel.textContent = `Past ${cfg.lookbackHours || 24}h`;
  }

  // Update Pause button state
  if (cfg.globalPaused) {
    pauseIcon.textContent = '▶';
    pauseLabel.textContent = 'Resume';
    btnTogglePause.classList.add('btn-action');
    sentinelStatusBadge.className = 'sentinel-badge paused';
    sentinelStatusBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    sentinelStatusBadge.style.background = 'rgba(245, 158, 11, 0.12)';
    sentinelStatusBadge.style.color = '#fbbf24';
    sentinelStatusText.textContent = 'MONITORING PAUSED';
    headerSubtitleText.textContent = '⏸ Global Monitoring is Paused';
    headerSubtitleText.style.color = '#fbbf24';
  } else {
    pauseIcon.textContent = '⏸';
    pauseLabel.textContent = 'Pause';
    btnTogglePause.classList.remove('btn-action');
    sentinelStatusBadge.className = 'sentinel-badge live';
    sentinelStatusBadge.style.borderColor = '';
    sentinelStatusBadge.style.background = '';
    sentinelStatusBadge.style.color = '';
    sentinelStatusText.textContent = 'LLM COGNITIVE MONITOR';
    headerSubtitleText.textContent = '🧠 LLM Cognitive Supervisor Active';
    headerSubtitleText.style.color = '';
  }
}

function getDemoState() {
  const resetTime = Date.now() + (42 * 60 + 15) * 1000;
  return {
    systemTime: new Date().toISOString(),
    config: {
      globalPaused: false,
      lookbackHours: 24,
      recheckIntervalSeconds: 120,
      hibernateOnWeeklyLimit: true,
      hibernateOnAllCompleted: false,
      autoResumeEnabled: true,
      defaultAutoContinue: true,
      defaultAutoFix: false,
      defaultAutoImprove: false,
      verificationTimeoutSeconds: 60,
      disabledSessionIds: ['sess-legacy-05']
    },
    hibernation: { pending: false, reason: null, targetTimestamp: null },
    stats: {
      totalScanned: 5,
      activeRunning: 2,
      limited: 1,
      resumedAndVerified: 8
    },
    agents: [
      {
        sessionId: 'sess-quantum-01',
        name: 'Quantum-Engine',
        projectFolder: 'quantum-core',
        cwd: '~/projects/quantum-core',
        pid: 3081,
        enabled: true,
        isProcessAlive: true,
        ageMinutes: 3,
        status: 'LIMITED',
        model: 'claude-3-7-sonnet',
        features: { autoContinue: true, autoFix: false, autoImprove: false },
        limitNotice: {
          kind: 'weekly_limit',
          detectedAt: new Date(Date.now() - 180000).toISOString(),
          resetAtMs: resetTime,
          resetAtIso: new Date(resetTime).toISOString()
        },
        llmEvaluation: {
          status: 'LIMITED',
          summary: 'Weekly token quota limit reached; auto-resume armed for reset moment',
          reasoning: 'Cognitive analysis: Agent exceeded weekly quota ceiling during large tensor contraction benchmark. Quota resets in 42m.',
          evaluatedAt: new Date().toISOString()
        },
        lastPrompt: 'Optimize tensor contraction pipeline and run full benchmark suite',
        lastAssistantMessage: 'You have reached your weekly usage limit. Resets at ' + new Date(resetTime).toLocaleTimeString(),
        verification: null
      },
      {
        sessionId: 'sess-aurora-02',
        name: 'Project-Aurora',
        projectFolder: 'aurora-web',
        cwd: '~/projects/aurora-web',
        pid: 1459,
        enabled: true,
        isProcessAlive: true,
        ageMinutes: 1,
        status: 'ACTIVE',
        model: 'claude-3-7-sonnet',
        features: { autoContinue: true, autoFix: true, autoImprove: false },
        limitNotice: null,
        llmEvaluation: {
          status: 'ACTIVE',
          summary: 'Running TypeScript build & executing end-to-end auth integration suite',
          reasoning: 'Cognitive analysis: Agent process PID 1459 is actively generating migration scripts and executing test runner without errors.',
          evaluatedAt: new Date().toISOString()
        },
        lastPrompt: 'Add OAuth2 authentication provider and dark mode toggle',
        lastAssistantMessage: 'Generating migration scripts and updating auth controller... [Tool: Bash npm test]',
        verification: {
          verified: true,
          verifiedAt: new Date(Date.now() - 60000).toISOString(),
          latencyMs: 1420,
          fileSizeChange: 4280,
          status: 'VERIFIED_RUNNING'
        }
      },
      {
        sessionId: 'sess-harvester-03',
        name: 'Data-Harvester',
        projectFolder: 'data-harvester',
        cwd: '~/projects/data-harvester',
        pid: 721,
        enabled: true,
        isProcessAlive: true,
        ageMinutes: 2,
        status: 'ACTIVE',
        model: 'claude-3-7-sonnet',
        features: { autoContinue: true, autoFix: false, autoImprove: true },
        limitNotice: null,
        llmEvaluation: {
          status: 'ACTIVE',
          summary: 'Streaming live telemetry into event pipeline (1,420 events/sec)',
          reasoning: 'Cognitive analysis: WebSocket client connected and ingestion worker active.',
          evaluatedAt: new Date().toISOString()
        },
        lastPrompt: 'Scrape market data feed and stream to Kafka broker',
        lastAssistantMessage: 'Stream ingestion confirmed: 1,420 events/sec ingested. [Tool: Bash kafka-console-producer]',
        verification: {
          verified: true,
          verifiedAt: new Date(Date.now() - 120000).toISOString(),
          latencyMs: 980,
          fileSizeChange: 2150,
          status: 'VERIFIED_RUNNING'
        }
      },
      {
        sessionId: 'sess-mesh-04',
        name: 'Neural-Mesh-Sim',
        projectFolder: 'neural-mesh',
        cwd: '~/projects/neural-mesh',
        pid: 4892,
        enabled: true,
        isProcessAlive: false,
        ageMinutes: 14,
        status: 'IDLE',
        model: 'claude-3-7-sonnet',
        features: { autoContinue: true, autoFix: true, autoImprove: false },
        limitNotice: null,
        llmEvaluation: {
          status: 'IDLE',
          summary: 'All 10 validation folds completed; summary written to report.md',
          reasoning: 'Cognitive analysis: Cross-validation completed with Mean F1 = 0.942. Agent cleanly ended turn.',
          evaluatedAt: new Date().toISOString()
        },
        lastPrompt: 'Summarize validation metrics across all 10 folds',
        lastAssistantMessage: 'All 10 folds evaluated: Mean F1 score 0.942. Results saved to report.md.',
        verification: null
      },
      {
        sessionId: 'sess-legacy-05',
        name: 'Legacy-Sync-Worker',
        projectFolder: 'legacy-sync',
        cwd: '~/projects/legacy-sync',
        pid: 9104,
        enabled: false,
        isProcessAlive: false,
        ageMinutes: 45,
        status: 'DISABLED',
        model: 'claude-3-7-sonnet',
        features: { autoContinue: false, autoFix: false, autoImprove: false },
        limitNotice: null,
        llmEvaluation: {
          status: 'DISABLED',
          summary: 'Agent monitoring paused by user',
          reasoning: 'User toggled off monitoring for this agent.',
          evaluatedAt: new Date().toISOString()
        },
        lastPrompt: 'Run daily database synchronization',
        lastAssistantMessage: 'Sync complete: 852 rows updated.',
        verification: null
      }
    ]
  };
}

function getDemoEvents() {
  return [
    {
      id: 'e1',
      timestamp: new Date(Date.now() - 4000).toISOString(),
      type: 'AUTO_FIX_TRIGGERED',
      sessionName: 'Project-Aurora',
      message: '🛠️ Session complete: Dispatched Auto-Fix & Pixel-Perfect Bug Audit loop'
    },
    {
      id: 'e2',
      timestamp: new Date(Date.now() - 22000).toISOString(),
      type: 'LIMIT_DETECTED',
      sessionName: 'Quantum-Engine',
      message: '🧠 LLM Identified Limit: Weekly quota reached (Auto-resumes in 42m)'
    },
    {
      id: 'e3',
      timestamp: new Date(Date.now() - 60000).toISOString(),
      type: 'VERIFIED_WORKING',
      sessionName: 'Data-Harvester',
      message: 'Agent verified running! Responded in 1.4s (+4,280B)'
    },
    {
      id: 'e4',
      timestamp: new Date(Date.now() - 180000).toISOString(),
      type: 'INFO',
      sessionName: 'SYSTEM',
      message: 'Agent Sentinel Cognitive Monitor Online on Port 3456'
    }
  ];
}

function renderDashboard(status) {
  currentStatus = status;

  if (status.config && (!settingsModal || settingsModal.style.display === 'none' || settingsModal.style.display === '')) {
    syncSettingsToModal(status.config);
  }

  handleHibernationBanner(status.hibernation);
  if (status.settling) {
    handleSettlingBanner(status.settling);
  } else if (!status.hibernation?.pending) {
    handleSettlingBanner(null);
  }

  statTotalAgents.textContent = status.stats.totalScanned || 0;
  statActiveAgents.textContent = status.stats.activeRunning || 0;
  statLimitedAgents.textContent = status.stats.limited || 0;
  statResumedVerified.textContent = status.stats.resumedAndVerified || 0;
  agentCountBadge.textContent = status.agents ? status.agents.length : 0;

  const limited = (status.agents || []).filter(a => a.status === 'LIMITED' && a.enabled && !status.config?.globalPaused);
  if (limited.length > 0) {
    limitHeroSection.style.display = 'block';

    const hasWeekly = limited.some(a => a.limitNotice?.kind === 'weekly_limit');
    const hasSession = limited.some(a => a.limitNotice?.kind !== 'weekly_limit');

    const heroTitle = document.getElementById('limitHeroTitle');
    const heroDesc = document.getElementById('limitHeroDesc');

    if (heroTitle && heroDesc) {
      if (hasWeekly && !hasSession) {
        heroTitle.textContent = limited.length === 1
          ? 'Weekly Quota Limit Detected'
          : 'Weekly Quota Limits Detected';
        heroDesc.textContent = limited.length === 1
          ? 'An agent reached its weekly token quota limit. Standing by to automatically dispatch "continue" when the reset arrives.'
          : 'Agents reached their weekly token quota limit. Standing by to automatically dispatch "continue" when the reset arrives.';
      } else if (hasSession && !hasWeekly) {
        heroTitle.textContent = limited.length === 1
          ? 'Session Rate Limit Detected'
          : 'Session Rate Limits Detected';
        heroDesc.textContent = limited.length === 1
          ? 'An agent reached its 5-hour session token limit. Standing by to automatically dispatch "continue" when the reset arrives.'
          : 'Agents reached their 5-hour session token limit. Standing by to automatically dispatch "continue" when the reset arrives.';
      } else {
        heroTitle.textContent = 'Session & Weekly Limits Detected';
        heroDesc.textContent = 'Agents reached session and weekly token limits. Standing by to automatically dispatch "continue" when their respective resets arrive.';
      }
    }

    limitAgentStrip.innerHTML = limited.map(a => {
      const isWeekly = a.limitNotice?.kind === 'weekly_limit';
      return `
        <div class="limited-pill ${isWeekly ? 'weekly-pill' : 'session-pill'}">
          <span>⚠️ ${escapeHtml(a.name)}</span>
          <span>•</span>
          <span style="font-weight: 600;">${isWeekly ? 'Weekly Limit' : 'Session Limit (5-hr)'}</span>
        </div>
      `;
    }).join('');
  } else {
    limitHeroSection.style.display = 'none';
  }

  let filtered = status.agents || [];
  if (currentFilter === 'active') {
    filtered = filtered.filter(a => a.enabled && (a.status === 'ACTIVE' || a.status === 'RESUMING' || a.status === 'VERIFYING'));
  } else if (currentFilter === 'limited') {
    filtered = filtered.filter(a => a.enabled && a.status === 'LIMITED');
  } else if (currentFilter === 'idle') {
    filtered = filtered.filter(a => a.enabled && a.status === 'IDLE');
  } else if (currentFilter === 'disabled') {
    filtered = filtered.filter(a => !a.enabled || a.status === 'PAUSED' || a.status === 'DISABLED');
  }

  if (filtered.length === 0) {
    if (lastRenderedAgentsSignature !== `empty_${currentFilter}`) {
      lastRenderedAgentsSignature = `empty_${currentFilter}`;
      agentsContainer.innerHTML = `
        <div class="empty-state">
          <p>No agents matching filter "${currentFilter}"</p>
        </div>
      `;
    }
    return;
  }

  const currentRenderSignature = JSON.stringify(filtered.map(a => ({
    sessionId: a.sessionId,
    status: a.status,
    enabled: a.enabled,
    features: a.features,
    llmEvaluation: a.llmEvaluation,
    activeSubagents: a.activeSubagents?.length,
    activeTasks: a.activeTasks?.length,
    verification: a.verification,
    limitNotice: a.limitNotice,
    ageMinutes: a.ageMinutes,
    lastAssistantMessage: a.lastAssistantMessage
  })));

  if (currentRenderSignature !== lastRenderedAgentsSignature) {
    lastRenderedAgentsSignature = currentRenderSignature;
    agentsContainer.innerHTML = filtered.map(agent => renderAgentCard(agent)).join('');
  }
  updateCountdowns();
}

let lastRenderedAgentsSignature = '';

function renderAgentCard(agent) {
  const isEnabled = agent.enabled !== false && !currentStatus?.config?.globalPaused;
  const isLimited = agent.status === 'LIMITED';
  const isVerifying = agent.status === 'VERIFYING' || agent.status === 'RESUMING';
  const isActive = agent.status === 'ACTIVE';
  const isAutoFixing = agent.status === 'AUTO_FIXING';
  const isAutoImproving = agent.status === 'AUTO_IMPROVING';

  const features = agent.features || { autoContinue: true, autoFix: false, autoImprove: false };

  let statusBadgeClass = 'status-badge-idle';
  let statusText = 'IDLE';
  if (currentStatus?.config?.globalPaused) {
    statusBadgeClass = 'status-badge-disabled';
    statusText = 'PAUSED';
  } else if (!isEnabled) {
    statusBadgeClass = 'status-badge-disabled';
    statusText = 'PAUSED';
  } else if (isAutoFixing) {
    statusBadgeClass = 'status-badge-autofix';
    statusText = '🛠️ AUTO FIXING';
  } else if (isAutoImproving) {
    statusBadgeClass = 'status-badge-autoimprove';
    statusText = '🚀 AUTO IMPROVING';
  } else if (isActive) {
    statusBadgeClass = 'status-badge-active';
    statusText = '● ACTIVE';
  } else if (isLimited) {
    statusBadgeClass = 'status-badge-limited';
    statusText = '⚠️ RATE LIMITED';
  } else if (isVerifying) {
    statusBadgeClass = 'status-badge-verifying';
    statusText = '⚡ VERIFYING';
  }

  const resetMs = agent.limitNotice?.resetAtMs || 0;
  const now = Date.now();
  const initialRemaining = (resetMs && resetMs > now) ? formatTimeRemaining(resetMs - now) : '00:00:00';
  const llmEval = agent.llmEvaluation;

  return `
    <div class="agent-card status-${agent.status.toLowerCase().replace(/_/g, '-')} ${!isEnabled ? 'status-disabled' : ''}">
      <div class="agent-header">
        <div class="agent-title-area">
          <span class="agent-name">${escapeHtml(agent.name)}</span>
          <span class="agent-pid-chip">PID ${agent.pid || 'N/A'}</span>
          ${agent.isProcessAlive ? '<span style="font-size:10px; color:#10b981; font-weight:600;">● RUNNING</span>' : '<span style="font-size:10px; color:#64748b;">○ STOPPED</span>'}
        </div>

        <div class="agent-header-actions">
          <div class="agent-controls-group">
            <!-- Monitored Checkbox -->
            <label class="agent-checkbox-pill ${isEnabled ? 'active-monitored' : ''}" title="Toggle automatic supervision for this agent">
              <input type="checkbox" class="agent-toggle-monitored" data-session-id="${agent.sessionId}" ${agent.enabled !== false ? 'checked' : ''}>
              <span>Monitored</span>
            </label>

            <!-- Auto Continue Checkbox -->
            <label class="agent-checkbox-pill ${features.autoContinue ? 'active-continue' : ''}" title="Auto-resume agent with 'continue' when session/weekly limits reset">
              <input type="checkbox" class="agent-toggle-feature" data-session-id="${agent.sessionId}" data-feature="autoContinue" ${features.autoContinue ? 'checked' : ''} ${!isEnabled ? 'disabled' : ''}>
              <span>Auto continue</span>
            </label>

            <!-- Auto Fix Checkbox -->
            <label class="agent-checkbox-pill ${features.autoFix ? 'active-fix' : ''}" title="Auto-prompt with multi-pass bug & pixel-perfect audit loop when task completes">
              <input type="checkbox" class="agent-toggle-feature" data-session-id="${agent.sessionId}" data-feature="autoFix" ${features.autoFix ? 'checked' : ''} ${!isEnabled ? 'disabled' : ''}>
              <span>Auto fix</span>
            </label>

            <!-- Auto Improve Checkbox -->
            <label class="agent-checkbox-pill risky ${features.autoImprove ? 'active-improve' : ''}" title="Auto-prompt with deep architectural, performance & polish loop when task completes (Risky)">
              <input type="checkbox" class="agent-toggle-feature" data-session-id="${agent.sessionId}" data-feature="autoImprove" ${features.autoImprove ? 'checked' : ''} ${!isEnabled ? 'disabled' : ''}>
              <span>Auto improve <span class="risky-tag">⚡</span></span>
            </label>
          </div>

          <div class="agent-status-badge ${statusBadgeClass}">${statusText}</div>
        </div>
      </div>

      ${llmEval ? `
        <div class="llm-eval-panel">
          <div class="llm-eval-header">
            <span class="llm-eval-tag">🧠 LLM Supervisor Interpretation</span>
            <span class="llm-eval-time">${new Date(llmEval.evaluatedAt).toLocaleTimeString()}</span>
          </div>
          <div class="llm-eval-summary">${escapeHtml(llmEval.summary)}</div>
          <div class="llm-eval-reasoning">${escapeHtml(llmEval.reasoning)}</div>
        </div>
      ` : ''}

      <div class="agent-meta-row">
        <div class="meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span class="meta-item-mono" title="${escapeHtml(agent.cwd)}">${truncate(agent.cwd, 45)}</span>
        </div>
        <div class="meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>Last message: ${agent.ageMinutes}m ago</span>
        </div>
        <div class="meta-item">
          <span style="background: rgba(99,102,241,0.15); color:#818cf8; padding: 2px 8px; border-radius: 4px; font-size:11px; font-weight:600;">${agent.model || 'claude-3-7-sonnet'}</span>
        </div>
      </div>

      ${isLimited && isEnabled ? `
        <div class="limit-banner">
          <div class="limit-banner-text">
            <strong>${agent.limitNotice.kind === 'weekly_limit' ? 'Weekly Limit' : 'Session Limit'}:</strong>
            Auto-resuming in <span class="live-card-countdown limit-banner-countdown" data-reset-ms="${resetMs}">${initialRemaining}</span>
          </div>
          <button class="btn btn-outline btn-xs btn-resume-agent" data-session-id="${agent.sessionId}">Force Continue Now</button>
        </div>
      ` : ''}

      ${agent.lastPrompt ? `
        <div class="agent-bubble">
          <div class="agent-bubble-label">Last User Prompt</div>
          <div class="agent-bubble-text">"${escapeHtml(truncate(agent.lastPrompt, 180))}"</div>
        </div>
      ` : ''}

      ${agent.lastAssistantMessage ? `
        <div class="agent-bubble" style="background: #0d1527;">
          <div class="agent-bubble-label" style="color: #38bdf8;">Last Agent Response / Activity</div>
          <div class="agent-bubble-text" style="color: #cbd5e1;">${escapeHtml(truncate(agent.lastAssistantMessage, 200))}</div>
        </div>
      ` : ''}

      ${agent.activeSubagents && agent.activeSubagents.length > 0 ? `
        <div class="agent-subagents-panel">
          <div class="subagents-header">
            <span class="subagents-icon">⚙️</span>
            <span class="subagents-title">${agent.activeSubagents.length} Active Subagent${agent.activeSubagents.length > 1 ? 's' : ''} Working in Background</span>
          </div>
          <div class="subagents-list">
            ${agent.activeSubagents.map(sub => `
              <div class="subagent-item">
                <span class="subagent-type">${escapeHtml(sub.agentType || 'task')}</span>
                <span class="subagent-desc" title="${escapeHtml(sub.description)}">${escapeHtml(truncate(sub.description, 70))}</span>
                <span class="subagent-badge">● Active (${sub.ageMinutes}m ago)</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${agent.activeTasks && agent.activeTasks.length > 0 ? `
        <div class="agent-tasks-panel">
          <div class="tasks-header">
            <span class="tasks-icon">⏳</span>
            <span class="tasks-title">${agent.activeTasks.length} Background Task${agent.activeTasks.length > 1 ? 's' : ''} Running:</span>
          </div>
          <div class="tasks-list">
            ${agent.activeTasks.map(t => `
              <div class="task-item">
                <span class="task-badge">RUNNING</span>
                <span class="task-desc" title="${escapeHtml(t.command || t.description)}">${escapeHtml(truncate(t.description || t.taskId, 65))}</span>
                <span class="task-time">${t.ageMinutes}m ago</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="agent-footer">
        <div class="agent-footer-info">
          ${agent.verification ? `
            <span class="verified-tag">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              Verified Active (+${agent.verification.fileSizeChange}B in ${(agent.verification.latencyMs/1000).toFixed(1)}s)
            </span>
          ` : `<span style="font-size:11px; color:#64748b;">Session: <code>${agent.sessionId.slice(0, 8)}</code></span>`}
        </div>
        <div class="agent-footer-actions">
          <button class="btn btn-outline btn-xs btn-manual-action" data-session-id="${agent.sessionId}" data-action="autofix" title="Trigger Auto-Fix bug review prompt now">🛠️ Fix</button>
          <button class="btn btn-outline btn-xs btn-manual-action" data-session-id="${agent.sessionId}" data-action="autoimprove" title="Trigger Auto-Improve optimization prompt now">🚀 Improve</button>
          <button class="btn btn-outline btn-xs btn-manual-action" data-session-id="${agent.sessionId}" data-action="continue" title="Send continue prompt now">▶ Continue</button>
        </div>
      </div>
    </div>
  `;
}

function formatEventTimestamp(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (isToday) return `Today ${timePart}`;
  if (isYesterday) return `Yesterday ${timePart}`;
  const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${datePart} ${timePart}`;
}

function renderEvents(events) {
  if (!events || events.length === 0) {
    eventsContainer.innerHTML = '<div class="empty-state"><p>No events logged yet</p></div>';
    return;
  }
  eventsContainer.innerHTML = events.map(evt => {
    const timeStr = formatEventTimestamp(evt.timestamp);
    return `
      <div class="event-entry">
        <div class="event-top">
          <span class="event-type-badge evt-${evt.type}">${evt.type}</span>
          <span class="event-time">${timeStr}</span>
        </div>
        <div class="event-msg">${escapeHtml(evt.message)}</div>
        ${evt.sessionName ? `<div class="event-target">Agent: ${escapeHtml(evt.sessionName)}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function fetchStatus() {
  if (isDemo) {
    renderDashboard(getDemoState());
    return;
  }
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    renderDashboard(data);
  } catch (e) {
    console.error('Failed to fetch status:', e);
  }
}

async function fetchEvents() {
  if (isDemo) {
    renderEvents(getDemoEvents());
    return;
  }
  try {
    const res = await fetch('/api/events');
    const data = await res.json();
    renderEvents(data);
  } catch (e) {
    console.error('Failed to fetch events:', e);
  }
}

async function toggleGlobalPause() {
  const newPaused = !(currentStatus?.config?.globalPaused);
  if (isDemo) {
    showToast(`Global Monitoring ${newPaused ? 'PAUSED' : 'RESUMED'} (demo)`, newPaused ? '⏸️' : '▶️');
    return;
  }
  try {
    const res = await fetch('/api/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: newPaused })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Global Monitoring ${data.globalPaused ? 'PAUSED' : 'RESUMED'}`, data.globalPaused ? '⏸️' : '▶️');
      fetchStatus();
    }
  } catch (e) {
    showToast(`Error toggling pause: ${e.message}`, '❌');
  }
}

async function shutdownServer() {
  showToast('Shutting down Sentinel server...', '⏻');
  try {
    await fetch('/api/shutdown', { method: 'POST' });
    setTimeout(() => {
      document.body.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:Inter,sans-serif; color:#94a3b8; text-align:center;">
          <h2 style="color:#f8fafc; margin-bottom:10px;">Agent Sentinel Stopped</h2>
          <p>Server process terminated. You can relaunch at any time from your AI supervisor or by running <strong>"npm start"</strong>.</p>
        </div>
      `;
    }, 600);
  } catch (e) {
    showToast(`Shutdown error: ${e.message}`, '❌');
  }
}

async function saveSettingsFromModal() {
  const lookbackHours = parseInt(inputLookback.value, 10) || 24;
  const recheckIntervalSeconds = parseInt(inputRecheck.value, 10) || 120;
  const hibernateOnWeeklyLimit = modalToggleHibernate.checked;
  const hibernateOnAllCompleted = modalToggleHibernateOnCompletion.checked;
  const defaultAutoContinue = modalToggleAutoContinue.checked;
  const defaultAutoFix = modalToggleAutoFix.checked;
  const defaultAutoImprove = modalToggleAutoImprove.checked;
  const authorizeSubagents = modalToggleAuthorizeSubagents.checked;
  const verificationTimeoutSeconds = parseInt(inputVerifyTimeout.value, 10) || 60;
  const auditRetentionDays = inputAuditRetention ? (parseInt(inputAuditRetention.value, 10) || 30) : 30;

  if (isDemo) {
    showToast('Configuration saved (demo mode)!', '⚙️');
    settingsModal.style.display = 'none';
    return;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lookbackHours,
        recheckIntervalSeconds,
        hibernateOnWeeklyLimit,
        hibernateOnAllCompleted,
        autoResumeEnabled: defaultAutoContinue,
        defaultAutoContinue,
        defaultAutoFix,
        defaultAutoImprove,
        authorizeSubagents,
        verificationTimeoutSeconds,
        auditRetentionDays
      })
    });
    const data = await res.json();
    if (data.ok) {
      if (hibernateOnAllCompleted) {
        if (data.armedOnCompletion) {
          showToast('Configuration saved: Hibernate on Completion is ARMED! 💤', '⚙️');
        } else {
          showToast('Configuration saved (Note: No active agents to arm hibernation) ℹ️', '⚙️');
        }
      } else {
        showToast('Configuration saved successfully!', '⚙️');
      }
      settingsModal.style.display = 'none';
      fetchStatus();
    }
  } catch (e) {
    showToast(`Failed to save settings: ${e.message}`, '❌');
  }
}

async function toggleAgentMonitoring(sessionId, enabled) {
  if (isDemo) {
    showToast(`Agent monitoring ${enabled ? 'ENABLED' : 'PAUSED'} (demo)`, enabled ? '✅' : '⏸️');
    return;
  }
  try {
    const res = await fetch('/api/toggle-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, enabled })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Agent monitoring ${enabled ? 'ENABLED' : 'PAUSED'}`, enabled ? '✅' : '⏸️');
      fetchStatus();
    }
  } catch (e) {
    showToast(`Toggle error: ${e.message}`, '❌');
  }
}

async function cancelHibernateAction() {
  try {
    const res = await fetch('/api/cancel-hibernation', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast('Hibernation sequence cancelled!', '🛡️');
      hibernationBanner.style.display = 'none';
      if (hibernationInterval) clearInterval(hibernationInterval);
      fetchStatus();
    }
  } catch (e) {
    showToast(`Error cancelling hibernation: ${e.message}`, '❌');
  }
}

async function toggleAgentFeature(sessionId, feature, enabled) {
  const label = feature === 'autoFix' ? 'Auto Fix' : (feature === 'autoImprove' ? 'Auto Improve' : 'Auto Continue');
  if (isDemo) {
    showToast(`${label} ${enabled ? 'ENABLED' : 'DISABLED'} for agent (demo)`, '⚙️');
    return;
  }
  try {
    const res = await fetch('/api/toggle-agent-feature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, feature, enabled })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`${label} ${enabled ? 'ENABLED' : 'DISABLED'} for agent`, enabled ? '✅' : '⏸️');
      fetchStatus();
    }
  } catch (e) {
    showToast(`Feature toggle error: ${e.message}`, '❌');
  }
}

async function triggerAgentAction(sessionId, action) {
  const label = action === 'autofix' ? 'Auto-Fix Bug Audit' : (action === 'autoimprove' ? 'Auto-Improve Optimization' : 'Continue');
  showToast(`Dispatching ${label} to agent...`, '⚡');
  if (isDemo) {
    setTimeout(() => showToast(`${label} dispatched (demo mode)!`, '✅'), 600);
    return;
  }
  try {
    const res = await fetch('/api/trigger-agent-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, action })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message, '✅');
      fetchStatus();
      fetchEvents();
    } else {
      showToast(`Error: ${data.error}`, '❌');
    }
  } catch (e) {
    showToast(`Network error: ${e.message}`, '❌');
  }
}

async function resumeAgentManually(sessionId) {
  return triggerAgentAction(sessionId, 'continue');
}

function initSSE() {
  if (isDemo) return;
  const evtSource = new EventSource('/api/stream');

  evtSource.onopen = () => {
    if (sentinelStatusBadge && !currentStatus?.config?.globalPaused) {
      sentinelStatusBadge.className = 'sentinel-badge live';
      sentinelStatusText.textContent = 'LLM COGNITIVE MONITOR';
    }
  };

  evtSource.onerror = () => {
    if (sentinelStatusBadge && !currentStatus?.config?.globalPaused) {
      sentinelStatusBadge.className = 'sentinel-badge offline';
      sentinelStatusText.textContent = 'RECONNECTING...';
    }
  };

  evtSource.addEventListener('status', (e) => {
    try {
      const data = JSON.parse(e.data);
      renderDashboard(data);
    } catch (err) {}
  });

  evtSource.addEventListener('hibernation_status', (e) => {
    try {
      const hib = JSON.parse(e.data);
      handleHibernationBanner(hib);
    } catch (err) {}
  });

  evtSource.addEventListener('settling_status', (e) => {
    try {
      const settling = JSON.parse(e.data);
      handleSettlingBanner(settling);
    } catch (err) {}
  });

  evtSource.addEventListener('event', (e) => {
    try {
      const evt = JSON.parse(e.data);
      if (evt.type === 'VERIFIED_WORKING') {
        showToast(`🎉 ${evt.sessionName} verified running!`, '✅');
      } else if (evt.type === 'LIMIT_DETECTED') {
        showToast(`⚠️ ${evt.sessionName} reached limit!`, '⏳');
      } else if (evt.type === 'RESUME_TRIGGERED') {
        showToast(`⚡ ${evt.sessionName}: Dispatched "continue"`, '🚀');
      } else if (evt.type === 'AUTO_FIX_TRIGGERED') {
        showToast(`🛠️ ${evt.sessionName}: Dispatched Auto-Fix Loop!`, '🔍');
      } else if (evt.type === 'AUTO_IMPROVE_TRIGGERED') {
        showToast(`🚀 ${evt.sessionName}: Dispatched Auto-Improve Loop!`, '⚡');
      } else if (evt.type === 'HIBERNATE_TRIGGERED') {
        const isAllComp = evt.metadata?.triggerType === 'all_completed';
        showToast(isAllComp ? '💤 All agents completed: Hibernating PC in 30s...' : '💤 Weekly limit: Hibernating PC in 30s...', '⚠️');
      }
      fetchEvents();
    } catch (err) {}
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max = 80) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Event Listeners
if (btnTogglePause) btnTogglePause.addEventListener('click', toggleGlobalPause);

if (btnExitServer) {
  btnExitServer.addEventListener('click', () => {
    if (exitModal) exitModal.style.display = 'flex';
  });
}
if (btnCloseExit) {
  btnCloseExit.addEventListener('click', () => {
    if (exitModal) exitModal.style.display = 'none';
  });
}
if (btnCancelExit) {
  btnCancelExit.addEventListener('click', () => {
    if (exitModal) exitModal.style.display = 'none';
  });
}
// Prompt Inspector Modal Logic
async function fetchAndRenderPrompts(targetTab = null) {
  let promptData = null;
  if (!isDemo) {
    try {
      const res = await fetch('/api/prompts');
      promptData = await res.json();
    } catch (e) {}
  }

  if (!promptData || !promptData.prompts) {
    // Fallback demo / offline prompts
    const allowSubs = modalToggleAuthorizeSubagents ? modalToggleAuthorizeSubagents.checked : true;
    const subClause = allowSubs ? '(or spawn dedicated adversarial subagents)' : '(without spawning subagents)';
    promptData = {
      authorizeSubagents: allowSubs,
      prompts: {
        continue: { prompt: 'continue' },
        autofix: {
          prompt: `Perform an exhaustive adversarial code & visual hardening audit:

1. MULTI-DIMENSIONAL ADVERSARIAL REVIEW:
Adopt a rigorous adversarial red-team mindset ${subClause} to stress-test your implementation against the original specifications:
- Actively attempt to break edge cases, input validation, concurrency boundaries, and error handling.
- Verify exact compliance against all stated requirements and design constraints without making charitable assumptions.

2. BUG & FUNCTIONAL INTEGRITY AUDIT:
Conduct a meticulous deep-dive across all modified and related files to guarantee 100% bug-free behavior, type safety, test passing, and robust error recovery.

3. PIXEL-PERFECT VISUAL & UX SCRUTINY:
Adversarially scrutinize all UI components, layouts, typography, animations, color palettes, and responsive breakpoints to guarantee a flawless, pixel-perfect user experience.

4. REGRESSION & DIFF VERIFICATION:
Inspect git diffs line-by-line to ensure zero regressions, no unintended side effects, and clean code hygiene.

5. MULTI-PASS CONVERGENCE LOOP:
Continue independent, adversarial review passes in a loop until no further bugs, discrepancies, edge-case failures, or improvements can be found. If any issue is discovered, fix it cleanly and re-validate before concluding.`
        },
        autoimprove: {
          prompt: `Perform an autonomous deep enhancement and optimization cycle for this project:
${allowSubs ? '\n(You are explicitly authorized to spawn specialized subagents to isolate profiling and refactoring tasks.)\n' : ''}
1. ARCHITECTURE & CODE HEALTH:
Analyze the codebase for latency bottlenecks, unnecessary allocations, redundant disk/network I/O, and code duplication. Refactor complex or brittle logic into clean, modular, maintainable patterns while maintaining strict backward compatibility.

2. USER EXPERIENCE & VISUAL/API POLISH:
Elevate the UX/UI or API ergonomics to a world-class standard. Ensure fluid interactions, robust feedback, intuitive defaults, clean logs, and pixel-perfect presentation.

3. RESILIENCE & EDGE-CASE HARDENING:
Identify potential failure modes (network timeouts, malformed inputs, race conditions, file permission limits, cold starts) and implement defensive guards, graceful degradation, and actionable error messages.

4. COMPREHENSIVE TEST & INTEGRITY VALIDATION:
Run all test suites, linters, and type-checks. Add test coverage for newly optimized paths and verify that the system runs flawlessly at peak performance. Keep iterating until no further improvements are possible.`
        }
      }
    };
  }

  if (promptTextAutoFix) promptTextAutoFix.textContent = promptData.prompts.autofix?.prompt || '';
  if (promptTextAutoImprove) promptTextAutoImprove.textContent = promptData.prompts.autoimprove?.prompt || '';
  if (promptTextContinue) promptTextContinue.textContent = promptData.prompts.continue?.prompt || 'continue';

  const subIndicatorText = promptData.authorizeSubagents ? '● Subagents Authorized' : '○ Direct Execution (No Subagents)';
  const subIndicatorStyle = promptData.authorizeSubagents
    ? { background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.2)' }
    : { background: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', borderColor: 'rgba(148, 163, 184, 0.2)' };

  if (subagentStatusIndicatorFix) {
    subagentStatusIndicatorFix.textContent = subIndicatorText;
    Object.assign(subagentStatusIndicatorFix.style, subIndicatorStyle);
  }
  if (subagentStatusIndicatorImprove) {
    subagentStatusIndicatorImprove.textContent = subIndicatorText;
    Object.assign(subagentStatusIndicatorImprove.style, subIndicatorStyle);
  }

  if (targetTab) {
    document.querySelectorAll('.prompt-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === targetTab);
    });
    if (targetTab === 'autofix') {
      document.getElementById('tabContentAutoFix').classList.add('active');
      document.getElementById('tabContentAutoImprove').classList.remove('active');
      document.getElementById('tabContentContinue').classList.remove('active');
    } else if (targetTab === 'autoimprove') {
      document.getElementById('tabContentAutoFix').classList.remove('active');
      document.getElementById('tabContentAutoImprove').classList.add('active');
      document.getElementById('tabContentContinue').classList.remove('active');
    } else if (targetTab === 'continue') {
      document.getElementById('tabContentAutoFix').classList.remove('active');
      document.getElementById('tabContentAutoImprove').classList.remove('active');
      document.getElementById('tabContentContinue').classList.add('active');
    }
  }

  promptsModal.style.display = 'flex';
}

// Prompt Tabs Switcher
document.querySelectorAll('.prompt-tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.prompt-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.prompt-tab-content').forEach(c => c.classList.remove('active'));
    e.currentTarget.classList.add('active');
    const tab = e.currentTarget.dataset.tab;
    if (tab === 'autofix') document.getElementById('tabContentAutoFix').classList.add('active');
    else if (tab === 'autoimprove') document.getElementById('tabContentAutoImprove').classList.add('active');
    else if (tab === 'continue') document.getElementById('tabContentContinue').classList.add('active');
  });
});

// Copy Prompt Buttons
document.querySelectorAll('.btn-copy-prompt').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const targetId = e.currentTarget.dataset.target;
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      navigator.clipboard.writeText(targetEl.textContent).then(() => {
        showToast('Prompt copied to clipboard!', '📋');
      }).catch(() => {
        showToast('Failed to copy prompt', '❌');
      });
    }
  });
});

if (btnOpenPrompts) {
  btnOpenPrompts.addEventListener('click', () => fetchAndRenderPrompts('autofix'));
}
if (btnSettingsInspectPrompts) {
  btnSettingsInspectPrompts.addEventListener('click', () => {
    settingsModal.style.display = 'none';
    fetchAndRenderPrompts('autofix');
  });
}
if (btnClosePrompts) {
  btnClosePrompts.addEventListener('click', () => promptsModal.style.display = 'none');
}
if (btnClosePromptsFooter) {
  btnClosePromptsFooter.addEventListener('click', () => promptsModal.style.display = 'none');
}
if (promptsModal) {
  promptsModal.addEventListener('click', (e) => {
    if (e.target === promptsModal) promptsModal.style.display = 'none';
  });
}

if (btnConfirmExit) {
  btnConfirmExit.addEventListener('click', () => {
    if (exitModal) exitModal.style.display = 'none';
    shutdownServer();
  });
}
if (exitModal) {
  exitModal.addEventListener('click', (e) => {
    if (e.target === exitModal) exitModal.style.display = 'none';
  });
}

if (btnOpenSettings) {
  btnOpenSettings.addEventListener('click', () => {
    if (currentStatus && currentStatus.config) syncSettingsToModal(currentStatus.config);
    if (settingsModal) settingsModal.style.display = 'flex';
  });
}

if (btnCloseSettings) {
  btnCloseSettings.addEventListener('click', () => {
    if (settingsModal) settingsModal.style.display = 'none';
  });
}

if (btnCancelSettings) {
  btnCancelSettings.addEventListener('click', () => {
    if (settingsModal) settingsModal.style.display = 'none';
  });
}

if (btnSaveSettings) {
  btnSaveSettings.addEventListener('click', saveSettingsFromModal);
}

if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.style.display = 'none';
  });
}

if (btnCancelHibernate) {
  btnCancelHibernate.addEventListener('click', cancelHibernateAction);
}

if (btnScanNow) {
  btnScanNow.addEventListener('click', async () => {
    showToast('Scanning active Claude Code transcripts...', '🔍');
    if (!isDemo) await fetch('/api/scan', { method: 'POST' });
    fetchStatus();
    fetchEvents();
  });
}

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', async () => {
    if (confirm('Clear all audit logs from memory and disk?')) {
      if (!isDemo) {
        try {
          await fetch('/api/events/clear', { method: 'POST' });
        } catch (e) {
          console.error('Failed to clear logs:', e);
        }
      }
      if (eventsContainer) eventsContainer.innerHTML = '<div class="empty-state"><p>Logs cleared</p></div>';
      showToast('Audit stream cleared', '🗑️');
    }
  });
}

filterTabs.forEach(tab => {
  tab.addEventListener('click', (e) => {
    filterTabs.forEach(t => t.classList.remove('active'));
    e.currentTarget.classList.add('active');
    currentFilter = e.currentTarget.dataset.filter;
    if (currentStatus) renderDashboard(currentStatus);
  });
});

if (agentsContainer) {
  agentsContainer.addEventListener('change', (e) => {
    if (e.target.matches('.agent-toggle-monitored')) {
      const sid = e.target.dataset.sessionId;
      const enabled = e.target.checked;
      toggleAgentMonitoring(sid, enabled);
    } else if (e.target.matches('.agent-toggle-feature')) {
      const sid = e.target.dataset.sessionId;
      const feature = e.target.dataset.feature;
      const enabled = e.target.checked;
      toggleAgentFeature(sid, feature, enabled);
    }
  });

  agentsContainer.addEventListener('click', (e) => {
    const btnManual = e.target.closest('.btn-manual-action');
    if (btnManual) {
      const sid = btnManual.dataset.sessionId;
      const action = btnManual.dataset.action;
      triggerAgentAction(sid, action);
      return;
    }
    const btnResume = e.target.closest('.btn-resume-agent');
    if (btnResume) {
      const sid = btnResume.dataset.sessionId;
      triggerAgentAction(sid, 'continue');
      return;
    }
  });
}

if (btnDisarmSettling) {
  btnDisarmSettling.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/cancel-hibernation', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        showToast('Settling countdown disarmed!', '🛡️');
        if (settlingBanner) settlingBanner.style.display = 'none';
        if (settlingInterval) clearInterval(settlingInterval);
        fetchStatus();
      }
    } catch (e) {
      showToast(`Error disarming: ${e.message}`, '❌');
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (promptsModal && promptsModal.style.display === 'flex') {
      promptsModal.style.display = 'none';
    }
    if (settingsModal && settingsModal.style.display === 'flex') {
      settingsModal.style.display = 'none';
    }
    if (exitModal && exitModal.style.display === 'flex') {
      exitModal.style.display = 'none';
    }
  }
});

fetchStatus();
fetchEvents();
initSSE();
startCountdownTicking();

if (!isDemo) {
  setInterval(() => {
    fetchStatus();
    fetchEvents();
  }, 3000);
}
