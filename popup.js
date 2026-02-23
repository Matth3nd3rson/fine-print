const content = document.getElementById('content');
let currentTabId = null;
let thinkingInterval = null;

const THINKING_VERBS = [
  'Analyzing',
  'Crunching',
  'Demystifying',
  'Unraveling',
  'Dejargoning',
  'Decorporatifying',
  'Decoding',
  'Translating',
  'Scrutinizing',
  'Dissecting',
  'Sniffing around',
  'Grokking',
  'Unearthing',
  'Unwrapping',
  'Having a peek',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startThinkingVerbs() {
  if (thinkingInterval) clearInterval(thinkingInterval);
  const verbs = shuffle(THINKING_VERBS);
  let index = 0;
  // Set first random verb immediately
  document.querySelectorAll('.thinking-text').forEach(el => {
    el.textContent = `${verbs[index]}...`;
  });
  thinkingInterval = setInterval(() => {
    index = (index + 1) % verbs.length;
    document.querySelectorAll('.thinking-text').forEach(el => {
      el.textContent = `${verbs[index]}...`;
    });
  }, 2000);
}

function stopThinkingVerbs() {
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
  }
}

// --- Rendering ---

function renderEmpty() {
  content.innerHTML = `
    <div class="state-empty">
      <div class="icon">&#128196;</div>
      <p>No legal agreement detected on this page.</p>
      <button class="scan-btn" id="scanBtn">Scan this page</button>
    </div>
  `;
  document.getElementById('scanBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'MANUAL_SCAN', tabId: currentTabId });
    content.innerHTML = `
      <div class="state-analyzing">
        <div class="spinner"></div>
        <p class="thinking-text">Scanning...</p>
      </div>
    `;
    startThinkingVerbs();
  });
}

function renderDetected(state) {
  content.innerHTML = `
    <div class="state-detected">
      <div class="icon">&#128270;</div>
      <p>A legal agreement was detected on this page.<br>
      <strong>${escapeHtml(state.title || '')}</strong></p>
      <button class="analyze-btn" id="analyzeBtn">Analyze Fine Print</button>
    </div>
  `;
  document.getElementById('analyzeBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'ANALYZE', tabId: currentTabId });
    renderAnalyzing();
  });
}

function renderAnalyzing() {
  content.innerHTML = `
    <div class="state-analyzing">
      <div class="spinner"></div>
      <p class="thinking-text">Analyzing...</p>
    </div>
  `;
  startThinkingVerbs();
}

function renderError(state) {
  const isKeyError = state.error === 'no_api_key';
  content.innerHTML = `
    <div class="state-error">
      <div class="error-msg">
        ${isKeyError
          ? 'No API key configured. <span class="settings-link" id="openSettings">Open settings</span> to add your API key.'
          : `Error: ${escapeHtml(state.error || 'Unknown error')}`
        }
      </div>
      ${!isKeyError ? '<button class="retry-btn" id="retryBtn">Retry</button>' : ''}
    </div>
  `;

  if (isKeyError) {
    document.getElementById('openSettings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  } else {
    document.getElementById('retryBtn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'ANALYZE', tabId: currentTabId });
      renderAnalyzing();
    });
  }
}

// --- Consent Links State ---

function renderConsentLinks(state) {
  const links = state.consentLinks || [];
  const results = state.linkResults || {};

  let html = `
    <div class="state-consent">
      <div class="consent-header">
        <span class="consent-badge">i</span>
        <span class="consent-title">This page references legal agreements</span>
      </div>
      <p class="consent-subtitle">Review before you agree:</p>
      <div class="consent-links-list">
  `;

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const result = results[i];
    const domain = getDomain(link.url);

    html += `<div class="consent-link-card" data-index="${i}">`;
    html += `
      <div class="consent-link-info">
        <div class="consent-link-name">${escapeHtml(link.text)}</div>
        <div class="consent-link-url">${escapeHtml(domain)}</div>
      </div>
    `;

    if (!result) {
      // Not yet analyzed
      html += `<button class="consent-analyze-btn" data-index="${i}">Analyze</button>`;
    } else if (result.status === 'analyzing') {
      html += `<div class="consent-link-spinner"><div class="spinner-sm"></div><span class="thinking-text">Analyzing...</span></div>`;
    } else if (result.status === 'error') {
      html += `<div class="consent-link-error">${escapeHtml(result.error)}</div>`;
    } else if (result.status === 'has_sublinks') {
      html += `<div class="consent-link-result"><span class="sublink-badge">hub page</span></div>`;
    } else if (result.status === 'complete') {
      const analysis = result.analysis;
      const highCount = result.highCount || 0;
      html += `
        <div class="consent-link-result">
          <span class="risk-badge ${analysis.overallRisk}">${analysis.overallRisk} risk</span>
          ${highCount > 0 ? `<span class="consent-finding-count">${highCount} red flag${highCount > 1 ? 's' : ''}</span>` : ''}
        </div>
      `;
    }

    html += `</div>`;

    // Sub-links: show drillable links from directory/hub pages
    if (result && result.status === 'has_sublinks' && result.subLinks?.length > 0) {
      html += `<div class="sublinks-container">`;
      html += `<div class="sublinks-label">This page links to multiple documents:</div>`;
      for (let j = 0; j < result.subLinks.length; j++) {
        const sub = result.subLinks[j];
        const subKey = `${i}_sub_${j}`;
        const subResult = results[subKey];
        const subDomain = getDomain(sub.url);

        html += `<div class="consent-link-card sublink-card" data-key="${subKey}">`;
        html += `
          <div class="consent-link-info">
            <div class="consent-link-name">${escapeHtml(sub.text)}</div>
            <div class="consent-link-url">${escapeHtml(subDomain)}</div>
          </div>
        `;

        if (!subResult) {
          html += `<button class="consent-analyze-btn sublink-analyze-btn" data-key="${subKey}" data-url="${escapeHtml(sub.url)}">Analyze</button>`;
        } else if (subResult.status === 'analyzing') {
          html += `<div class="consent-link-spinner"><div class="spinner-sm"></div><span class="thinking-text">Analyzing...</span></div>`;
        } else if (subResult.status === 'error') {
          html += `<div class="consent-link-error">${escapeHtml(subResult.error)}</div>`;
        } else if (subResult.status === 'has_sublinks') {
          html += `<div class="consent-link-error">Another hub page — try opening directly.</div>`;
        } else if (subResult.status === 'complete') {
          const subAnalysis = subResult.analysis;
          const subHighCount = subResult.highCount || 0;
          html += `
            <div class="consent-link-result">
              <span class="risk-badge ${subAnalysis.overallRisk}">${subAnalysis.overallRisk} risk</span>
              ${subHighCount > 0 ? `<span class="consent-finding-count">${subHighCount} red flag${subHighCount > 1 ? 's' : ''}</span>` : ''}
            </div>
          `;
        }

        html += `</div>`;

        // Show findings for completed sub-links
        if (subResult && subResult.status === 'complete' && subResult.analysis.findings?.length > 0) {
          html += renderConsentFindings(subResult.analysis, subKey);
        }
      }
      html += `</div>`;
    }

    // If this link has complete results, show expandable findings below the card
    if (result && result.status === 'complete' && result.analysis.findings?.length > 0) {
      html += renderConsentFindings(result.analysis, i);
    }
  }

  html += `</div></div>`;
  content.innerHTML = html;

  // Attach analyze button handlers (top-level consent links)
  content.querySelectorAll('.consent-analyze-btn:not(.sublink-analyze-btn)').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      chrome.runtime.sendMessage({
        type: 'ANALYZE_URL',
        tabId: currentTabId,
        url: links[index].url,
        linkIndex: index,
      });
      btn.outerHTML = `<div class="consent-link-spinner"><div class="spinner-sm"></div><span class="thinking-text">Analyzing...</span></div>`;
      startThinkingVerbs();
    });
  });

  // Attach analyze button handlers (sub-links from hub pages)
  content.querySelectorAll('.sublink-analyze-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const url = btn.dataset.url;
      chrome.runtime.sendMessage({
        type: 'ANALYZE_URL',
        tabId: currentTabId,
        url: url,
        linkIndex: key,
      });
      btn.outerHTML = `<div class="consent-link-spinner"><div class="spinner-sm"></div><span class="thinking-text">Analyzing...</span></div>`;
      startThinkingVerbs();
    });
  });

  // Start thinking verbs if any links are currently analyzing
  if (content.querySelector('.thinking-text')) {
    startThinkingVerbs();
  }

  // Attach expand/collapse handlers for findings
  content.querySelectorAll('.finding-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.finding-card').classList.toggle('expanded');
    });
  });
}

function renderConsentFindings(analysis, linkIndex) {
  const findings = analysis.findings || [];
  if (findings.length === 0) return '';

  let html = `<div class="consent-findings">`;
  html += `<div class="consent-findings-summary">${escapeHtml(analysis.summary)}</div>`;

  const highFindings = findings.filter(f => f.severity === 'high');
  const mediumFindings = findings.filter(f => f.severity === 'medium');
  const lowFindings = findings.filter(f => f.severity === 'low');

  if (highFindings.length > 0) html += renderFindingsSection('Red Flags', highFindings);
  if (mediumFindings.length > 0) html += renderFindingsSection('Warnings', mediumFindings);
  if (lowFindings.length > 0) html += renderFindingsSection('Notes', lowFindings);

  html += `</div>`;
  return html;
}

// --- Results Rendering (shared) ---

function renderResults(state) {
  const analysis = state.analysis;
  if (!analysis || !analysis.findings) {
    renderEmpty();
    return;
  }

  const highFindings = analysis.findings.filter(f => f.severity === 'high');
  const mediumFindings = analysis.findings.filter(f => f.severity === 'medium');
  const lowFindings = analysis.findings.filter(f => f.severity === 'low');

  let html = `
    <div class="summary-card">
      <div class="summary-header">
        <span class="risk-badge ${analysis.overallRisk}">${analysis.overallRisk} risk</span>
      </div>
      <div class="summary-text">${escapeHtml(analysis.summary)}</div>
    </div>
  `;

  if (analysis.findings.length === 0) {
    html += '<div class="no-findings">No notable findings in this agreement.</div>';
  }

  if (highFindings.length > 0) html += renderFindingsSection('Red Flags', highFindings);
  if (mediumFindings.length > 0) html += renderFindingsSection('Warnings', mediumFindings);
  if (lowFindings.length > 0) html += renderFindingsSection('Notes', lowFindings);

  content.innerHTML = html;

  content.querySelectorAll('.finding-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.finding-card').classList.toggle('expanded');
    });
  });
}

function renderFindingsSection(title, findings) {
  let html = `<div class="findings-section"><div class="findings-section-title">${title}</div>`;
  for (const f of findings) {
    html += `
      <div class="finding-card severity-${f.severity}">
        <div class="finding-header">
          <span class="severity-label ${f.severity}">${
            f.severity === 'high' ? 'RED FLAG' : f.severity === 'medium' ? 'WARNING' : 'NOTE'
          }</span>
          <span class="category-tag">${escapeHtml(f.category)}</span>
          <span class="finding-title">${escapeHtml(f.title)}</span>
          <span class="expand-icon">&#9660;</span>
        </div>
        <div class="finding-details">
          <p class="explanation">${escapeHtml(f.explanation)}</p>
          ${f.quote ? `<blockquote class="quote">${escapeHtml(f.quote)}</blockquote>` : ''}
        </div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

// --- Utilities ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// --- State Management ---

function renderState(state) {
  stopThinkingVerbs();
  if (!state) {
    renderEmpty();
    return;
  }

  switch (state.status) {
    case 'detected':
      renderDetected(state);
      break;
    case 'consent_links':
      renderConsentLinks(state);
      break;
    case 'analyzing':
      renderAnalyzing();
      break;
    case 'complete':
      renderResults(state);
      break;
    case 'not_legal':
      renderEmpty();
      break;
    case 'error':
      renderError(state);
      break;
    default:
      renderEmpty();
  }
}

// Listen for state changes while popup is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !currentTabId) return;
  const key = `tab_${currentTabId}`;
  if (changes[key]) {
    renderState(changes[key].newValue);
  }
});

// Initialize
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    renderEmpty();
    return;
  }

  currentTabId = tab.id;

  chrome.runtime.sendMessage({ type: 'GET_STATE', tabId: currentTabId }, (state) => {
    renderState(state);
  });
}

init();
