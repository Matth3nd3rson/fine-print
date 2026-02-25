// --- Badge Management ---

function updateBadge(tabId, status, count) {
  switch (status) {
    case 'detected':
      chrome.action.setBadgeText({ text: '!', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#F59E0B', tabId });
      break;
    case 'consent_links':
      chrome.action.setBadgeText({ text: 'i', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#6366F1', tabId });
      break;
    case 'analyzing':
      chrome.action.setBadgeText({ text: '...', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#6B7280', tabId });
      break;
    case 'complete':
      if (count > 0) {
        chrome.action.setBadgeText({ text: String(count), tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#EF4444', tabId });
      } else {
        chrome.action.setBadgeText({ text: '\u2713', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#10B981', tabId });
      }
      break;
    case 'error':
      chrome.action.setBadgeText({ text: 'ERR', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#EF4444', tabId });
      break;
    default:
      chrome.action.setBadgeText({ text: '', tabId });
  }
}

// --- Icon Generation ---

function generateIcons() {
  const sizes = [16, 32, 48, 128];
  const imageData = {};

  for (const size of sizes) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.round(size * 0.38)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FP', size / 2, size / 2 + 1);

    imageData[size] = ctx.getImageData(0, 0, size, size);
  }

  chrome.action.setIcon({ imageData });
}

// --- LLM API ---

const SYSTEM_PROMPT = `You are a consumer rights legal analyst. Your job is to analyze Terms of Service, Privacy Policies, EULAs, and similar legal agreements and identify clauses that are concerning, unusual, or disadvantageous for the user/consumer.

Analyze the provided legal document and return a JSON response with this exact structure:

{
  "summary": "A 2-3 sentence plain-English summary of what this agreement covers and its overall stance toward the user.",
  "overallRisk": "low" | "medium" | "high",
  "findings": [
    {
      "severity": "high" | "medium" | "low",
      "category": "string",
      "title": "Short descriptive title (under 10 words)",
      "explanation": "Plain-English explanation of what this means for the user and why it matters. 1-2 sentences.",
      "quote": "The relevant excerpt from the document (keep under 100 words)"
    }
  ]
}

Severity guidelines:
- HIGH: Clauses that significantly harm user rights or are unusual/aggressive. Examples: mandatory binding arbitration, class action waivers, broad intellectual property assignment, unlimited liability for user, unilateral right to change terms without notice, perpetual irrevocable content licenses, waiver of right to jury trial.
- MEDIUM: Clauses worth knowing about that give the company significant advantages. Examples: automatic renewal, broad data sharing with third parties, extensive data collection, right to terminate accounts without cause, right to modify services without notice, broad limitation of liability.
- LOW: Standard clauses that are common but users should be aware of. Examples: governing law/jurisdiction, standard indemnification, standard warranty disclaimers, age requirements.

Categories to use: "Arbitration", "Class Action", "IP Rights", "Liability", "Data Privacy", "Data Sharing", "Account Termination", "Content License", "Price Changes", "Auto-Renewal", "Governing Law", "Indemnification", "Warranty", "Modification of Terms", "Third Party", "Other".

Rules:
- Return ONLY valid JSON. No markdown, no code fences, no commentary outside the JSON.
- Order findings by severity (high first, then medium, then low).
- Include the most relevant direct quote for each finding.
- If the document is not actually a legal agreement, return: {"error": "not_legal_document", "summary": "This does not appear to be a legal agreement."}
- Be specific and actionable. Do not use vague language.
- Aim for completeness but do not fabricate findings that are not supported by the text.`;

// --- Provider-specific API calls ---

async function callAnthropic(settings, text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model || 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Analyze the following legal document:\n\n${text}` },
        ],
      }),
    });

    if (!response.ok) {
      let errorMsg = `API error: ${response.status}`;
      try {
        const errorBody = await response.json();
        errorMsg = errorBody.error?.message || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const result = await response.json();
    return result.content[0].text;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAICompatible(settings, text) {
  const baseUrl = (settings.baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model || 'gpt-4o-mini',
        max_tokens: 2048,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze the following legal document:\n\n${text}` },
        ],
      }),
    });

    if (!response.ok) {
      let errorMsg = `API error: ${response.status}`;
      try {
        const errorBody = await response.json();
        errorMsg = errorBody.error?.message || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const result = await response.json();
    return result.choices[0].message.content;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// --- HTML to Text (for fetching linked legal pages) ---

function htmlToText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 25000) {
    text = text.substring(0, 25000) + '\n\n[Text truncated at 25,000 characters]';
  }
  return text;
}

// --- Extract legal links from HTML (for directory/hub pages) ---

function extractLegalLinks(html, baseUrl) {
  const linkRegex = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links = [];
  const seen = new Set();
  let match;

  const legalKeywords = [
    'privacy', 'terms', 'policy', 'legal', 'agreement', 'cookie',
    'notice', 'rights', 'consent', 'gdpr', 'ccpa', 'data protection',
    'eula', 'acceptable use', 'conditions', 'subscriber',
  ];

  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();

    if (!text || text.length > 120 || text.length < 3) continue;

    // Resolve relative URLs
    try {
      href = new URL(href, baseUrl).href;
    } catch { continue; }

    // Skip same-page anchors, javascript:, mailto:, etc.
    if (!href.startsWith('http')) continue;
    if (seen.has(href)) continue;
    // Skip if it's the same page we already fetched
    if (href === baseUrl || href === baseUrl + '/') continue;
    seen.add(href);

    const combined = (text + ' ' + href).toLowerCase();
    if (legalKeywords.some(kw => combined.includes(kw))) {
      links.push({ url: href, text });
    }
  }

  return links;
}

// --- LLM Analysis (shared by direct page and URL fetch) ---

async function callLLM(settings, text) {
  const provider = settings.provider || 'anthropic';
  if (provider === 'anthropic') {
    return await callAnthropic(settings, text);
  } else {
    return await callOpenAICompatible(settings, text);
  }
}

function parseAnalysis(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Failed to parse analysis response');
  }
}

// --- Analysis: page text already extracted ---

async function analyzeTOS(tabId) {
  const stateKey = `tab_${tabId}`;
  const stored = await chrome.storage.session.get(stateKey);
  const state = stored[stateKey];

  if (!state || !state.text) {
    updateBadge(tabId, 'error');
    return;
  }

  const settings = await chrome.storage.local.get(['provider', 'apiKey', 'baseUrl', 'model']);

  if (!settings.apiKey) {
    await chrome.storage.session.set({
      [stateKey]: { ...state, status: 'error', error: 'no_api_key' },
    });
    updateBadge(tabId, 'error');
    return;
  }

  await chrome.storage.session.set({
    [stateKey]: { ...state, status: 'analyzing', analyzeStartedAt: Date.now() },
  });
  updateBadge(tabId, 'analyzing');

  // Hard 60s deadline for the entire analysis flow
  const deadline = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Analysis timed out. Please try again.')), 60000)
  );

  try {
    const rawText = await Promise.race([callLLM(settings, state.text), deadline]);
    const analysis = parseAnalysis(rawText);

    if (analysis.error === 'not_legal_document') {
      await chrome.storage.session.set({
        [stateKey]: { ...state, status: 'not_legal', analysis, timestamp: Date.now() },
      });
      updateBadge(tabId, '');
      return;
    }

    const highCount = (analysis.findings || []).filter(f => f.severity === 'high').length;
    const totalCount = (analysis.findings || []).length;

    await chrome.storage.session.set({
      [stateKey]: {
        ...state,
        status: 'complete',
        analysis,
        highCount,
        totalCount,
        timestamp: Date.now(),
      },
    });
    updateBadge(tabId, 'complete', highCount);
  } catch (err) {
    await chrome.storage.session.set({
      [stateKey]: { ...state, status: 'error', error: err.message },
    });
    updateBadge(tabId, 'error');
  }
}

// --- Analysis: fetch URL and analyze (for consent links) ---

async function analyzeURL(tabId, url, linkIndex) {
  const stateKey = `tab_${tabId}`;
  const stored = await chrome.storage.session.get(stateKey);
  const state = stored[stateKey];

  if (!state) return;

  const settings = await chrome.storage.local.get(['provider', 'apiKey', 'baseUrl', 'model']);

  if (!settings.apiKey) {
    await chrome.storage.session.set({
      [stateKey]: { ...state, status: 'error', error: 'no_api_key' },
    });
    updateBadge(tabId, 'error');
    return;
  }

  // Mark this specific link as analyzing
  const linkResults = { ...(state.linkResults || {}) };
  linkResults[linkIndex] = { status: 'analyzing' };
  await chrome.storage.session.set({
    [stateKey]: { ...state, linkResults },
  });

  try {
    // Fetch the linked page (15s timeout)
    const fetchController = new AbortController();
    const fetchTimeout = setTimeout(() => fetchController.abort(), 15000);
    let html;
    try {
      const response = await fetch(url, { signal: fetchController.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch (${response.status})`);
      }
      html = await response.text();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Page took too long to load.');
      throw err;
    } finally {
      clearTimeout(fetchTimeout);
    }
    const text = htmlToText(html);

    if (text.length < 500) {
      linkResults[linkIndex] = {
        status: 'error',
        error: 'Page content too short to analyze. Try opening the link directly.',
      };
      await chrome.storage.session.set({
        [stateKey]: { ...state, linkResults },
      });
      return;
    }

    // Analyze with LLM
    const rawText = await callLLM(settings, text);
    const analysis = parseAnalysis(rawText);

    if (analysis.error === 'not_legal_document') {
      // This might be a directory/hub page — extract legal links from it
      const subLinks = extractLegalLinks(html, url);
      if (subLinks.length > 0) {
        linkResults[linkIndex] = {
          status: 'has_sublinks',
          subLinks,
        };
      } else {
        linkResults[linkIndex] = {
          status: 'error',
          error: 'This does not appear to be a legal agreement.',
        };
      }
      await chrome.storage.session.set({
        [stateKey]: { ...state, linkResults },
      });
      return;
    }

    const highCount = (analysis.findings || []).filter(f => f.severity === 'high').length;

    linkResults[linkIndex] = {
      status: 'complete',
      analysis,
      highCount,
    };
    await chrome.storage.session.set({
      [stateKey]: { ...state, linkResults },
    });

    // Update badge to show highest findings count across all analyzed links
    const maxHigh = Math.max(
      ...Object.values(linkResults)
        .filter(r => r.status === 'complete')
        .map(r => r.highCount || 0)
    );
    updateBadge(tabId, 'complete', maxHigh);
  } catch (err) {
    linkResults[linkIndex] = {
      status: 'error',
      error: err.message,
    };
    await chrome.storage.session.set({
      [stateKey]: { ...state, linkResults },
    });
  }
}

// --- Event Listeners ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content script: legal page detected
  if (message.type === 'TOS_DETECTED' && sender.tab) {
    const tabId = sender.tab.id;
    const stateKey = `tab_${tabId}`;

    chrome.storage.session.set({
      [stateKey]: {
        status: 'detected',
        url: message.data.url,
        title: message.data.title,
        text: message.data.text,
        detectionMethod: message.data.detectionMethod,
        timestamp: Date.now(),
      },
    });
    updateBadge(tabId, 'detected');
  }

  // Content script: consent links found on page
  if (message.type === 'CONSENT_LINKS_DETECTED' && sender.tab) {
    const tabId = sender.tab.id;
    const stateKey = `tab_${tabId}`;

    chrome.storage.session.set({
      [stateKey]: {
        status: 'consent_links',
        url: message.data.url,
        title: message.data.title,
        consentLinks: message.data.links,
        linkResults: {},
        timestamp: Date.now(),
      },
    });
    updateBadge(tabId, 'consent_links');
  }

  // Popup: analyze page text directly
  if (message.type === 'ANALYZE') {
    analyzeTOS(message.tabId);
  }

  // Popup: fetch and analyze a linked URL
  if (message.type === 'ANALYZE_URL') {
    analyzeURL(message.tabId, message.url, message.linkIndex);
  }

  // Options: test API connection
  if (message.type === 'TEST_CONNECTION') {
    (async () => {
      try {
        const settings = await chrome.storage.local.get(['provider', 'apiKey', 'baseUrl', 'model']);
        if (!settings.apiKey) {
          sendResponse({ success: false, error: 'No API key saved.' });
          return;
        }
        // Minimal call to validate the key
        const testText = 'Respond with the word OK.';
        if (settings.provider === 'openai') {
          const baseUrl = (settings.baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`,
              },
              body: JSON.stringify({
                model: settings.model || 'gpt-4o-mini',
                max_tokens: 10,
                messages: [{ role: 'user', content: testText }],
              }),
            });
            if (!resp.ok) {
              const body = await resp.json().catch(() => ({}));
              throw new Error(body.error?.message || `HTTP ${resp.status}`);
            }
            sendResponse({ success: true });
          } finally { clearTimeout(timeout); }
        } else {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            const resp = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': settings.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
              },
              body: JSON.stringify({
                model: settings.model || 'claude-haiku-4-5-20251001',
                max_tokens: 10,
                messages: [{ role: 'user', content: testText }],
              }),
            });
            if (!resp.ok) {
              const body = await resp.json().catch(() => ({}));
              throw new Error(body.error?.message || `HTTP ${resp.status}`);
            }
            sendResponse({ success: true });
          } finally { clearTimeout(timeout); }
        }
      } catch (err) {
        const msg = err.name === 'AbortError' ? 'Connection timed out.' : err.message;
        sendResponse({ success: false, error: msg });
      }
    })();
    return true;
  }

  // Popup: manual re-scan (re-injects content script, then sends SCAN_ALL flag)
  if (message.type === 'MANUAL_SCAN') {
    chrome.scripting.executeScript({
      target: { tabId: message.tabId },
      files: ['content.js'],
    }).then(() => {
      chrome.tabs.sendMessage(message.tabId, { type: 'SCAN_ALL' });
    });
  }

  // Popup: get current state
  if (message.type === 'GET_STATE') {
    const stateKey = `tab_${message.tabId}`;
    chrome.storage.session.get(stateKey).then(async (stored) => {
      const state = stored[stateKey] || null;

      // Auto-clear stuck analyzing state after 90 seconds
      if (state && state.status === 'analyzing' && state.analyzeStartedAt
          && Date.now() - state.analyzeStartedAt > 60000) {
        const timedOut = { ...state, status: 'error', error: 'Analysis timed out. Please try again.' };
        await chrome.storage.session.set({ [stateKey]: timedOut });
        updateBadge(message.tabId, 'error');
        sendResponse(timedOut);
        return;
      }

      sendResponse(state);
    });
    return true;
  }
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab_${tabId}`);
});

// Clear state on navigation and tell content script to reset
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.storage.session.remove(`tab_${tabId}`);
    chrome.action.setBadgeText({ text: '', tabId });
    // Reset content script detection flag (handles bfcache/SPA edge cases)
    chrome.tabs.sendMessage(tabId, { type: 'RESET_DETECTION' }).catch(() => {});
  }
});

// Generate icons on install only
chrome.runtime.onInstalled.addListener(() => {
  generateIcons();
});

generateIcons();
