import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Plus,
  ArrowUp,
  Copy,
  Check,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  Trash2,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Zap,
  Shield,
  CreditCard,
  Code,
  Download,
  Settings as SettingsIcon,
  X,
  Edit2,
  ArrowLeft,
  Key,
  Cpu,
  Sliders,
  HelpCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  RefreshCw,
  FileText,
  FileType,
  Bot,
  ChevronDown
} from 'lucide-react';
import { downloadAnswerPdf, downloadAnswerDocx } from './export.ts';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source?: 'pattern' | 'local_pattern' | 'ai' | 'google-gemini' | 'diagnostic' | 'error';
  intent?: string;
  confidence?: number;
  latencyMicros?: number;
  latencyMs?: number;
  followUpSuggestions?: string[];
  timestamp: string;
  // Orchestration metadata (shown at the end of every AI reply)
  prompt?: string;
  modelUsed?: string;
  modelName?: string;
  modelBadge?: string;
  gatewayName?: string;
  routingTimeMs?: number;
  totalLatencyMs?: number;
  triedModels?: string[];
  nextModel?: string | null;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
}

interface UserSettings {
  mode: 'arkai' | 'ownkey';
  provider: 'auto' | 'gemini' | 'openai' | 'claude' | 'grok' | 'deepseek' | 'meta' | 'qwen' | 'openrouter';
  apiKey: string;
  systemPromptPreset: 'concise' | 'developer' | 'support' | 'custom';
  customPrompt: string;
  temperature: number;
  responseDepth: 'detailed' | 'concise';
  allowServerKeyFallback: boolean;
}

const SYSTEM_PRESETS: Record<string, string> = {
  developer: 'You are arkAI, an ultra-capable, professional, and intelligent commercial AI assistant. Provide rich, thorough, and highly articulate answers. When generating code, always provide complete, production-grade files with clean styling, responsive layout, and step-by-step instructions. Never give truncated or overly brief responses.',
  concise: 'You are arkAI, an ultra-capable commercial AI assistant. Keep responses direct, structured, articulate, and to the point. Format code snippets with markdown syntax.',
  support: 'You are arkAI Enterprise Customer Support. Be courteous, empathetic, structured, and guide the user through operational troubleshooting.'
};

const STORAGE_KEY_SESSIONS = 'arkai_sessions_v5';
const STORAGE_KEY_SETTINGS = 'arkai_settings_v5';
const STORAGE_KEY_THEME = 'arkai_theme_v5';

export default function App() {
  // Navigation View: 'chat' or 'settings'
  const [currentView, setCurrentView] = useState<'chat' | 'settings'>('chat');
  const [showKeyPassword, setShowKeyPassword] = useState(false);

  // Theme state
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem(STORAGE_KEY_THEME) as 'dark' | 'light') || 'dark';
  });

  // Sidebar & Modal states
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Settings state: Universal provider & key with no model selection required
  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Failed to parse saved settings:', e);
    }
    return {
      mode: 'arkai',
      provider: 'auto',
      apiKey: '',
      systemPromptPreset: 'developer',
      customPrompt: SYSTEM_PRESETS.developer,
      temperature: 0.7,
      responseDepth: 'detailed',
      allowServerKeyFallback: true
    };
  });

  // Conversations state (LocalStorage backed)
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SESSIONS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse conversations:', e);
    }
    return [
      {
        id: `conv_${Date.now()}`,
        title: 'New conversation',
        createdAt: Date.now(),
        messages: []
      }
    ];
  });

  const [activeConvId, setActiveConvId] = useState<string>(() => conversations[0]?.id || `conv_${Date.now()}`);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState('');

  // Chat inputs & interaction states
  const [inputQuery, setInputQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [feedbackState, setFeedbackState] = useState<Record<string, 'up' | 'down'>>({});
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [statusText] = useState('Fast API Online');

  const currentConv = conversations.find(c => c.id === activeConvId) || conversations[0];
  const messages = currentConv?.messages || [];

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync theme to root class and localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_THEME, theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, [theme]);

  // Persist sessions to LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(conversations));
  }, [conversations]);

  // Persist settings
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  }, [settings]);

  // Auto-scroll message feed
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputQuery]);

  const startNewChat = () => {
    setCurrentView('chat');
    const newId = `conv_${Date.now()}`;
    const newConv: Conversation = {
      id: newId,
      title: 'New conversation',
      createdAt: Date.now(),
      messages: []
    };
    setConversations(prev => [newConv, ...prev]);
    setActiveConvId(newId);
    setInputQuery('');
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleRenameChat = (convId: string, currentTitle: string) => {
    setEditingTitleId(convId);
    setEditedTitle(currentTitle);
  };

  const saveRenamedChat = (convId: string) => {
    const trimmed = editedTitle.trim();
    if (trimmed) {
      setConversations(prev =>
        prev.map(c => (c.id === convId ? { ...c, title: trimmed } : c))
      );
    }
    setEditingTitleId(null);
  };

  const handleDeleteChat = (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== convId);
      if (filtered.length === 0) {
        const freshId = `conv_${Date.now()}`;
        setActiveConvId(freshId);
        return [{ id: freshId, title: 'New conversation', createdAt: Date.now(), messages: [] }];
      }
      if (activeConvId === convId) {
        setActiveConvId(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleDownloadChat = (format: 'json' | 'txt') => {
    if (!currentConv || currentConv.messages.length === 0) {
      alert('Current conversation is empty.');
      return;
    }

    let fileContent = '';
    let fileName = `arkAI_${currentConv.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
    let mimeType = 'text/plain';

    if (format === 'json') {
      fileContent = JSON.stringify(currentConv, null, 2);
      fileName += '.json';
      mimeType = 'application/json';
    } else {
      fileContent = `# ${currentConv.title}\nExported on ${new Date().toLocaleString()}\n\n`;
      currentConv.messages.forEach(m => {
        fileContent += `### ${m.role === 'user' ? 'User' : 'arkAI'} (${m.timestamp})\n${m.content}\n\n---\n\n`;
      });
      fileName += '.md';
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || inputQuery).trim();
    if (!query || isSending) return;

    setInputQuery('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Auto title generation if first message
    setConversations(prev =>
      prev.map(c => {
        if (c.id === activeConvId) {
          const newTitle = c.messages.length === 0 ? (query.slice(0, 32) + (query.length > 32 ? '...' : '')) : c.title;
          return {
            ...c,
            title: newTitle,
            messages: [...c.messages, userMessage]
          };
        }
        return c;
      })
    );

    setIsSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          session_id: activeConvId,
          provider: settings.mode === 'ownkey' && settings.provider !== 'auto' ? settings.provider : undefined,
          system_prompt: settings.customPrompt,
          api_key_override: settings.mode === 'ownkey' ? (settings.apiKey || undefined) : undefined,
          temperature: settings.temperature,
          history: messages.slice(-6).map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            content: m.content
          }))
        })
      });

      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      const data = await res.json();
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        source: data.source,
        intent: data.intent,
        confidence: data.confidence,
        latencyMicros: data.latency_micros,
        latencyMs: data.latency_ms ?? data.total_latency_ms,
        followUpSuggestions: data.follow_up_suggestions,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        prompt: query,
        modelUsed: data.model_used,
        modelName: data.model_name,
        modelBadge: data.model_badge,
        gatewayName: data.gateway_name,
        routingTimeMs: data.routing_time_ms,
        totalLatencyMs: data.total_latency_ms,
        triedModels: data.tried_models || (data.model_used ? [data.model_used] : []),
        nextModel: data.next_model,
      };

      setConversations(prev =>
        prev.map(c => {
          if (c.id === activeConvId) {
            return {
              ...c,
              messages: [...c.messages, assistantMessage]
            };
          }
          return c;
        })
      );
    } catch (err: any) {
      const errorMessage: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `I encountered an issue processing your request: ${err.message || 'Server connection error'}. Please try again.`,
        source: 'error',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setConversations(prev =>
        prev.map(c => {
          if (c.id === activeConvId) {
            return {
              ...c,
              messages: [...c.messages, errorMessage]
            };
          }
          return c;
        })
      );
    } finally {
      setIsSending(false);
    }
  };

  // Regenerate: same prompt, answered by the NEXT best model (never a repeat)
  const handleRegenerate = async (msg: ChatMessage) => {
    const query = (msg.prompt || '').trim();
    if (!query || regeneratingId) return;
    setRegeneratingId(msg.id);
    try {
      const res = await fetch('/api/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          current_model: msg.modelUsed,
          tried_models: msg.triedModels || (msg.modelUsed ? [msg.modelUsed] : []),
          provider: settings.mode === 'ownkey' && settings.provider !== 'auto' ? settings.provider : undefined,
          system_prompt: settings.customPrompt,
          api_key_override: settings.mode === 'ownkey' ? (settings.apiKey || undefined) : undefined,
          temperature: settings.temperature,
          history: messages.slice(-6).map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            content: m.content
          }))
        })
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      setConversations(prev => prev.map(c => c.id === activeConvId ? {
        ...c,
        messages: c.messages.map(m => m.id === msg.id ? {
          ...m,
          content: data.response,
          source: data.source,
          intent: data.intent ?? m.intent,
          latencyMs: data.latency_ms ?? data.total_latency_ms,
          latencyMicros: undefined,
          modelUsed: data.model_used,
          modelName: data.model_name,
          modelBadge: data.model_badge,
          gatewayName: data.gateway_name,
          routingTimeMs: data.routing_time_ms,
          totalLatencyMs: data.total_latency_ms,
          triedModels: data.tried_models || [...(m.triedModels || []), data.model_used].filter(Boolean),
          nextModel: data.next_model,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        } : m)
      } : c));
    } catch (err) {
      console.warn('Regenerate failed', err);
    } finally {
      setRegeneratingId(null);
    }
  };

  // Download a single AI reply as branded PDF or Word
  const handleDownloadAnswer = async (msg: ChatMessage, format: 'pdf' | 'docx') => {
    setDownloadingId(msg.id);
    setDownloadMenuId(null);
    try {
      const meta = {
        question: msg.prompt || 'arkAI response',
        answer: msg.content,
        modelName: msg.modelName || msg.modelUsed || 'arkAI Orchestrated Model',
        modelId: msg.modelUsed,
        gatewayName: msg.gatewayName,
        generatedAt: new Date(),
      };
      if (format === 'pdf') await downloadAnswerPdf(meta); else await downloadAnswerDocx(meta);
    } catch (err) {
      console.warn('Download failed', err);
    } finally {
      setDownloadingId(null);
    }
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyCode = (codeText: string, id: string) => {
    navigator.clipboard.writeText(codeText);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const clearAllData = () => {
    if (confirm('Are you sure you want to clear all conversations and reset settings?')) {
      localStorage.removeItem(STORAGE_KEY_SESSIONS);
      localStorage.removeItem(STORAGE_KEY_SETTINGS);
      window.location.reload();
    }
  };

  // Render markdown with clean formatting, code blocks, lists
  const renderMessageContent = (content: string, messageId: string) => {
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          value: content.slice(lastIndex, match.index)
        });
      }
      parts.push({
        type: 'code',
        language: match[1] || 'text',
        code: match[2].trim(),
        id: `${messageId}-${match.index}`
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push({
        type: 'text',
        value: content.slice(lastIndex)
      });
    }

    if (parts.length === 0) {
      parts.push({ type: 'text', value: content });
    }

    return (
      <div className={`space-y-3 ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900 font-normal'}`}>
        {parts.map((part, idx) => {
          if (part.type === 'code') {
            const isCodeCopied = copiedCodeId === part.id;
            return (
              <div key={idx} className={`my-3.5 rounded-xl overflow-hidden border font-mono text-xs shadow-xs ${
                theme === 'dark' ? 'border-zinc-800 bg-[#0d0d0f]' : 'border-zinc-200 bg-zinc-50'
              }`}>
                <div className={`flex items-center justify-between px-3.5 py-2 border-b ${
                  theme === 'dark' ? 'bg-zinc-900/80 border-zinc-800 text-zinc-400' : 'bg-zinc-200/70 border-zinc-200 text-zinc-700'
                }`}>
                  <span className="text-[11px] font-sans font-medium uppercase tracking-wider">{part.language}</span>
                  <button
                    onClick={() => copyCode(part.code || '', part.id || '')}
                    className={`flex items-center gap-1 text-[11px] transition-colors ${
                      theme === 'dark' ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 hover:text-zinc-950 font-medium'
                    }`}
                  >
                    {isCodeCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{isCodeCopied ? 'Copied' : 'Copy code'}</span>
                  </button>
                </div>
                <div className={`p-3.5 overflow-x-auto leading-relaxed ${
                  theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900 font-mono font-medium'
                }`}>
                  <pre><code>{part.code}</code></pre>
                </div>
              </div>
            );
          }

          const lines = (part.value || '').split('\n');
          return (
            <div key={idx} className="space-y-2 text-[15px] leading-relaxed">
              {lines.map((line, lIdx) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={lIdx} className="h-1.5" />;

                // Horizontal Rule
                if (trimmed === '---' || trimmed === '***') {
                  return <hr key={lIdx} className={`my-3 border-t ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`} />;
                }

                // Markdown Headings
                if (trimmed.startsWith('### ')) {
                  return (
                    <h3 key={lIdx} className={`text-base font-bold mt-3 mb-1.5 ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'}`}>
                      <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(trimmed.slice(4)) }} />
                    </h3>
                  );
                }
                if (trimmed.startsWith('## ')) {
                  return (
                    <h2 key={lIdx} className={`text-lg font-bold mt-4 mb-2 ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'}`}>
                      <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(trimmed.slice(3)) }} />
                    </h2>
                  );
                }
                if (trimmed.startsWith('# ')) {
                  return (
                    <h1 key={lIdx} className={`text-xl font-bold mt-4 mb-2 ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'}`}>
                      <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(trimmed.slice(2)) }} />
                    </h1>
                  );
                }

                // Blockquotes & Callouts
                if (trimmed.startsWith('> ')) {
                  return (
                    <div
                      key={lIdx}
                      className={`my-2 px-3.5 py-2.5 rounded-r-lg border-l-4 border-amber-500 text-sm leading-relaxed ${
                        theme === 'dark' ? 'bg-amber-500/10 text-amber-200' : 'bg-amber-50 text-amber-950 shadow-xs'
                      }`}
                    >
                      <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(trimmed.slice(2)) }} />
                    </div>
                  );
                }

                // Bullet Lists
                if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                  const bulletText = trimmed.slice(2);
                  return (
                    <div key={lIdx} className="flex items-start gap-2.5 ml-1">
                      <span className={`mt-2 text-[6px] ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>●</span>
                      <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(bulletText) }} />
                    </div>
                  );
                }

                // Numbered Lists
                if (/^\d+\.\s/.test(trimmed)) {
                  const numMatch = trimmed.match(/^(\d+\.)\s(.*)/);
                  if (numMatch) {
                    return (
                      <div key={lIdx} className="flex items-start gap-2 ml-1">
                        <span className={`font-mono text-xs font-semibold mt-0.5 ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-700'}`}>{numMatch[1]}</span>
                        <span dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(numMatch[2]) }} />
                      </div>
                    );
                  }
                }

                return (
                  <p key={lIdx} dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(line) }} />
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const formatInlineMarkdown = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, `<strong class="font-bold ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-950'}">$1</strong>`)
      .replace(/\*(.*?)\*/g, `<em class="${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700 font-medium'}">$1</em>`)
      .replace(/`([^`]+)`/g, `<code class="font-mono text-[13px] px-1.5 py-0.5 rounded border ${
        theme === 'dark' ? 'bg-zinc-800 text-zinc-200 border-zinc-700/60' : 'bg-zinc-100 text-zinc-900 border-zinc-300 font-semibold'
      }">$1</code>`);
  };

  return (
    <div className={`flex h-screen w-screen overflow-hidden ${theme === 'dark' ? 'bg-[#09090b] text-zinc-100' : 'bg-[#ffffff] text-zinc-900'} font-sans antialiased`}>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-20 md:hidden"
        />
      )}

      {/* ============================================================== */}
      {/* LEFT SIDEBAR (Multi-Chat System with LocalStorage)             */}
      {/* ============================================================== */}
      <aside
        className={`fixed md:relative top-0 bottom-0 left-0 h-full z-30 flex flex-col flex-shrink-0 overflow-hidden transition-all duration-200 ease-in-out ${
          sidebarOpen ? 'w-64 opacity-100 border-r' : 'w-0 opacity-0 pointer-events-none border-r-0'
        } ${
          theme === 'dark' ? 'bg-[#0e0e11] border-zinc-800/80' : 'bg-[#f9f9fb] border-zinc-200'
        }`}
      >
        <div className="w-64 flex flex-col h-full flex-shrink-0">
          <div className="p-3.5 flex items-center justify-between border-b border-transparent">
            {/* Logo & Brand Wordmark */}
            <div className="flex items-center gap-2.5 px-1.5">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 64 64" fill="none">
                  <path d="M 32 10 L 10 54 L 21 54 L 32 32 L 43 54 L 54 54 Z" fill="#FFFFFF" fillRule="evenodd" />
                  <circle cx="32" cy="46" r="3.5" fill="#FFFFFF" />
                </svg>
              </div>
              <span className="font-semibold text-sm tracking-tight">arkAI</span>
            </div>

            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
              title="Close sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* New Chat Button */}
          <div className="px-3 py-2">
            <button
              onClick={startNewChat}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                theme === 'dark'
                  ? 'bg-zinc-900/90 border-zinc-800 hover:bg-zinc-800 text-zinc-200 shadow-sm'
                  : 'bg-white border-zinc-200 hover:bg-zinc-100 text-zinc-800 shadow-sm'
              }`}
            >
              <span className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                <span>New chat</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">Ctrl K</span>
            </button>
          </div>

          {/* Conversation History List with Rename & Delete */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            <div className="px-2.5 py-1 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              Conversations
            </div>

            {conversations.map(conv => {
              const isActive = conv.id === activeConvId;
              const isEditing = editingTitleId === conv.id;

              return (
                <div
                  key={conv.id}
                  onClick={() => {
                    setActiveConvId(conv.id);
                    setCurrentView('chat');
                  }}
                  className={`group relative w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    isActive && currentView === 'chat'
                      ? theme === 'dark'
                        ? 'bg-zinc-800/80 text-zinc-100'
                        : 'bg-zinc-200/70 text-zinc-900'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate flex-1 mr-2">
                    <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedTitle}
                        onChange={e => setEditedTitle(e.target.value)}
                        onBlur={() => saveRenamedChat(conv.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveRenamedChat(conv.id);
                          if (e.key === 'Escape') setEditingTitleId(null);
                        }}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                        className="bg-zinc-900 text-zinc-100 px-1 py-0.5 rounded outline-none border border-zinc-700 w-full text-xs"
                      />
                    ) : (
                      <span className="truncate">{conv.title}</span>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="hidden group-hover:flex items-center gap-1">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleRenameChat(conv.id, conv.title);
                        }}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-200"
                        title="Rename"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={e => handleDeleteChat(conv.id, e)}
                        className="p-1 rounded text-zinc-400 hover:text-rose-400"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom Actions Footer */}
          <div className={`p-3 border-t space-y-2 ${theme === 'dark' ? 'border-zinc-800/80 bg-[#0e0e11]' : 'border-zinc-200 bg-[#f9f9fb]'}`}>
            <button
              onClick={() => {
                setCurrentView('settings');
                setSettingsOpen(false);
              }}
              className={`w-full flex items-center justify-between text-xs p-2 rounded-lg transition-colors ${
                currentView === 'settings'
                  ? 'bg-zinc-800 text-white font-medium shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center gap-2">
                <SettingsIcon className="w-4 h-4" />
                <span>Settings & Engine</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300 uppercase font-mono">{settings.mode === 'ownkey' ? settings.provider : 'arkAI Free'}</span>
            </button>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
                className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800/60 transition-colors"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ============================================================== */}
      {/* MAIN CHAT WORKSPACE                       */}
      {/* ============================================================== */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header */}
        <header className={`h-14 border-b flex items-center justify-between px-4 z-10 flex-shrink-0 ${
          theme === 'dark' ? 'bg-[#09090b]/80 border-zinc-800/60' : 'bg-white/80 border-zinc-200'
        } backdrop-blur-md`}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(s => !s)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
              title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm tracking-tight text-zinc-100">arkAI</span>
            </div>

            {/* Dynamic Status Indicator */}
            <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] ${
              theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-400' : 'bg-zinc-100 border-zinc-200 text-zinc-600'
            }`}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>{statusText}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Download Chat Action */}
            <div className="relative group">
              <button
                className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${
                  theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300'
                    : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                }`}
                title="Download conversation"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export</span>
              </button>

              <div className={`absolute right-0 mt-1 w-36 rounded-lg border shadow-lg py-1 hidden group-hover:block z-50 ${
                theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-300' : 'bg-white border-zinc-200 text-zinc-700'
              }`}>
                <button
                  onClick={() => handleDownloadChat('json')}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800/50"
                >
                  Download JSON
                </button>
                <button
                  onClick={() => handleDownloadChat('txt')}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800/50"
                >
                  Download Markdown
                </button>
              </div>
            </div>

            <button
              onClick={() => setCurrentView(v => v === 'settings' ? 'chat' : 'settings')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                currentView === 'settings'
                  ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-200'
                  : theme === 'dark'
                  ? 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300'
                  : 'border-zinc-200 bg-white hover:bg-zinc-100 text-zinc-700'
              }`}
              title="Settings Page"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              <span>{currentView === 'settings' ? 'Back to Chat' : 'Settings'}</span>
            </button>

            <button
              onClick={startNewChat}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${
                theme === 'dark'
                  ? 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-zinc-300'
                  : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New chat</span>
            </button>
          </div>
        </header>

        {currentView === 'settings' ? (
          /* ============================================================== */
          /* FULL DEDICATED SETTINGS PAGE                                  */
          /* ============================================================== */
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 max-w-4xl mx-auto w-full space-y-6">
            {/* Page Header */}
            <div className={`flex items-center justify-between border-b pb-4 ${theme === 'dark' ? 'border-zinc-800/80' : 'border-zinc-200'}`}>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCurrentView('chat')}
                  className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 text-xs font-medium ${
                    theme === 'dark'
                      ? 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100 shadow-xs'
                  }`}
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Chat</span>
                </button>
                <div>
                  <h1 className={`text-xl font-bold tracking-tight flex items-center gap-2 ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'}`}>
                    <Sliders className="w-5 h-5 text-indigo-500" />
                    <span>arkAI System Settings</span>
                  </h1>
                  <p className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Choose arkAI's free orchestrated models or your own API key, plus persona and creativity controls.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Settings Active
                </span>
              </div>
            </div>

            {/* Section 1: AI Source - arkAI models OR your own API key */}
            <div className={`p-5 rounded-2xl border ${theme === 'dark' ? 'bg-[#121215] border-zinc-800/80' : 'bg-white border-zinc-200 shadow-xs'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-500" />
                  <h2 className={`text-sm font-semibold ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'}`}>AI Source</h2>
                </div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 font-semibold">
                  {settings.mode === 'ownkey' ? 'Your API key' : 'Free · No key needed'}
                </span>
              </div>
              <p className={`text-xs mb-4 leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                Choose where answers come from. By default arkAI orchestrates free AI models for you - no account, no API key, no cost.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <button
                  onClick={() => setSettings(st => ({ ...st, mode: 'arkai' }))}
                  className={`text-left p-4 rounded-xl border transition-all ${settings.mode === 'arkai' ? 'border-indigo-500 bg-indigo-500/10' : theme === 'dark' ? 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'}`}>arkAI Models (Recommended)</span>
                    {settings.mode === 'arkai' && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />}
                  </div>
                  <p className={`text-[11px] leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Free orchestrated access to the best available models (GPT-OSS, DeepSeek, GLM & more). arkAI picks the best model for each question in under 2ms and fails over automatically.
                  </p>
                </button>

                <button
                  onClick={() => setSettings(st => ({ ...st, mode: 'ownkey' }))}
                  className={`text-left p-4 rounded-xl border transition-all ${settings.mode === 'ownkey' ? 'border-indigo-500 bg-indigo-500/10' : theme === 'dark' ? 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Key className="w-4 h-4 text-indigo-500" />
                    <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'}`}>Use My Own API Key</span>
                    {settings.mode === 'ownkey' && <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" />}
                  </div>
                  <p className={`text-[11px] leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Only the models available in your own API account will be used - nothing else. Best if you have a paid plan with a specific provider.
                  </p>
                </button>
              </div>

              {settings.mode === 'ownkey' && (
                <div className="space-y-3 mb-4">
                  <div className="relative">
                    <input
                      type={showKeyPassword ? 'text' : 'password'}
                      placeholder="Paste your API key (e.g. sk-..., AIza..., xai-..., sk-ant-..., gsk_...)"
                      value={settings.apiKey}
                      onChange={e => setSettings(st => ({ ...st, apiKey: e.target.value }))}
                      className={`w-full rounded-lg pl-3 pr-10 py-2.5 text-xs font-mono outline-none border transition-colors ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100 focus:border-indigo-500' : 'bg-zinc-50 border-zinc-300 text-zinc-900 focus:border-indigo-600'}`}
                    />
                    <button type="button" onClick={() => setShowKeyPassword(p => !p)} className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-200">
                      {showKeyPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div>
                    <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>Provider (auto-detected from your key)</label>
                    <select
                      value={settings.provider}
                      onChange={e => setSettings(st => ({ ...st, provider: e.target.value as any }))}
                      className={`w-full rounded-lg px-3 py-2 text-xs outline-none border ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100 focus:border-indigo-500' : 'bg-zinc-50 border-zinc-300 text-zinc-900 focus:border-indigo-600'}`}
                    >
                      <option value="auto">Auto-Detect Provider (Recommended)</option>
                      <option value="openai">OpenAI ChatGPT</option>
                      <option value="claude">Anthropic Claude</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="grok">xAI Grok</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="meta">Meta LLaMA (Groq)</option>
                      <option value="qwen">Alibaba Qwen</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                    <p className={`text-[11px] mt-2 ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-500'}`}>
                      Your key is stored only in this browser and sent only to that provider. arkAI's free models are not used in this mode.
                    </p>
                  </div>
                </div>
              )}

              <div className={`pt-3 border-t ${theme === 'dark' ? 'border-zinc-800/60' : 'border-zinc-200'}`}>
                <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>Response Depth & Detail</label>
                <select
                  value={settings.responseDepth}
                  onChange={e => {
                    const depth = e.target.value as 'detailed' | 'concise';
                    setSettings(st => ({ ...st, responseDepth: depth, customPrompt: depth === 'detailed' ? SYSTEM_PRESETS.developer : SYSTEM_PRESETS.concise }));
                  }}
                  className={`w-full sm:w-1/2 rounded-lg px-3 py-2 text-xs outline-none border ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100 focus:border-indigo-500' : 'bg-zinc-50 border-zinc-300 text-zinc-900 focus:border-indigo-600'}`}
                >
                  <option value="detailed">Comprehensive & Detailed</option>
                  <option value="concise">Concise & Structured</option>
                </select>
              </div>
            </div>

            {/* Section 2: How orchestration works */}
            <div className={`p-5 rounded-2xl border ${theme === 'dark' ? 'bg-[#121215] border-zinc-800/80' : 'bg-white border-zinc-200 shadow-xs'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-amber-500" />
                <h2 className={`text-sm font-semibold ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'}`}>How arkAI Picks Your Model</h2>
              </div>
              <div className={`space-y-2.5 text-xs leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                <p><strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}>1. Instant routing (&lt;2ms).</strong> Every question is classified locally - code, maths & logic, creative, or general - and matched to the model that is best at it.</p>
                <p><strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}>2. Automatic failover.</strong> If a model is busy or rate-limited, arkAI instantly cascades to the next best model. Your conversation never drops.</p>
                <p><strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}>3. Regenerate = a different model.</strong> Not happy with an answer? Regenerate re-asks the same question on the next best model that hasn't answered it yet.</p>
                <p><strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-800'}>4. Always labelled.</strong> Every reply shows exactly which model produced it, at the end of the answer.</p>
              </div>
            </div>

            {/* Section 3: System Persona & Instruction */}
            <div className={`p-5 rounded-2xl border ${theme === 'dark' ? 'bg-[#121215] border-zinc-800/80' : 'bg-white border-zinc-200 shadow-xs'}`}>
              <div className="flex items-center gap-2 mb-2">
                <Sliders className="w-4 h-4 text-purple-500" />
                <h2 className={`text-sm font-semibold ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'}`}>System Persona & Tuning</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>Preset</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['developer', 'concise', 'support'] as const).map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setSettings(s => ({
                          ...s,
                          systemPromptPreset: preset,
                          customPrompt: SYSTEM_PRESETS[preset]
                        }))}
                        className={`py-2 px-3 rounded-lg border text-xs font-medium capitalize transition-all ${
                          settings.systemPromptPreset === preset
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500 font-semibold'
                            : theme === 'dark'
                            ? 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                            : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                        }`}
                      >
                        {preset === 'developer' ? 'Developer (Thorough)' : preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={`block text-xs font-semibold mb-1.5 ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>System Prompt Instruction</label>
                  <textarea
                    rows={4}
                    value={settings.customPrompt}
                    onChange={e => setSettings(s => ({ ...s, customPrompt: e.target.value, systemPromptPreset: 'custom' }))}
                    className={`w-full rounded-lg p-3 text-xs outline-none focus:border-indigo-500 resize-none leading-relaxed border ${
                      theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-200' : 'bg-zinc-50 border-zinc-300 text-zinc-900'
                    }`}
                  />
                </div>

                <div>
                  <div className={`flex items-center justify-between text-xs mb-1 ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    <span className="font-semibold">Creativity Temperature</span>
                    <span className="font-mono text-zinc-400">{settings.temperature}</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={settings.temperature}
                    onChange={e => setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                    className="w-full accent-indigo-500"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>Deterministic (0.0)</span>
                    <span>Balanced (0.7)</span>
                    <span>Creative (1.0)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 4: Chat History & Data Management */}
            <div className={`p-5 rounded-2xl border ${theme === 'dark' ? 'bg-[#121215] border-zinc-800/80' : 'bg-white border-zinc-200 shadow-xs'}`}>
              <h2 className={`text-sm font-semibold mb-3 ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'}`}>Data Management</h2>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => handleDownloadChat('json')}
                  className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
                    theme === 'dark' ? 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800' : 'border-zinc-200 bg-zinc-100 text-zinc-800 hover:bg-zinc-200'
                  }`}
                >
                  Export Conversation (JSON)
                </button>
                <button
                  onClick={() => handleDownloadChat('txt')}
                  className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
                    theme === 'dark' ? 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800' : 'border-zinc-200 bg-zinc-100 text-zinc-800 hover:bg-zinc-200'
                  }`}
                >
                  Export Conversation (Markdown)
                </button>
                <button
                  onClick={clearAllData}
                  className="px-3 py-2 rounded-lg border border-rose-900/60 bg-rose-950/20 text-xs text-rose-500 hover:bg-rose-950/40 font-medium"
                >
                  Clear All Conversations & Data
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ============================================================== */
          /* REGULAR CHAT MESSAGE WORKSPACE                                 */
          /* ============================================================== */
          <>
            {/* Message Feed Container */}
            <div className="flex-1 overflow-y-auto px-4 md:px-6">
          {messages.length === 0 ? (
            /* Empty Hero State */
            <div className="max-w-2xl mx-auto h-full flex flex-col items-center justify-center text-center py-12">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-md mb-6 border ${
                theme === 'dark' ? 'bg-zinc-900 border-zinc-700/80' : 'bg-zinc-100 border-zinc-300'
              }`}>
                <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
                  <path d="M 32 10 L 10 54 L 21 54 L 32 32 L 43 54 L 54 54 Z" fill={theme === 'dark' ? '#FFFFFF' : '#18181b'} fillRule="evenodd" />
                  <circle cx="32" cy="46" r="3.5" fill={theme === 'dark' ? '#FFFFFF' : '#18181b'} />
                </svg>
              </div>

              <h1 className={`text-2xl md:text-3xl font-bold tracking-tight mb-2 ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'}`}>
                What can I help you with today?
              </h1>
              <p className={`text-sm max-w-md mb-8 ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                Instant pattern replies, plus free orchestrated AI models picked per question in under 2ms.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
                <button
                  onClick={() => handleSendMessage('What are your pricing plans?')}
                  className={`p-3.5 rounded-xl border text-left transition-all group ${
                    theme === 'dark'
                      ? 'bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-800/80 hover:border-zinc-700'
                      : 'bg-zinc-50 border-zinc-200 hover:bg-white hover:border-zinc-300 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <CreditCard className="w-4 h-4 text-zinc-400 group-hover:text-indigo-500" />
                    <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-zinc-200 group-hover:text-white' : 'text-zinc-900 group-hover:text-black'}`}>Pricing & Plans</span>
                  </div>
                  <p className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Transparent tiers from free starter to enterprise SLAs.
                  </p>
                </button>

                <button
                  onClick={() => handleSendMessage('How fast is your response time?')}
                  className={`p-3.5 rounded-xl border text-left transition-all group ${
                    theme === 'dark'
                      ? 'bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-800/80 hover:border-zinc-700'
                      : 'bg-zinc-50 border-zinc-200 hover:bg-white hover:border-zinc-300 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-4 h-4 text-zinc-400 group-hover:text-indigo-500" />
                    <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-zinc-200 group-hover:text-white' : 'text-zinc-900 group-hover:text-black'}`}>Response Speed</span>
                  </div>
                  <p className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Sub-millisecond local matcher plus orchestrated free AI models.
                  </p>
                </button>

                <button
                  onClick={() => handleSendMessage('Security & data privacy policy')}
                  className={`p-3.5 rounded-xl border text-left transition-all group ${
                    theme === 'dark'
                      ? 'bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-800/80 hover:border-zinc-700'
                      : 'bg-zinc-50 border-zinc-200 hover:bg-white hover:border-zinc-300 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="w-4 h-4 text-zinc-400 group-hover:text-indigo-500" />
                    <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-zinc-200 group-hover:text-white' : 'text-zinc-900 group-hover:text-black'}`}>Security & Privacy</span>
                  </div>
                  <p className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    SOC 2 Type II, zero training on customer data, AES-256.
                  </p>
                </button>

                <button
                  onClick={() => handleSendMessage('What are the API rate limits?')}
                  className={`p-3.5 rounded-xl border text-left transition-all group ${
                    theme === 'dark'
                      ? 'bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-800/80 hover:border-zinc-700'
                      : 'bg-zinc-50 border-zinc-200 hover:bg-white hover:border-zinc-300 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Code className="w-4 h-4 text-zinc-400 group-hover:text-indigo-500" />
                    <span className={`text-xs font-semibold ${theme === 'dark' ? 'text-zinc-200 group-hover:text-white' : 'text-zinc-900 group-hover:text-black'}`}>API Integration</span>
                  </div>
                  <p className={`text-xs ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Rate limits, quotas, and concurrency allowances.
                  </p>
                </button>
              </div>
            </div>
          ) : (
            /* Active Message Thread */
            <div className="max-w-3xl mx-auto py-6 space-y-6">
              {messages.map(msg => (
                <div key={msg.id} className="space-y-3">
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className={`max-w-[85%] sm:max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-[15px] leading-relaxed shadow-sm ${
                        theme === 'dark' ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-100 border border-zinc-200/80 text-zinc-900'
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3.5 sm:gap-4 items-start group">
                      <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 shadow-2xs ${
                        theme === 'dark' ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300 text-zinc-800'
                      }`}>
                        <svg width="15" height="15" viewBox="0 0 64 64" fill="none">
                          <path d="M 32 10 L 10 54 L 21 54 L 32 32 L 43 54 L 54 54 Z" fill={theme === 'dark' ? '#FFFFFF' : '#18181b'} fillRule="evenodd" />
                          <circle cx="32" cy="46" r="3" fill={theme === 'dark' ? '#FFFFFF' : '#18181b'} />
                        </svg>
                      </div>

                      <div className="flex-1 overflow-hidden space-y-3">
                        <div className={`max-w-none text-[15px] leading-relaxed ${theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900 font-normal'}`}>
                          {renderMessageContent(msg.content, msg.id)}
                        </div>

                        {msg.followUpSuggestions && msg.followUpSuggestions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {msg.followUpSuggestions.map((sug, sIdx) => (
                              <button
                                key={sIdx}
                                onClick={() => handleSendMessage(sug)}
                                className={`text-xs px-3 py-1.5 rounded-full border transition-all text-left ${
                                  theme === 'dark'
                                    ? 'bg-zinc-900/60 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                                    : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-800 font-medium shadow-2xs'
                                }`}
                              >
                                {sug}
                              </button>
                            ))}
                          </div>
                        )}

                        {(msg.modelName || msg.modelUsed) && (
                          <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono border-t pt-2 ${theme === 'dark' ? 'border-zinc-800/70 text-zinc-400' : 'border-zinc-200 text-zinc-600'}`}>
                            <Bot className="w-3.5 h-3.5 text-indigo-500" />
                            <span>Model used: <strong className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-900'}>{msg.modelName || msg.modelUsed}</strong></span>
                            {msg.gatewayName && <span>via {msg.gatewayName}</span>}
                            {msg.modelBadge && <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">{msg.modelBadge}</span>}
                            {typeof msg.totalLatencyMs === 'number' && <span>{(msg.totalLatencyMs / 1000).toFixed(1)}s</span>}
                          </div>
                        )}

                        <div className="flex items-center gap-3 text-xs pt-1 flex-wrap">
                          <button
                            onClick={() => copyText(msg.content, msg.id)}
                            className={`p-1 rounded transition-colors ${
                              theme === 'dark' ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                            }`}
                            title="Copy response"
                          >
                            {copiedId === msg.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>

                          <button
                            onClick={() => setFeedbackState(prev => ({ ...prev, [msg.id]: 'up' }))}
                            className={`p-1 rounded transition-colors ${
                              feedbackState[msg.id] === 'up'
                                ? 'text-emerald-500'
                                : theme === 'dark'
                                ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                            }`}
                            title="Good response"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => setFeedbackState(prev => ({ ...prev, [msg.id]: 'down' }))}
                            className={`p-1 rounded transition-colors ${
                              feedbackState[msg.id] === 'down'
                                ? 'text-rose-500'
                                : theme === 'dark'
                                ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                            }`}
                            title="Bad response"
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleRegenerate(msg)}
                            disabled={regeneratingId === msg.id || !msg.prompt}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-medium transition-all disabled:opacity-50 ${
                              theme === 'dark' ? 'border-zinc-700 text-zinc-200 hover:bg-zinc-800' : 'border-zinc-300 text-zinc-800 hover:bg-zinc-100'
                            }`}
                            title="Regenerate with a different AI model"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${regeneratingId === msg.id ? 'animate-spin' : ''}`} />
                            <span>{regeneratingId === msg.id ? 'Regenerating…' : 'Regenerate'}</span>
                          </button>

                          <div className="relative">
                            <button
                              onClick={() => setDownloadMenuId(downloadMenuId === msg.id ? null : msg.id)}
                              disabled={downloadingId === msg.id}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-medium transition-all disabled:opacity-50 ${
                                theme === 'dark' ? 'border-zinc-700 text-zinc-200 hover:bg-zinc-800' : 'border-zinc-300 text-zinc-800 hover:bg-zinc-100'
                              }`}
                              title="Download this answer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>{downloadingId === msg.id ? 'Preparing…' : 'Download'}</span>
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            {downloadMenuId === msg.id && (
                              <div className={`absolute left-0 bottom-9 z-20 w-52 rounded-xl border shadow-xl p-1.5 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                                <button onClick={() => handleDownloadAnswer(msg, 'pdf')} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-200' : 'hover:bg-zinc-100 text-zinc-800'}`}>
                                  <FileText className="w-4 h-4 text-rose-500" />
                                  <span><span className="block font-medium">Download as PDF</span><span className={`block text-[10px] ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-500'}`}>Branded, logo on every page</span></span>
                                </button>
                                <button onClick={() => handleDownloadAnswer(msg, 'docx')} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left ${theme === 'dark' ? 'hover:bg-zinc-800 text-zinc-200' : 'hover:bg-zinc-100 text-zinc-800'}`}>
                                  <FileType className="w-4 h-4 text-blue-500" />
                                  <span><span className="block font-medium">Download as Word</span><span className={`block text-[10px] ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-500'}`}>Editable .docx with header logo</span></span>
                                </button>
                              </div>
                            )}
                          </div>

                          {msg.latencyMicros ? (
                            <span className={`font-mono text-[11px] flex items-center gap-1 border px-1.5 py-0.5 rounded ${
                              theme === 'dark' ? 'border-zinc-800 text-zinc-400' : 'border-zinc-300 bg-zinc-50 text-zinc-700 font-medium'
                            }`}>
                              <Zap className="w-3 h-3 text-amber-500" />
                              <span>{msg.latencyMicros}μs (Instant)</span>
                            </span>
                          ) : msg.latencyMs ? (
                            <span className={`font-mono text-[11px] flex items-center gap-1 border px-1.5 py-0.5 rounded ${
                              theme === 'dark' ? 'border-zinc-800 text-zinc-400' : 'border-zinc-300 bg-zinc-50 text-zinc-700 font-medium'
                            }`}>
                              <Sparkles className="w-3 h-3 text-indigo-500" />
                              <span>{msg.latencyMs}ms</span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {isSending && (
                <div className="flex gap-3.5 sm:gap-4 items-center">
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300'
                  }`}>
                    <svg width="15" height="15" viewBox="0 0 64 64" fill="none">
                      <path d="M 32 10 L 10 54 L 21 54 L 32 32 L 43 54 L 54 54 Z" fill={theme === 'dark' ? '#FFFFFF' : '#18181b'} fillRule="evenodd" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono">
                    <span className={`w-1.5 h-1.5 rounded-full ${theme === 'dark' ? 'bg-zinc-400' : 'bg-zinc-600'} animate-pulse`}></span>
                    <span className={`w-1.5 h-1.5 rounded-full ${theme === 'dark' ? 'bg-zinc-400' : 'bg-zinc-600'} animate-pulse delay-150`}></span>
                    <span className={`w-1.5 h-1.5 rounded-full ${theme === 'dark' ? 'bg-zinc-400' : 'bg-zinc-600'} animate-pulse delay-300`}></span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Persistent Floating Input Bar */}
        <div className="w-full max-w-3xl mx-auto px-4 pb-4 pt-2">
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            className={`rounded-2xl border p-2 flex items-end gap-2 shadow-lg transition-all ${
              theme === 'dark'
                ? 'bg-[#141417] border-zinc-800 focus-within:border-zinc-600'
                : 'bg-white border-zinc-300 focus-within:border-zinc-400'
            }`}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputQuery}
              onChange={e => setInputQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Ask arkAI anything..."
              className={`flex-1 resize-none bg-transparent text-[15px] outline-none px-3 py-1.5 max-h-36 ${
                theme === 'dark' ? 'text-zinc-100 placeholder:text-zinc-500' : 'text-zinc-900 placeholder:text-zinc-400'
              }`}
            />

            <button
              type="submit"
              disabled={!inputQuery.trim() || isSending}
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                inputQuery.trim() && !isSending
                  ? theme === 'dark'
                    ? 'bg-white text-black hover:bg-zinc-200'
                    : 'bg-black text-white hover:bg-zinc-800'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
              title="Send message"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </form>

              <p className="text-[11px] text-zinc-400 text-center mt-2">
                arkAI routes every question to the best free model and shows which model answered. Verify important details.
              </p>
            </div>
          </>
        )}
      </main>

      {/* ============================================================== */}
      {/* QUICK SETTINGS POPUP MODAL                                     */}
      {/* ============================================================== */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={e => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl space-y-4 ${
              theme === 'dark' ? 'bg-[#121215] border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
            }`}
          >
            <div className={`flex items-center justify-between border-b pb-3 ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
              <h3 className={`font-semibold text-sm ${theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'}`}>arkAI Settings</h3>
              <button
                onClick={() => setSettingsOpen(false)}
                className={`p-1 rounded transition-colors ${theme === 'dark' ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-900'}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className={`font-medium ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>AI Source</label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setSettings(st => ({ ...st, mode: 'arkai' }))} className={`px-3 py-2 rounded-lg border font-medium ${settings.mode === 'arkai' ? 'border-indigo-500 bg-indigo-500/10' : theme === 'dark' ? 'border-zinc-800' : 'border-zinc-300'}`}>arkAI Models (Free)</button>
                  <button onClick={() => setSettings(st => ({ ...st, mode: 'ownkey' }))} className={`px-3 py-2 rounded-lg border font-medium ${settings.mode === 'ownkey' ? 'border-indigo-500 bg-indigo-500/10' : theme === 'dark' ? 'border-zinc-800' : 'border-zinc-300'}`}>My Own API Key</button>
                </div>
                <span className={`text-[10px] block ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                  {settings.mode === 'arkai' ? 'Free orchestrated models - no key needed. arkAI picks the best model per question.' : 'Only models from your own API account will be used.'}
                </span>
              </div>

              {settings.mode === 'ownkey' && (<>
              <div className="space-y-1">
                <label className={`font-medium ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>Provider Selection</label>
                <select
                  value={settings.provider}
                  onChange={e => setSettings(s => ({ ...s, provider: e.target.value as any }))}
                  className={`w-full rounded-lg px-2.5 py-2 text-xs outline-none border ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-200 focus:border-indigo-500' : 'bg-zinc-50 border-zinc-300 text-zinc-900 focus:border-indigo-600'
                  }`}
                >
                  <option value="auto">Auto-Detect Provider (Recommended)</option>
                  <option value="openai">OpenAI ChatGPT</option>
                  <option value="claude">Anthropic Claude</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="grok">xAI Grok</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="meta">Meta LLaMA</option>
                  <option value="qwen">Alibaba Qwen</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className={`font-medium ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    Your API Key
                  </label>
                  <span className="text-[10px] font-mono text-emerald-500 font-semibold">
                    {settings.apiKey ? 'Key Configured' : 'No key yet'}
                  </span>
                </div>
                <input
                  type="password"
                  placeholder="Paste any key (sk-..., AIzaSy..., xai-..., sk-ant-..., gsk_...)"
                  value={settings.apiKey}
                  onChange={e => setSettings(s => ({ ...s, apiKey: e.target.value }))}
                  className={`w-full rounded-lg px-3 py-2 text-xs font-mono outline-none border ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-200 focus:border-indigo-500' : 'bg-zinc-50 border-zinc-300 text-zinc-900 focus:border-indigo-600'
                  }`}
                />
                <span className={`text-[10px] block ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                  Stored only in this browser. Used only with the provider above - arkAI's free models are off in this mode.
                </span>
              </div>
              </>)}

              <div className="space-y-1">
                <label className={`font-medium ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>System Persona Preset</label>
                <select
                  value={settings.systemPromptPreset}
                  onChange={e => {
                    const preset = e.target.value as any;
                    setSettings(s => ({
                      ...s,
                      systemPromptPreset: preset,
                      customPrompt: SYSTEM_PRESETS[preset] || s.customPrompt
                    }));
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-xs outline-none border ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-200 focus:border-indigo-500' : 'bg-zinc-50 border-zinc-300 text-zinc-900 focus:border-indigo-600'
                  }`}
                >
                  <option value="concise">Concise & Structured</option>
                  <option value="developer">Developer Mode</option>
                  <option value="support">Customer Support</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className={`font-medium ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>Custom System Instruction</label>
                <textarea
                  rows={3}
                  value={settings.customPrompt}
                  onChange={e => setSettings(s => ({ ...s, customPrompt: e.target.value }))}
                  className={`w-full rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-500 resize-none border ${
                    theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-200' : 'bg-zinc-50 border-zinc-300 text-zinc-900'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className={`font-medium ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-700'}`}>Temperature (Creativity)</label>
                  <span className="font-mono text-zinc-400">{settings.temperature}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={settings.temperature}
                  onChange={e => setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                  className="w-full accent-indigo-500"
                />
              </div>

              <div className={`pt-2 border-t ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
                <button
                  onClick={clearAllData}
                  className="w-full py-2 px-3 rounded-lg border border-rose-900/60 bg-rose-950/20 text-rose-500 hover:bg-rose-950/40 transition-colors font-medium text-xs"
                >
                  Clear All Data
                </button>
              </div>
            </div>

            <div className={`flex justify-end pt-2 border-t ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
              <button
                onClick={() => setSettingsOpen(false)}
                className={`px-4 py-2 rounded-lg font-semibold text-xs transition-colors ${
                  theme === 'dark' ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-black'
                }`}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
