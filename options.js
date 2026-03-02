const PROVIDER_DEFAULTS = {
  anthropic: {
    model: 'claude-sonnet-4-5-20250514',
    baseUrl: '',
    placeholder: 'sk-ant-...',
    helpText: 'Enter your Claude API key.',
    helpLink: 'https://console.anthropic.com/',
    helpLinkText: 'Get one here',
  },
  openai: {
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com',
    placeholder: 'sk-...',
    helpText: 'Enter your API key. Works with OpenAI, Groq, Together, Mistral, Ollama, and any OpenAI-compatible API.',
    helpLink: 'https://platform.openai.com/api-keys',
    helpLinkText: 'Get an OpenAI key',
  },
};

document.addEventListener('DOMContentLoaded', async () => {
  const providerBtns = document.querySelectorAll('.provider-btn');
  const apiKeyInput = document.getElementById('apiKey');
  const apiKeyHelp = document.getElementById('apiKeyHelp');
  const apiKeyLink = document.getElementById('apiKeyLink');
  const baseUrlField = document.getElementById('baseUrlField');
  const baseUrlInput = document.getElementById('baseUrl');
  const modelInput = document.getElementById('model');
  const toggleBtn = document.getElementById('toggleVisibility');
  const saveBtn = document.getElementById('save');
  const statusEl = document.getElementById('status');

  let currentProvider = 'anthropic';

  // --- Provider switching ---

  function applyProviderDefaults(provider, fillValues = false) {
    const defaults = PROVIDER_DEFAULTS[provider];

    // Toggle active button
    providerBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.provider === provider);
    });

    // Show/hide base URL field
    baseUrlField.style.display = provider === 'openai' ? '' : 'none';

    // Update placeholder and help text
    apiKeyInput.placeholder = defaults.placeholder;
    apiKeyHelp.childNodes[0].textContent = defaults.helpText + ' ';
    apiKeyLink.href = defaults.helpLink;
    apiKeyLink.textContent = defaults.helpLinkText;

    if (fillValues) {
      modelInput.value = defaults.model;
      baseUrlInput.value = defaults.baseUrl;
    }

    // Update model placeholder
    modelInput.placeholder = defaults.model;
  }

  providerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const newProvider = btn.dataset.provider;
      if (newProvider === currentProvider) return;
      currentProvider = newProvider;
      applyProviderDefaults(newProvider, true);
      // Clear API key when switching providers since keys are different
      apiKeyInput.value = '';
    });
  });

  // --- Load existing settings ---

  const stored = await chrome.storage.local.get(['provider', 'apiKey', 'baseUrl', 'model']);

  currentProvider = stored.provider || 'anthropic';
  applyProviderDefaults(currentProvider, false);

  if (stored.apiKey) apiKeyInput.value = stored.apiKey;
  if (stored.model) {
    modelInput.value = stored.model;
  } else {
    modelInput.value = PROVIDER_DEFAULTS[currentProvider].model;
  }
  if (stored.baseUrl) {
    baseUrlInput.value = stored.baseUrl;
  } else {
    baseUrlInput.value = PROVIDER_DEFAULTS[currentProvider].baseUrl;
  }

  // --- Toggle key visibility ---

  toggleBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleBtn.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      toggleBtn.textContent = 'Show';
    }
  });

  // --- Save ---

  saveBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();

    if (!key) {
      showStatus('Please enter an API key.', 'error');
      return;
    }

    const settings = {
      provider: currentProvider,
      apiKey: key,
      model: modelInput.value.trim() || PROVIDER_DEFAULTS[currentProvider].model,
    };

    if (currentProvider === 'openai') {
      settings.baseUrl = baseUrlInput.value.trim() || PROVIDER_DEFAULTS[currentProvider].baseUrl;
    } else {
      settings.baseUrl = '';
    }

    await chrome.storage.local.set(settings);
    showStatus('Saved!', 'success');
  });

  // --- Test Connection ---

  const testBtn = document.getElementById('testBtn');

  testBtn.addEventListener('click', async () => {
    // Save settings first so background has them
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus('Please enter an API key first.', 'error');
      return;
    }

    const settings = {
      provider: currentProvider,
      apiKey: key,
      model: modelInput.value.trim() || PROVIDER_DEFAULTS[currentProvider].model,
    };
    if (currentProvider === 'openai') {
      settings.baseUrl = baseUrlInput.value.trim() || PROVIDER_DEFAULTS[currentProvider].baseUrl;
    } else {
      settings.baseUrl = '';
    }
    await chrome.storage.local.set(settings);

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';

    chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' }, (response) => {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';

      if (response && response.success) {
        showStatus('Connection successful!', 'success');
      } else {
        showStatus(`Connection failed: ${response?.error || 'Unknown error'}`, 'error');
      }
    });
  });

  function showStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = type;
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = '';
    }, 3000);
  }
});
