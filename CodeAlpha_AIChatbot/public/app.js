/**
 * arkAI - Frontend Application Logic
 * ARK Ecosystem - Pure OpenRouter Orchestrator
 */

// Storage Keys
const STORAGE_CHATS_KEY = 'arkai_chats_v3';
const STORAGE_ACTIVE_CHAT_KEY = 'arkai_active_chat_id';
const STORAGE_SETTINGS_KEY = 'arkai_settings_v3';
const STORAGE_THEME_KEY = 'arkai_theme_v3';

// App State
let chats = [];
let activeChatId = null;
let isGenerating = false;
let userSettings = {
  apiKey: '',
  persona: 'default',
  customPrompt: '',
  temperature: 0.7,
};

// Preset Prompts
const PERSONA_PROMPTS = {
  default: "You are arkAI, an ultra-fast, intelligent AI orchestrator built for the ARK Ecosystem.",
  developer: "You are arkAI Senior Software Engineer mode. Provide clean, robust, modern, production-grade code with minimal boilerplate and clear explanations.",
  concise: "You are arkAI Concise mode. Give direct, highly factual, bulleted answers without conversational fluff or pleasantries.",
  support: "You are arkAI Support Specialist. Be empathetic, step-by-step, thorough, and user-centric.",
  creative: "You are arkAI Creative mode. Provide evocative, engaging, and original writing with compelling prose.",
};

// ==============================================================================
// INITIALIZATION
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadTheme();
  loadChats();
  setupEventListeners();
  checkBackendHealth();
});

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (saved) {
      userSettings = { ...userSettings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(userSettings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function loadTheme() {
  const savedTheme = localStorage.getItem(STORAGE_THEME_KEY) || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem(STORAGE_THEME_KEY, newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  }
}

// ==============================================================================
// MULTI-CHAT MANAGEMENT
// ==============================================================================

function loadChats() {
  try {
    const raw = localStorage.getItem(STORAGE_CHATS_KEY);
    chats = raw ? JSON.parse(raw) : [];
  } catch (e) {
    chats = [];
  }

  activeChatId = localStorage.getItem(STORAGE_ACTIVE_CHAT_KEY);
  if (!chats.length) {
    createNewChat();
  } else if (!activeChatId || !chats.find(c => c.id === activeChatId)) {
    activeChatId = chats[0].id;
    localStorage.setItem(STORAGE_ACTIVE_CHAT_KEY, activeChatId);
  }

  renderSidebarChats();
  renderChatMessages();
}

function saveChats() {
  try {
    localStorage.setItem(STORAGE_CHATS_KEY, JSON.stringify(chats));
  } catch (e) {
    console.error('Failed to save chats to localStorage:', e);
  }
}

function createNewChat() {
  const newId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const newChat = {
    id: newId,
    title: 'New Conversation',
    createdAt: Date.now(),
    messages: [],
  };

  chats.unshift(newChat);
  activeChatId = newId;
  localStorage.setItem(STORAGE_ACTIVE_CHAT_KEY, activeChatId);
  saveChats();
  renderSidebarChats();
  renderChatMessages();

  // Focus prompt input
  const input = document.getElementById('chat-input');
  if (input) input.focus();
}

function selectChat(id) {
  if (id === activeChatId) return;
  activeChatId = id;
  localStorage.setItem(STORAGE_ACTIVE_CHAT_KEY, activeChatId);
  renderSidebarChats();
  renderChatMessages();

  // Close mobile sidebar if open
  document.getElementById('sidebar')?.classList.remove('open');
}

function renameChat(id) {
  const chat = chats.find(c => c.id === id);
  if (!chat) return;
  const newTitle = prompt('Enter new conversation title:', chat.title);
  if (newTitle && newTitle.trim()) {
    chat.title = newTitle.trim();
    saveChats();
    renderSidebarChats();
  }
}

function deleteChat(id) {
  if (chats.length <= 1) {
    alert('At least one conversation must remain active.');
    return;
  }
  if (!confirm('Are you sure you want to delete this conversation?')) return;

  chats = chats.filter(c => c.id !== id);
  if (activeChatId === id) {
    activeChatId = chats[0].id;
    localStorage.setItem(STORAGE_ACTIVE_CHAT_KEY, activeChatId);
  }
  saveChats();
  renderSidebarChats();
  renderChatMessages();
}

function renderSidebarChats() {
  const listEl = document.getElementById('chat-history-list');
  if (!listEl) return;

  listEl.innerHTML = '';
  chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = `chat-history-item ${chat.id === activeChatId ? 'active' : ''}`;
    item.onclick = () => selectChat(chat.id);

    const titleEl = document.createElement('div');
    titleEl.className = 'chat-item-title';
    titleEl.textContent = chat.title;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'chat-item-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn-icon-subtle';
    renameBtn.title = 'Rename Chat';
    renameBtn.innerHTML = '✏️';
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      renameChat(chat.id);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon-subtle';
    deleteBtn.title = 'Delete Chat';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    };

    actionsEl.appendChild(renameBtn);
    actionsEl.appendChild(deleteBtn);

    item.appendChild(titleEl);
    item.appendChild(actionsEl);
    listEl.appendChild(item);
  });
}

function getActiveChat() {
  return chats.find(c => c.id === activeChatId);
}

// ==============================================================================
// CHAT RENDERING & MARKDOWN FORMATTER
// ==============================================================================

function renderChatMessages() {
  const streamEl = document.getElementById('chat-stream');
  if (!streamEl) return;

  const chat = getActiveChat();
  if (!chat || !chat.messages.length) {
    renderWelcomeHero();
    return;
  }

  streamEl.innerHTML = '';
  chat.messages.forEach((msg, idx) => {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}`;

    if (msg.role === 'user') {
      row.innerHTML = `
        <div class="message-bubble">
          <div class="message-text">${escapeHtml(msg.content)}</div>
        </div>
      `;
    } else {
      // Assistant Message
      const modelBadge = msg.model_badge || 'Free Model';
      const modelName = msg.model_name || msg.model_used || 'OpenRouter';
      const latencyStr = msg.total_latency_ms ? `${msg.total_latency_ms}ms` : '';
      const routingStr = msg.routing_time_ms ? `⚡ ${msg.routing_time_ms}ms` : '';

      row.innerHTML = `
        <div class="message-avatar">
          <img src="/logo.svg" width="22" height="22" alt="arkAI" />
        </div>
        <div class="message-bubble glass-card">
          <div class="message-header">
            <div class="message-meta">
              <span class="meta-model-tag">${escapeHtml(modelName)}</span>
              ${routingStr ? `<span class="meta-latency-tag">${routingStr}</span>` : ''}
              ${latencyStr ? `<span class="meta-latency-tag">Total: ${latencyStr}</span>` : ''}
              ${msg.failover_count ? `<span class="meta-failover-tag">🔀 Failover (${msg.failover_count})</span>` : ''}
            </div>
          </div>
          <div class="markdown-body">${formatMarkdown(msg.content)}</div>
          <div class="message-actions">
            <button class="btn-action-tool btn-try-next" onclick="handleTryNextModel(${idx})">
              🔀 Try Next Model
            </button>
            <button class="btn-action-tool" onclick="copyMessageText(${idx})">
              📋 Copy
            </button>
          </div>
        </div>
      `;
    }
    streamEl.appendChild(row);
  });

  scrollChatToBottom();
}

function renderWelcomeHero() {
  const streamEl = document.getElementById('chat-stream');
  if (!streamEl) return;

  streamEl.innerHTML = `
    <div class="welcome-hero">
      <img src="/logo.svg" class="hero-emblem" alt="arkAI Logo" />
      <h1 class="hero-title">arkAI Pure OpenRouter</h1>
      <p class="hero-subtitle">
        High-speed serverless AI orchestration platform. Sub-2ms heuristic routing automatically assigns the optimal free model with seamless cascade failover.
      </p>

      <div class="hero-models-grid">
        <div class="model-card" onclick="setQueryPrompt('Write a clean TypeScript debounce hook function with generic types')">
          <div class="model-card-title">
            <span>Qwen 2.5 Coder</span>
            <span class="model-card-badge">💻 Code</span>
          </div>
          <div class="model-card-desc">Routes programming, debugging, algorithms, and SQL.</div>
        </div>

        <div class="model-card" onclick="setQueryPrompt('Solve step-by-step: If a fair coin is flipped 5 times, what is the probability of exactly 3 heads?')">
          <div class="model-card-title">
            <span>DeepSeek R1</span>
            <span class="model-card-badge">🧠 Logic</span>
          </div>
          <div class="model-card-desc">Routes complex math, reasoning, and logic proofs.</div>
        </div>

        <div class="model-card" onclick="setQueryPrompt('Write an engaging launch announcement email for a developer-first AI orchestration API')">
          <div class="model-card-title">
            <span>Llama 3.3 70B</span>
            <span class="model-card-badge">✍️ Creative</span>
          </div>
          <div class="model-card-desc">Routes essays, content, pitches, and creative synthesis.</div>
        </div>

        <div class="model-card" onclick="setQueryPrompt('What are the key architectural advantages of serverless edge functions over container clusters?')">
          <div class="model-card-title">
            <span>Gemini 2.0 Flash Lite</span>
            <span class="model-card-badge">⚡ Ultra-Fast</span>
          </div>
          <div class="model-card-desc">Routes fast conversational QA and general queries.</div>
        </div>
      </div>
    </div>
  `;
}

function setQueryPrompt(text) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = text;
    input.focus();
    autoResizeTextarea(input);
  }
}

function scrollChatToBottom() {
  const streamEl = document.getElementById('chat-stream');
  if (streamEl) {
    streamEl.scrollTop = streamEl.scrollHeight;
  }
}

// Lightweight, safe Markdown Formatter
function formatMarkdown(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  // Multi-line code blocks
  html = html.replace(/```([a-zA-Z0-9_\-\+]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const langBadge = lang ? `<div style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 6px; text-transform: uppercase;">${lang}</div>` : '';
    return `<pre>${langBadge}<code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 5px; border-radius: 4px;">$1</code>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 style="font-size: 1.15rem; font-weight: 700; margin: 0.8rem 0 0.4rem 0;">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size: 1.3rem; font-weight: 800; margin: 1rem 0 0.5rem 0;">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size: 1.5rem; font-weight: 800; margin: 1.2rem 0 0.6rem 0;">$1</h1>');

  // Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Blockquotes
  html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Paragraph line breaks
  html = html.replace(/\n\n/g, '<p></p>');
  html = html.replace(/\n/g, '<br/>');

  return html;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function copyMessageText(idx) {
  const chat = getActiveChat();
  if (!chat || !chat.messages[idx]) return;
  navigator.clipboard.writeText(chat.messages[idx].content).then(() => {
    alert('Message copied to clipboard!');
  });
}

// ==============================================================================
// SEND MESSAGE & REGENERATE WITH NEXT MODEL
// ==============================================================================

async function handleSendMessage() {
  if (isGenerating) return;
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;

  const chat = getActiveChat();
  if (!chat) return;

  // Append user message
  const userMsg = { role: 'user', content: text, timestamp: Date.now() };
  chat.messages.push(userMsg);

  // If first message, auto-title the chat
  if (chat.messages.length === 1) {
    chat.title = text.slice(0, 32) + (text.length > 32 ? '...' : '');
  }

  saveChats();
  renderSidebarChats();
  renderChatMessages();

  // Reset input box
  input.value = '';
  autoResizeTextarea(input);

  // Call Backend Orchestrator
  await executeChatRequest(text, null);
}

async function handleTryNextModel(assistantMsgIdx) {
  if (isGenerating) return;

  const chat = getActiveChat();
  if (!chat) return;

  const assistantMsg = chat.messages[assistantMsgIdx];
  if (!assistantMsg) return;

  // Find the preceding user message
  let userQuery = '';
  for (let i = assistantMsgIdx - 1; i >= 0; i--) {
    if (chat.messages[i].role === 'user') {
      userQuery = chat.messages[i].content;
      break;
    }
  }

  if (!userQuery) return;

  const currentModel = assistantMsg.model_used || 'google/gemini-2.0-flash-lite-001:free';
  const nextModel = assistantMsg.next_fallback_model || null;

  // Trigger regeneration
  await executeChatRequest(userQuery, nextModel, assistantMsgIdx);
}

async function executeChatRequest(userQuery, forceModel = null, replaceIdx = null) {
  isGenerating = true;
  updateSendButtonState(true);

  const chat = getActiveChat();
  const effectiveSystemPrompt = userSettings.persona === 'custom'
    ? userSettings.customPrompt
    : (PERSONA_PROMPTS[userSettings.persona] || PERSONA_PROMPTS.default);

  // Temporary placeholder in UI
  const placeholderMsg = {
    role: 'assistant',
    content: '⚡ arkAI Heuristic Router dispatching request across free model pool...',
    model_name: forceModel ? `Targeting Next: ${forceModel.split('/')[1] || forceModel}` : 'Evaluating Heuristic...',
    routing_time_ms: 1.1,
  };

  if (replaceIdx !== null) {
    chat.messages[replaceIdx] = placeholderMsg;
  } else {
    chat.messages.push(placeholderMsg);
  }
  renderChatMessages();

  try {
    const payload = {
      message: userQuery,
      history: chat.messages.filter(m => m !== placeholderMsg).slice(-6),
      system_prompt: effectiveSystemPrompt,
      force_model: forceModel,
      api_key_override: userSettings.apiKey || undefined,
      temperature: userSettings.temperature || 0.7,
    };

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    const targetIdx = replaceIdx !== null ? replaceIdx : chat.messages.length - 1;
    chat.messages[targetIdx] = {
      role: 'assistant',
      content: data.response || 'No response returned from model.',
      model_used: data.model_used,
      model_name: data.model_name,
      model_badge: data.model_badge,
      prompt_type: data.prompt_type,
      provider_status: data.provider_status,
      failover_count: data.failover_count || 0,
      failover_history: data.failover_history || [],
      next_fallback_model: data.next_fallback_model,
      routing_time_ms: data.routing_time_ms,
      total_latency_ms: data.total_latency_ms,
      timestamp: Date.now(),
    };

    saveChats();
  } catch (err) {
    console.error('Chat orchestration error:', err);
    const targetIdx = replaceIdx !== null ? replaceIdx : chat.messages.length - 1;
    chat.messages[targetIdx] = {
      role: 'assistant',
      content: `⚠️ **Connection Error**: Failed to reach orchestrator backend. Please check network or verify backend server is running. (${err.message})`,
      model_name: 'System Diagnostic',
      provider_status: 'error',
      timestamp: Date.now(),
    };
    saveChats();
  } finally {
    isGenerating = false;
    updateSendButtonState(false);
    renderChatMessages();
  }
}

function updateSendButtonState(generating) {
  const btn = document.getElementById('btn-send');
  if (btn) {
    btn.disabled = generating;
    btn.innerHTML = generating
      ? '<span style="animation: spin 1s infinite linear; display:inline-block;">↻</span>'
      : '➤';
  }
}

// ==============================================================================
// EXPORT CONVERSATION (JSON & MARKDOWN)
// ==============================================================================

function exportChatAsJSON() {
  const chat = getActiveChat();
  if (!chat) return;

  const exportData = {
    app: "arkAI Pure OpenRouter Orchestrator",
    version: "3.0.0",
    chat_id: chat.id,
    title: chat.title,
    exported_at: new Date().toISOString(),
    messages: chat.messages,
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  downloadFile(blob, `${slugify(chat.title)}_arkai_export.json`);
}

function exportChatAsMarkdown() {
  const chat = getActiveChat();
  if (!chat) return;

  let md = `# arkAI Conversation Transcript: ${chat.title}\n`;
  md += `*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;

  chat.messages.forEach(msg => {
    if (msg.role === 'user') {
      md += `### 👤 User\n${msg.content}\n\n`;
    } else {
      const modelTag = msg.model_name || msg.model_used || 'OpenRouter';
      const latency = msg.total_latency_ms ? ` (${msg.total_latency_ms}ms)` : '';
      md += `### 🤖 arkAI (${modelTag}${latency})\n${msg.content}\n\n`;
      md += `---\n\n`;
    }
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  downloadFile(blob, `${slugify(chat.title)}_arkai_export.md`);
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slugify(text) {
  return (text || 'conversation')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 30);
}

// ==============================================================================
// SETTINGS MODAL & EVENT LISTENERS
// ==============================================================================

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  document.getElementById('input-api-key').value = userSettings.apiKey || '';
  document.getElementById('select-persona').value = userSettings.persona || 'default';
  document.getElementById('input-custom-prompt').value = userSettings.customPrompt || '';

  toggleCustomPromptVisibility(userSettings.persona);
  modal.classList.add('open');
}

function closeSettingsModal() {
  document.getElementById('settings-modal')?.classList.remove('open');
}

function handleSaveSettings() {
  const keyInput = document.getElementById('input-api-key');
  const personaSelect = document.getElementById('select-persona');
  const customPromptInput = document.getElementById('input-custom-prompt');

  userSettings.apiKey = (keyInput?.value || '').trim();
  userSettings.persona = personaSelect?.value || 'default';
  userSettings.customPrompt = (customPromptInput?.value || '').trim();

  saveSettings();
  closeSettingsModal();
  alert('Settings saved successfully!');
}

function toggleCustomPromptVisibility(persona) {
  const container = document.getElementById('custom-prompt-container');
  if (container) {
    container.style.display = persona === 'custom' ? 'flex' : 'none';
  }
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
}

function setupEventListeners() {
  // Mobile drawer toggle
  document.getElementById('btn-mobile-menu')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });

  // Prompt input shortcuts
  const input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('input', () => autoResizeTextarea(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });
  }

  // Persona select change
  document.getElementById('select-persona')?.addEventListener('change', (e) => {
    toggleCustomPromptVisibility(e.target.value);
  });
}

async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const pill = document.getElementById('engine-status-text');
    if (pill) {
      pill.textContent = data.runtime_mode === 'demo_mode'
        ? 'Demo Mode (OpenRouter Free)'
        : 'OpenRouter Free Pool Active';
    }
  } catch (e) {
    console.warn('Backend health check delayed:', e);
  }
}

// Global Exports for onclick handlers
window.createNewChat = createNewChat;
window.toggleTheme = toggleTheme;
window.exportChatAsJSON = exportChatAsJSON;
window.exportChatAsMarkdown = exportChatAsMarkdown;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.handleSaveSettings = handleSaveSettings;
window.handleSendMessage = handleSendMessage;
window.handleTryNextModel = handleTryNextModel;
window.copyMessageText = copyMessageText;
window.setQueryPrompt = setQueryPrompt;
