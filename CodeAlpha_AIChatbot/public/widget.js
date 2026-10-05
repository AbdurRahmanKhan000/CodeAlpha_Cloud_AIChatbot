/**
 * arkAI Embeddable Chatbot Widget
 * Ultra-lightweight (~4KB), zero external dependencies.
 * Modern monochrome floating widget for any website.
 *
 * Usage:
 *   <script src="https://your-domain.vercel.app/widget.js"
 *           data-endpoint="/api/chat"
 *           data-theme="dark"
 *           data-position="bottom-right"
 *           data-title="arkAI Assistant"></script>
 */
(function () {
  'use strict';

  if (window.__ARKAI_WIDGET_INITIALIZED__) return;
  window.__ARKAI_WIDGET_INITIALIZED__ = true;

  const currentScript = document.currentScript || (function () {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const config = {
    endpoint: (currentScript && currentScript.getAttribute('data-endpoint')) || '/api/chat',
    theme: (currentScript && currentScript.getAttribute('data-theme')) || 'dark',
    position: (currentScript && currentScript.getAttribute('data-position')) || 'bottom-right',
    title: (currentScript && currentScript.getAttribute('data-title')) || 'arkAI Assistant',
    greeting: (currentScript && currentScript.getAttribute('data-greeting')) || 'Hello! I am arkAI. Ask me about pricing, services, SLAs, or technical documentation.',
  };

  const state = {
    isOpen: false,
    history: [],
    isTyping: false,
  };

  const launcher = document.createElement('div');
  launcher.id = 'arkai-widget-launcher';
  launcher.setAttribute('aria-label', 'Open arkAI Chat');
  launcher.setAttribute('role', 'button');
  launcher.style.cssText = `
    position: fixed;
    ${config.position.includes('left') ? 'left: 20px;' : 'right: 20px;'}
    bottom: 20px;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: #09090b;
    border: 1px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 99999;
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  `;
  launcher.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 64 64" fill="none">
      <path d="M 32 10 L 10 54 L 21 54 L 32 32 L 43 54 L 54 54 Z" fill="#FFFFFF" fill-rule="evenodd" />
      <circle cx="32" cy="46" r="3.5" fill="#FFFFFF" />
    </svg>
  `;

  const modal = document.createElement('div');
  modal.id = 'arkai-widget-modal';
  modal.style.cssText = `
    position: fixed;
    ${config.position.includes('left') ? 'left: 20px;' : 'right: 20px;'}
    bottom: 80px;
    width: 380px;
    max-width: calc(100vw - 40px);
    height: 540px;
    max-height: calc(100vh - 100px);
    border-radius: 16px;
    background: #0e0e11;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    display: none;
    flex-direction: column;
    overflow: hidden;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #fafafa;
  `;

  modal.innerHTML = `
    <div style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; background: #141418;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="width: 24px; height: 24px; border-radius: 6px; background: #27272a; display: flex; align-items: center; justify-content: center;">
          <svg width="14" height="14" viewBox="0 0 64 64" fill="none">
            <path d="M 32 10 L 10 54 L 21 54 L 32 32 L 43 54 L 54 54 Z" fill="#FFFFFF" fill-rule="evenodd" />
          </svg>
        </div>
        <span style="font-weight: 600; font-size: 0.9rem;">${config.title}</span>
      </div>
      <button id="arkai-widget-close" style="background: transparent; border: none; color: #a1a1aa; cursor: pointer; padding: 4px;">✕</button>
    </div>

    <div id="arkai-widget-messages" style="flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; gap: 8px;">
        <div style="background: #18181b; border: 1px solid rgba(255,255,255,0.08); padding: 10px 14px; border-radius: 12px; font-size: 0.88rem; line-height: 1.5;">
          ${config.greeting}
        </div>
      </div>
    </div>

    <form id="arkai-widget-form" style="padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; gap: 8px; background: #141418;">
      <input type="text" id="arkai-widget-input" placeholder="Ask arkAI..." style="flex: 1; background: #1e1e24; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 8px 14px; color: #fff; font-size: 0.88rem; outline: none;" />
      <button type="submit" style="width: 34px; height: 34px; border-radius: 50%; background: #ffffff; color: #000; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold;">↑</button>
    </form>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(modal);

  const closeBtn = document.getElementById('arkai-widget-close');
  const messagesBox = document.getElementById('arkai-widget-messages');
  const form = document.getElementById('arkai-widget-form');
  const input = document.getElementById('arkai-widget-input');

  function toggle() {
    state.isOpen = !state.isOpen;
    modal.style.display = state.isOpen ? 'flex' : 'none';
    if (state.isOpen) {
      input.focus();
    }
  }

  launcher.addEventListener('click', toggle);
  closeBtn.addEventListener('click', toggle);

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const query = input.value.trim();
    if (!query || state.isTyping) return;
    input.value = '';

    // Append user message
    const userDiv = document.createElement('div');
    userDiv.style.cssText = 'display: flex; justify-content: flex-end;';
    userDiv.innerHTML = `<div style="background: #27272a; padding: 8px 12px; border-radius: 12px; font-size: 0.88rem;">${escapeHtml(query)}</div>`;
    messagesBox.appendChild(userDiv);
    messagesBox.scrollTop = messagesBox.scrollHeight;

    state.isTyping = true;

    try {
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, session_id: 'widget-session' }),
      });
      const data = await res.json();
      const botDiv = document.createElement('div');
      botDiv.style.cssText = 'display: flex; gap: 8px;';
      botDiv.innerHTML = `<div style="background: #18181b; border: 1px solid rgba(255,255,255,0.08); padding: 10px 14px; border-radius: 12px; font-size: 0.88rem; line-height: 1.5;">${data.response || 'No response.'}</div>`;
      messagesBox.appendChild(botDiv);
      messagesBox.scrollTop = messagesBox.scrollHeight;
    } catch (err) {
      const errDiv = document.createElement('div');
      errDiv.innerHTML = `<div style="color: #ef4444; font-size: 0.8rem;">⚠️ Service error.</div>`;
      messagesBox.appendChild(errDiv);
    } finally {
      state.isTyping = false;
    }
  });

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.arkAI = {
    open: function () { if (!state.isOpen) toggle(); },
    close: function () { if (state.isOpen) toggle(); },
  };
})();
