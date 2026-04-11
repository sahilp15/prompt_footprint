const USER_ID_KEY = 'pf_userId';
const API_BASE_URL = 'https://promptfootprint-production.up.railway.app/api';

document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get([USER_ID_KEY]);
  const userId = result[USER_ID_KEY];

  if (!userId) {
    const listEl = document.getElementById('pf-sessions-list');
    const errDiv = document.createElement('div');
    errDiv.className = 'pf-empty';
    errDiv.textContent = 'No user ID found. Visit ChatGPT to initialize tracking.';
    listEl.replaceChildren(errDiv);
    return;
  }

  try {
    const resp = await fetch(`${API_BASE_URL}/sessions?userId=${userId}`);
    const sessions = await resp.json();
    renderSummary(sessions);
    renderSessions(sessions);
  } catch (err) {
    const listEl = document.getElementById('pf-sessions-list');
    const errDiv = document.createElement('div');
    errDiv.className = 'pf-empty';
    errDiv.textContent = 'Could not connect to the PromptFootprint server. Make sure the backend is running.';
    listEl.replaceChildren(errDiv);
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

// SECURITY: Build session cards using DOM APIs instead of innerHTML
// to prevent XSS from any server-provided data.
function renderSessions(sessions) {
  const container = document.getElementById('pf-sessions-list');

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pf-empty';
    empty.textContent = 'No sessions recorded yet. Start chatting with ChatGPT to begin tracking.';
    container.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  sessions.forEach((session, i) => {
    const start = new Date(session.startTime);
    const end = session.endTime ? new Date(session.endTime) : null;
    const duration = end ? formatDuration(end - start) : 'Active';
    const dateStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const queries = session.queries || [];

    const card = document.createElement('div');
    card.className = 'pf-session-card';

    // Header
    const header = document.createElement('div');
    header.className = 'pf-session-header';
    header.addEventListener('click', () => toggleQueries(i));

    // Date section
    const dateDiv = document.createElement('div');
    dateDiv.className = 'pf-session-date';
    dateDiv.appendChild(document.createTextNode(dateStr + ' '));
    const timeSpan = document.createElement('span');
    timeSpan.style.color = 'var(--pf-text-muted)';
    timeSpan.textContent = timeStr;
    dateDiv.appendChild(timeSpan);
    const durSpan = document.createElement('span');
    durSpan.style.cssText = 'color: var(--pf-text-muted); font-size: 11px; margin-left: 8px;';
    durSpan.textContent = duration;
    dateDiv.appendChild(durSpan);
    header.appendChild(dateDiv);

    // Metrics
    const metrics = [
      { val: session.totalTokens.toLocaleString(), label: 'Tokens' },
      { val: session.totalEnergyWh.toFixed(3), label: 'Wh', color: 'var(--pf-accent-amber)' },
      { val: session.totalWaterMl.toFixed(3), label: 'mL', color: 'var(--pf-accent-blue)' },
      { val: session.totalCo2G.toFixed(3), label: 'g CO2' },
      { val: String(session.queryCount), label: 'Queries' },
    ];
    metrics.forEach(m => {
      const metricDiv = document.createElement('div');
      metricDiv.className = 'pf-session-metric';
      const valDiv = document.createElement('div');
      valDiv.className = 'pf-session-metric-value';
      if (m.color) valDiv.style.color = m.color;
      valDiv.textContent = m.val;
      const labelDiv = document.createElement('div');
      labelDiv.className = 'pf-session-metric-label';
      labelDiv.textContent = m.label;
      metricDiv.appendChild(valDiv);
      metricDiv.appendChild(labelDiv);
      header.appendChild(metricDiv);
    });

    card.appendChild(header);

    // Queries section
    const queriesDiv = document.createElement('div');
    queriesDiv.className = 'pf-session-queries';
    queriesDiv.id = `pf-queries-${i}`;

    if (queries.length > 0) {
      queries.forEach((q, j) => {
        const row = document.createElement('div');
        row.className = 'pf-query-row';
        const spanData = [
          { cls: 'pf-query-num', text: `#${j + 1}` },
          { cls: 'pf-query-val', text: `${q.totalTokens} tokens` },
          { cls: 'pf-query-val', text: `${q.energyWh.toFixed(4)} Wh`, color: 'var(--pf-accent-amber)' },
          { cls: 'pf-query-val', text: `${q.waterMl.toFixed(4)} mL`, color: 'var(--pf-accent-blue)' },
          { cls: 'pf-query-val', text: `${q.co2G.toFixed(4)} g` },
        ];
        spanData.forEach(s => {
          const span = document.createElement('span');
          span.className = s.cls;
          if (s.color) span.style.color = s.color;
          span.textContent = s.text;
          row.appendChild(span);
        });
        queriesDiv.appendChild(row);
      });
    } else {
      const noQ = document.createElement('div');
      noQ.style.cssText = 'padding: 12px 0; color: var(--pf-text-muted); font-size: 12px;';
      noQ.textContent = 'No query details available';
      queriesDiv.appendChild(noQ);
    }

    card.appendChild(queriesDiv);
    fragment.appendChild(card);
  });

  container.replaceChildren(fragment);
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
