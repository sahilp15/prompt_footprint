const USER_ID_KEY = 'pf_userId';
const API_BASE_URL = 'https://promptfootprint-production.up.railway.app/api';

document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get([USER_ID_KEY]);
  const userId = result[USER_ID_KEY];

  if (!userId) {
    document.getElementById('pf-sessions-list').innerHTML =
      '<div class="pf-empty">No user ID found. Visit ChatGPT to initialize tracking.</div>';
    return;
  }

  try {
    const resp = await fetch(`${API_BASE_URL}/sessions?userId=${userId}`);
    const sessions = await resp.json();
    renderSummary(sessions);
    renderSessions(sessions);
  } catch (err) {
    document.getElementById('pf-sessions-list').innerHTML =
      '<div class="pf-empty">Could not connect to the PromptFootprint server. Make sure the backend is running.</div>';
  }
});

function renderSummary(sessions) {
  let totalTokens = 0, totalEnergy = 0, totalWater = 0, totalCo2 = 0;
  sessions.forEach(s => {
    totalTokens += s.totalTokens;
    totalEnergy += s.totalEnergyWh;
    totalWater += s.totalWaterMl;
    totalCo2 += s.totalCo2G;
  });

  document.getElementById('pf-total-tokens').textContent = totalTokens.toLocaleString();
  document.getElementById('pf-total-energy').textContent = `${totalEnergy.toFixed(3)} Wh`;
  document.getElementById('pf-total-water').textContent = `${totalWater.toFixed(3)} mL`;
  document.getElementById('pf-total-co2').textContent = `${totalCo2.toFixed(3)} g`;
  document.getElementById('pf-total-sessions').textContent = sessions.length;
}

function renderSessions(sessions) {
  const container = document.getElementById('pf-sessions-list');

  if (sessions.length === 0) {
    container.innerHTML = '<div class="pf-empty">No sessions recorded yet. Start chatting with ChatGPT to begin tracking.</div>';
    return;
  }

  container.innerHTML = sessions.map((session, i) => {
    const start = new Date(session.startTime);
    const end = session.endTime ? new Date(session.endTime) : null;
    const duration = end ? formatDuration(end - start) : 'Active';
    const dateStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const queries = session.queries || [];

    return `
      <div class="pf-session-card">
        <div class="pf-session-header" onclick="toggleQueries(${i})">
          <div class="pf-session-date">
            ${dateStr} <span style="color: var(--pf-text-muted)">${timeStr}</span>
            <span style="color: var(--pf-text-muted); font-size: 11px; margin-left: 8px;">${duration}</span>
          </div>
          <div class="pf-session-metric">
            <div class="pf-session-metric-value">${session.totalTokens.toLocaleString()}</div>
            <div class="pf-session-metric-label">Tokens</div>
          </div>
          <div class="pf-session-metric">
            <div class="pf-session-metric-value" style="color:var(--pf-accent-amber)">${session.totalEnergyWh.toFixed(3)}</div>
            <div class="pf-session-metric-label">Wh</div>
          </div>
          <div class="pf-session-metric">
            <div class="pf-session-metric-value" style="color:var(--pf-accent-blue)">${session.totalWaterMl.toFixed(3)}</div>
            <div class="pf-session-metric-label">mL</div>
          </div>
          <div class="pf-session-metric">
            <div class="pf-session-metric-value">${session.totalCo2G.toFixed(3)}</div>
            <div class="pf-session-metric-label">g CO2</div>
          </div>
          <div class="pf-session-metric">
            <div class="pf-session-metric-value">${session.queryCount}</div>
            <div class="pf-session-metric-label">Queries</div>
          </div>
        </div>
        <div class="pf-session-queries" id="pf-queries-${i}">
          ${queries.length > 0 ? queries.map((q, j) => `
            <div class="pf-query-row">
              <span class="pf-query-num">#${j + 1}</span>
              <span class="pf-query-val">${q.totalTokens} tokens</span>
              <span class="pf-query-val" style="color: var(--pf-accent-amber)">${q.energyWh.toFixed(4)} Wh</span>
              <span class="pf-query-val" style="color: var(--pf-accent-blue)">${q.waterMl.toFixed(4)} mL</span>
              <span class="pf-query-val">${q.co2G.toFixed(4)} g</span>
            </div>
          `).join('') : '<div style="padding: 12px 0; color: var(--pf-text-muted); font-size: 12px;">No query details available</div>'}
        </div>
      </div>
    `;
  }).join('');
}

function toggleQueries(index) {
  const el = document.getElementById(`pf-queries-${index}`);
  if (el) el.classList.toggle('expanded');
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
