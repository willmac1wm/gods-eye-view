/**
 * Client-side controller for the Cape May Dispatch Manager Console (/manager).
 * Loaded as an external module so BROWSER_CSP stays free of 'unsafe-inline'.
 */
const aiStatusPill = document.getElementById('ai-status-pill');
const aiUsageLine = document.getElementById('ai-usage-line');
const btnToggleAi = document.getElementById('btn-toggle-ai');
const inpReqCap = document.getElementById('inp-req-cap');
const inpUsdCap = document.getElementById('inp-usd-cap');
const btnSaveAiCaps = document.getElementById('btn-save-ai-caps');

const inpBannerText = document.getElementById('inp-banner-text');
const selBannerSeverity = document.getElementById('sel-banner-severity');
const inpDefaultTown = document.getElementById('inp-default-town');
const chkReportsOpen = document.getElementById('chk-reports-open');
const btnSaveSettings = document.getElementById('btn-save-settings');

const reportsContainer = document.getElementById('reports-container');
const btnRefreshReports = document.getElementById('btn-refresh-reports');

const layersTbody = document.getElementById('layers-tbody');
const btnSaveLayers = document.getElementById('btn-save-layers');
const toastEl = document.getElementById('mgr-toast');

let state = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.style.display = 'none';
  }, 2800);
}

function renderAiSection(config, llmBudget) {
  const on = Boolean(config?.aiChatEnabled);
  if (aiStatusPill) {
    aiStatusPill.textContent = on ? 'AI Chat ON' : 'AI Chat OFF';
    aiStatusPill.className = `status-pill ${on ? 'on' : 'off'}`;
  }
  if (btnToggleAi) {
    btnToggleAi.textContent = on ? 'Turn AI Chat OFF' : 'Turn AI Chat ON';
    btnToggleAi.className = `btn ${on ? 'btn-danger' : 'btn-ok'}`;
  }
  if (aiUsageLine && llmBudget) {
    aiUsageLine.textContent = `Today (${llmBudget.day || 'UTC'}): ${llmBudget.requests || 0} requests · ${(llmBudget.tokens || 0).toLocaleString('en-US')} tokens · $${Number(llmBudget.usd || 0).toFixed(3)}`;
  }
  if (inpReqCap) inpReqCap.value = String(config?.dailyRequestCap ?? 800);
  if (inpUsdCap) inpUsdCap.value = String(config?.dailyUsdCap ?? 5);
}

function renderSettingsSection(config) {
  const s = config?.settings || {};
  if (inpBannerText) inpBannerText.value = s.bannerText || '';
  if (selBannerSeverity) selBannerSeverity.value = s.bannerSeverity || 'info';
  if (inpDefaultTown) inpDefaultTown.value = s.defaultTown || '';
  if (chkReportsOpen) chkReportsOpen.checked = s.reportsOpen !== false;
}

function renderLayersSection(config, catalog) {
  if (!layersTbody) return;
  const layers = config?.layers || {};
  layersTbody.innerHTML = (catalog || [])
    .map((item) => {
      const cfg = layers[item.id] || { enabledByDefault: item.defaultOn, hidden: false };
      return `<tr data-layer-id="${escapeHtml(item.id)}">
        <td><strong>${escapeHtml(item.name)}</strong> <code style="color:#9ca3af;font-size:0.78rem">${escapeHtml(item.id)}</code></td>
        <td>${escapeHtml(item.group)}</td>
        <td><input type="checkbox" data-field="enabledByDefault" ${cfg.enabledByDefault ? 'checked' : ''}></td>
        <td><input type="checkbox" data-field="hidden" ${cfg.hidden ? 'checked' : ''}></td>
      </tr>`;
    })
    .join('');
}

function renderReportsSection(reports) {
  if (!reportsContainer) return;
  if (!Array.isArray(reports) || !reports.length) {
    reportsContainer.innerHTML = '<div style="color:var(--muted)">No community reports submitted yet.</div>';
    return;
  }
  reportsContainer.innerHTML = reports
    .map((r) => {
      const pillClass =
        r.status === 'approved' ? 'on' : r.status === 'rejected' ? 'off' : 'pending';
      const statusLabel =
        r.status === 'approved'
          ? r.verified
            ? 'Approved · Verified'
            : 'Approved · Public'
          : r.status === 'rejected'
            ? 'Rejected · Private'
            : 'Pending Review';
      const shareHref = `/incidents/report:${encodeURIComponent(r.id)}`;
      return `<div class="report-item" data-report-id="${escapeHtml(r.id)}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div>
            <strong>${escapeHtml(String(r.category || 'other').toUpperCase())}</strong>
            ${r.town ? ` · <span>${escapeHtml(r.town)}</span>` : ''}
            <span style="color:var(--muted);font-size:0.82rem"> · ${escapeHtml(r.createdAt || '')}</span>
          </div>
          <span class="status-pill ${pillClass}">${escapeHtml(statusLabel)}</span>
        </div>
        <p style="margin:8px 0">${escapeHtml(r.text)}</p>
        <div style="font-size:0.8rem;color:var(--muted)">
          ID: <code>${escapeHtml(r.id)}</code>
          ${r.lat != null && r.lon != null ? ` · Approx Location: ${r.lat}, ${r.lon}` : ''}
          ${r.status === 'approved' ? ` · <a href="${escapeHtml(shareHref)}" target="_blank" rel="noopener" style="color:var(--accent)">Open Public Incident Page ↗</a>` : ''}
        </div>
        ${
          r.photo
            ? `<div style="margin-top:8px"><a href="${escapeHtml(r.photo)}" target="_blank" rel="noopener" style="color:var(--accent);font-size:0.84rem">View Attached Photo ↗</a></div>`
            : ''
        }
        <div class="report-actions">
          <button type="button" class="btn btn-ok" data-mod="approve" data-id="${escapeHtml(r.id)}">Approve (Public)</button>
          <button type="button" class="btn btn-primary" data-mod="verify" data-id="${escapeHtml(r.id)}">Approve &amp; Mark Verified</button>
          <button type="button" class="btn btn-warn" data-mod="reject" data-id="${escapeHtml(r.id)}">Reject / Hide</button>
          <button type="button" class="btn btn-danger" data-mod="delete" data-id="${escapeHtml(r.id)}">Delete</button>
        </div>
      </div>`;
    })
    .join('');
}

async function loadState() {
  const res = await fetch('/api/manager/state', { credentials: 'same-origin' });
  if (!res.ok) {
    showToast('Failed to load manager state');
    return;
  }
  state = await res.json();
  renderAiSection(state.config, state.llmBudget);
  renderSettingsSection(state.config);
  renderLayersSection(state.config, state.layerCatalog);
  renderReportsSection(state.reports);
}

async function saveConfigPartial(partial, toastMsg = 'Saved') {
  const res = await fetch('/api/manager/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(partial),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    showToast(data.error || 'Save failed');
    return;
  }
  state.config = data.config;
  state.llmBudget = data.llmBudget;
  renderAiSection(state.config, state.llmBudget);
  renderSettingsSection(state.config);
  showToast(toastMsg);
}

btnToggleAi?.addEventListener('click', () => {
  const next = !state?.config?.aiChatEnabled;
  saveConfigPartial({ aiChatEnabled: next }, `AI Chat turned ${next ? 'ON' : 'OFF'}`);
});

btnSaveAiCaps?.addEventListener('click', () => {
  saveConfigPartial(
    {
      dailyRequestCap: Number(inpReqCap?.value || 0),
      dailyUsdCap: Number(inpUsdCap?.value || 0),
    },
    'AI daily budget caps saved',
  );
});

btnSaveSettings?.addEventListener('click', () => {
  saveConfigPartial(
    {
      settings: {
        bannerText: inpBannerText?.value || '',
        bannerSeverity: selBannerSeverity?.value || 'info',
        defaultTown: inpDefaultTown?.value || '',
        reportsOpen: Boolean(chkReportsOpen?.checked),
      },
    },
    'App settings saved',
  );
});

btnSaveLayers?.addEventListener('click', () => {
  const layers = {};
  for (const tr of layersTbody?.querySelectorAll('tr[data-layer-id]') || []) {
    const id = tr.dataset.layerId;
    const enabledByDefault = Boolean(
      tr.querySelector('input[data-field="enabledByDefault"]')?.checked,
    );
    const hidden = Boolean(tr.querySelector('input[data-field="hidden"]')?.checked);
    layers[id] = { enabledByDefault, hidden };
  }
  saveConfigPartial({ layers }, 'Layer defaults saved');
});

btnRefreshReports?.addEventListener('click', () => loadState());

reportsContainer?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-mod]');
  if (!btn) return;
  const action = btn.dataset.mod;
  const id = btn.dataset.id;
  if (action === 'delete' && !window.confirm(`Delete community report ${id}?`)) {
    return;
  }
  const res = await fetch(`/api/manager/reports/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    showToast(data.error || 'Moderation failed');
    return;
  }
  state.reports = data.reports || [];
  renderReportsSection(state.reports);
  showToast(`Report ${action}d`);
});

loadState();
