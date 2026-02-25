(() => {
  // Prevent duplicate initialization on re-injection (manual scan)
  if (window.__finePrintInjected) return;
  window.__finePrintInjected = true;

  // URL patterns that indicate a ToS/privacy/legal page
  const TOS_URL_PATTERNS = [
    /[-/]terms[-_]?(of[-_]?(service|use))?/i,
    /\/tos\b/i,
    /[-/]privacy[-_]?(policy|notice)?/i,
    /\/eula\b/i,
    /\/legal\b/i,
    /\/policies\//i,
    /\/cookie[-_]?policy/i,
    /\/acceptable[-_]?use/i,
    /\/data[-_]?processing/i,
    /[-/]user[-_]?agreement/i,
    /\/subscriber[-_]?agreement/i,
    /\/license[-_]?agreement/i,
    /[-/]terms[-_]?and[-_]?conditions/i,
  ];

  const HEADING_KEYWORDS = [
    'terms of service', 'terms and conditions', 'terms of use',
    'privacy policy', 'privacy notice', 'cookie policy',
    'end user license agreement', 'eula', 'user agreement',
    'acceptable use policy', 'data processing agreement',
    'subscriber agreement', 'license agreement', 'service agreement',
  ];

  const LEGAL_KEYWORDS = [
    'hereby', 'notwithstanding', 'indemnify', 'indemnification',
    'liability', 'arbitration', 'jurisdiction', 'governing law',
    'warranty', 'intellectual property', 'terminate', 'termination',
    'confidential', 'personal data', 'data controller', 'data processor',
    'binding agreement', 'waiver', 'severability', 'force majeure',
    'class action', 'dispute resolution', 'limitation of liability',
  ];

  // Consent text patterns — match language near submit buttons / signup forms
  const CONSENT_PATTERNS = [
    /by\s+(clicking|signing|tapping|continuing|registering|creating|submitting|using|proceeding|checking|pressing)/i,
    /\b(i|you)\s+(agree|accept|acknowledge|consent)\s+(to|that)\b/i,
    /subject\s+to\s+(the|our)\s/i,
    /\bhave\s+read\s+(and\s+)?(agree|accept)/i,
    /\bagree\s+to\s+(the|our)\s+(terms|privacy|policy|tos|eula)/i,
  ];

  // Link text/URL keywords for filtering consent links
  const LEGAL_LINK_KEYWORDS = [
    'terms', 'privacy', 'policy', 'eula', 'legal', 'conditions',
    'agreement', 'cookie', 'tos', 'data processing', 'subscriber',
    'acceptable use',
  ];

  const MAX_TEXT_LENGTH = 25000;
  const OBSERVER_TIMEOUT = 10000; // 10s (reduced from 30s)
  const DEBOUNCE_MS = 800;
  const URL_POLL_INTERVAL = 2000;

  const SEARCH_ENGINE_HOSTS = [
    'www.google.com', 'google.com',
    'www.bing.com', 'bing.com',
    'search.yahoo.com',
    'duckduckgo.com', 'www.duckduckgo.com',
    'www.baidu.com', 'baidu.com',
    'yandex.com', 'www.yandex.com',
    'search.brave.com',
  ];

  let hasSentDetection = false;
  let observer = null;
  let debounceTimer = null;
  let urlPollTimer = null;
  let lastUrl = window.location.href;

  function isSearchResultsPage() {
    const host = window.location.hostname;
    const path = window.location.pathname;
    const params = window.location.search;
    return SEARCH_ENGINE_HOSTS.includes(host) &&
      (path === '/search' || path.startsWith('/search') || params.includes('q='));
  }

  // --- Detection ---

  function checkUrlPatterns() {
    const path = window.location.pathname + window.location.search;
    return TOS_URL_PATTERNS.some(p => p.test(path));
  }

  function checkHeadings() {
    const selectors = ['h1', 'h2', 'h3', 'title', '[role="heading"]'];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = (el.textContent || '').toLowerCase().trim();
        if (HEADING_KEYWORDS.some(kw => text.includes(kw))) return true;
      }
    }
    return false;
  }

  function checkInlineLegalText() {
    const containers = document.querySelectorAll(
      'main, article, [role="main"], .content, #content, .main, #main, ' +
      'dialog, [role="dialog"], .modal, .modal-content, [class*="modal"]'
    );
    const candidates = containers.length > 0
      ? containers
      : document.querySelectorAll('body > div, body > section');

    for (const container of candidates) {
      // Use textContent (not innerText) to avoid expensive layout reflow
      const text = (container.textContent || '').toLowerCase();
      if (text.length < 3000) continue;

      let keywordCount = 0;
      for (const kw of LEGAL_KEYWORDS) {
        if (text.includes(kw)) keywordCount++;
      }
      if (keywordCount >= 5) return true;
    }
    return false;
  }

  // --- Signup CTA Detection (gates broader legal link scanning) ---

  function pageHasSignupCTA() {
    const ctaKeywords = [
      'sign up', 'signup', 'subscribe', 'get started', 'create account',
      'register', 'join now', 'start trial', 'free trial', 'start now',
      'try free', 'try for free', 'get access', 'start your',
    ];

    const clickables = document.querySelectorAll(
      'button, a[href], [role="button"], input[type="submit"]'
    );
    for (const el of clickables) {
      const text = (el.textContent || el.value || '').toLowerCase().trim();
      if (text.length > 50) continue;
      if (ctaKeywords.some(kw => text.includes(kw))) return true;
    }

    return false;
  }

  // --- Consent Link Detection ---

  function checkConsentLinks() {
    const elements = document.querySelectorAll('p, label, span, small, div, li, footer');
    const foundLinks = [];
    const seenUrls = new Set();

    for (const el of elements) {
      const text = el.textContent || '';
      // Skip elements that are too long (not consent text) or too short
      if (text.length > 2000 || text.length < 10) continue;

      const matchesConsent = CONSENT_PATTERNS.some(p => p.test(text));
      if (!matchesConsent) continue;

      // Found consent text — extract legal links
      for (const a of el.querySelectorAll('a[href]')) {
        const href = a.href;
        const linkText = a.textContent.trim();
        if (!href || !linkText || seenUrls.has(href)) continue;

        // Check if the link points to a legal document
        const combined = (linkText + ' ' + href).toLowerCase();
        const isLegal = LEGAL_LINK_KEYWORDS.some(kw => combined.includes(kw));
        if (!isLegal) continue;

        seenUrls.add(href);
        foundLinks.push({ url: href, text: linkText });
      }
    }

    // Part 2: On signup/subscribe pages, also scan all links for legal documents
    // Catches footer links, nav links, etc. that aren't wrapped in consent text
    if (foundLinks.length === 0 && pageHasSignupCTA()) {
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href;
        const linkText = a.textContent.trim();
        if (!href || !linkText || linkText.length > 100 || linkText.length < 3) continue;
        if (!href.startsWith('http') || seenUrls.has(href)) continue;

        const combined = (linkText + ' ' + href).toLowerCase();
        const isLegal = LEGAL_LINK_KEYWORDS.some(kw => combined.includes(kw));
        if (!isLegal) continue;

        seenUrls.add(href);
        foundLinks.push({ url: href, text: linkText });
      }
    }

    return foundLinks;
  }

  // --- Text Extraction ---
  // Reads from live DOM — innerText only called once during final extraction

  function extractText() {
    const contentSelectors = [
      'main', 'article', '[role="main"]',
      'dialog[open]', '[role="dialog"]',
      '.modal.show', '.modal.active',
    ];

    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.innerText.trim();
        if (text.length >= 500) {
          return text.length > MAX_TEXT_LENGTH
            ? text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Text truncated at 25,000 characters]'
            : text;
        }
      }
    }

    let text = document.body.innerText.trim();
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Text truncated at 25,000 characters]';
    }
    return text;
  }

  // --- Send Messages ---

  function sendDetection(detectionMethod) {
    if (hasSentDetection) return;

    const text = extractText();
    if (text.length < 500) return;

    hasSentDetection = true;
    stopAll();

    chrome.runtime.sendMessage({
      type: 'TOS_DETECTED',
      data: { text, url: window.location.href, title: document.title, detectionMethod },
    });
  }

  function sendConsentLinks(links) {
    if (hasSentDetection) return;

    hasSentDetection = true;
    stopAll();

    chrome.runtime.sendMessage({
      type: 'CONSENT_LINKS_DETECTED',
      data: { links, url: window.location.href, title: document.title },
    });
  }

  // --- Detection Runner ---

  function tryDetect() {
    if (hasSentDetection) return;
    if (isSearchResultsPage()) return;

    // Tier 1: URL match
    const urlMatch = checkUrlPatterns();
    // Tier 2: Heading match
    const headingMatch = checkHeadings();
    // Tier 3: Inline legal text (only if no URL/heading match)
    const inlineMatch = !urlMatch && !headingMatch ? checkInlineLegalText() : false;

    if (urlMatch || headingMatch || inlineMatch) {
      const method = urlMatch ? 'url' : headingMatch ? 'heading' : 'inline';
      sendDetection(method);
      return;
    }

    // Tier 4: Consent links (only if nothing else matched)
    const consentLinks = checkConsentLinks();
    if (consentLinks.length > 0) {
      sendConsentLinks(consentLinks);
    }
  }

  // --- Observer (only for pages likely to be legal) ---

  function shouldObserve() {
    // Only observe pages that have a URL signal or might load legal content dynamically
    return checkUrlPatterns();
  }

  function stopAll() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (urlPollTimer) {
      clearInterval(urlPollTimer);
      urlPollTimer = null;
    }
  }

  function startObserving() {
    if (hasSentDetection) return;

    observer = new MutationObserver(() => {
      if (hasSentDetection) {
        stopAll();
        return;
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(tryDetect, DEBOUNCE_MS);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false,
    });

    // Auto-stop after timeout
    setTimeout(stopAll, OBSERVER_TIMEOUT);
  }

  // --- SPA URL Polling (lightweight alternative to pushState monkey-patching) ---

  function startUrlPolling() {
    urlPollTimer = setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        hasSentDetection = false;
        stopAll();

        // Small delay for new content to render
        setTimeout(() => {
          tryDetect();
          if (!hasSentDetection && shouldObserve()) {
            startObserving();
            startUrlPolling();
          }
        }, 500);
      }
    }, URL_POLL_INTERVAL);

    // Stop polling after observer timeout
    setTimeout(() => {
      if (urlPollTimer) {
        clearInterval(urlPollTimer);
        urlPollTimer = null;
      }
    }, OBSERVER_TIMEOUT);
  }

  // --- Full Page Legal Link Scan (manual scan only, no CTA gate) ---

  function scanAllLegalLinks() {
    if (hasSentDetection) return;

    // First try normal detection
    tryDetect();
    if (hasSentDetection) return;

    // If nothing found, do an ungated scan of ALL links on the page
    const foundLinks = [];
    const seenUrls = new Set();

    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href;
      const linkText = a.textContent.trim();
      if (!href || !linkText || linkText.length > 100 || linkText.length < 3) continue;
      if (!href.startsWith('http') || seenUrls.has(href)) continue;

      const combined = (linkText + ' ' + href).toLowerCase();
      const isLegal = LEGAL_LINK_KEYWORDS.some(kw => combined.includes(kw));
      if (!isLegal) continue;

      seenUrls.add(href);
      foundLinks.push({ url: href, text: linkText });
    }

    if (foundLinks.length > 0) {
      sendConsentLinks(foundLinks);
    }
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SCAN_ALL') {
      hasSentDetection = false;
      scanAllLegalLinks();
    }
    if (message.type === 'RESET_DETECTION') {
      hasSentDetection = false;
      lastUrl = window.location.href;
      stopAll();
      setTimeout(() => {
        tryDetect();
        if (!hasSentDetection && shouldObserve()) {
          startObserving();
          startUrlPolling();
        }
      }, 500);
    }
  });

  // --- Main ---

  try {
    // Immediate detection attempt
    tryDetect();

    // Only start observer + polling if the page might be legal (URL signals)
    // This prevents observer overhead on Gmail, YouTube, etc.
    if (!hasSentDetection && shouldObserve()) {
      startObserving();
      startUrlPolling();
    }
  } catch (err) {
    // Silent fail — never break the host page
  }
})();
