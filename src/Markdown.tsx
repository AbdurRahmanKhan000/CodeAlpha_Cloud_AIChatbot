import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Check, Copy } from 'lucide-react';
import 'katex/dist/katex.min.css';

/**
 * Professional markdown rendering for arkAI replies:
 * - GitHub-flavoured markdown (real tables, lists, strikethrough)
 * - KaTeX mathematics: \(...\), \[...\], $...$, $$...$$ all normalised
 * - Streaming-safe: unbalanced fences/markers in a partial answer are healed
 * - One consistent font family for all prose; mono only inside code
 */

// Convert LaTeX bracket delimiters (GPT-OSS / DeepSeek style) to $ delimiters
// that remark-math understands. Runs only outside fenced code blocks.
export function normalizeMathDelimiters(src: string): string {
  const parts = src.split(/(```[\s\S]*?(?:```|$))/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // fenced code untouched
    return part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `\n$$\n${inner.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${inner}$`);
  }).join('');
}

// While streaming, the markdown is a prefix. Close anything left open so the
// partial answer renders cleanly instead of flickering into a code mess.
export function healPartialMarkdown(src: string): string {
  let out = src;
  const fences = (out.match(/```/g) || []).length;
  if (fences % 2 === 1) out += '\n```';
  const bold = (out.match(/\*\*/g) || []).length;
  if (bold % 2 === 1) out += '**';
  const ticks = (out.replace(/```[\s\S]*?```/g, '').match(/(?<!`)`(?!`)/g) || []).length;
  if (ticks % 2 === 1) out += '`';
  return out;
}

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) return extractText((node.props as any)?.children);
  return '';
}

export default function MarkdownMessage({ content, theme, streaming = false }: {
  content: string;
  theme: 'dark' | 'light';
  streaming?: boolean;
}) {
  const dark = theme === 'dark';
  const prepared = healPartialMarkdown(normalizeMathDelimiters(content || ''));

  const components = {
    pre({ children }: any) {
      const codeEl = React.Children.toArray(children)[0] as React.ReactElement<any>;
      const className: string = codeEl?.props?.className || '';
      const lang = /language-([\w-]+)/.exec(className)?.[1] || 'code';
      const raw = extractText(codeEl?.props?.children).replace(/\n$/, '');
      return <CodeBlock raw={raw} lang={lang} dark={dark} />;
    },
    code({ className, children, node, ...props }: any) {
      const isBlock = node?.position && node.position.start.line !== node.position.end.line || !!className;
      if (isBlock) return <code className={className} {...props}>{children}</code>;
      return (
        <code className={`px-1.5 py-0.5 rounded-md text-[0.85em] font-mono ${dark ? 'bg-zinc-800 text-indigo-300' : 'bg-zinc-100 text-indigo-700'}`} {...props}>
          {children}
        </code>
      );
    },
    table({ children }: any) {
      return (
        <div className={`my-3 overflow-x-auto rounded-xl border ${dark ? 'border-zinc-800' : 'border-zinc-200'}`}>
          <table className="w-full text-sm border-collapse">{children}</table>
        </div>
      );
    },
    thead({ children }: any) {
      return <thead className={dark ? 'bg-zinc-900' : 'bg-zinc-50'}>{children}</thead>;
    },
    th({ children }: any) {
      return <th className={`px-3 py-2 text-left font-semibold border-b ${dark ? 'border-zinc-800 text-zinc-100' : 'border-zinc-200 text-zinc-900'}`}>{children}</th>;
    },
    td({ children }: any) {
      return <td className={`px-3 py-2 align-top border-b ${dark ? 'border-zinc-800/60 text-zinc-300' : 'border-zinc-100 text-zinc-700'}`}>{children}</td>;
    },
    h1({ children }: any) { return <h1 className={`text-xl font-bold mt-5 mb-2 ${dark ? 'text-zinc-50' : 'text-zinc-950'}`}>{children}</h1>; },
    h2({ children }: any) { return <h2 className={`text-lg font-bold mt-5 mb-2 ${dark ? 'text-zinc-50' : 'text-zinc-950'}`}>{children}</h2>; },
    h3({ children }: any) { return <h3 className={`text-base font-bold mt-4 mb-1.5 ${dark ? 'text-zinc-100' : 'text-zinc-900'}`}>{children}</h3>; },
    h4({ children }: any) { return <h4 className={`text-sm font-bold mt-3 mb-1 ${dark ? 'text-zinc-100' : 'text-zinc-900'}`}>{children}</h4>; },
    p({ children }: any) { return <p className="my-2 first:mt-0 last:mb-0">{children}</p>; },
    ul({ children }: any) { return <ul className="my-2 list-disc pl-5 space-y-1 marker:text-zinc-500">{children}</ul>; },
    ol({ children }: any) { return <ol className="my-2 list-decimal pl-5 space-y-1 marker:text-zinc-500">{children}</ol>; },
    li({ children }: any) { return <li className="leading-7">{children}</li>; },
    blockquote({ children }: any) {
      return <blockquote className={`my-3 pl-3 border-l-2 italic ${dark ? 'border-indigo-500/60 text-zinc-400' : 'border-indigo-400 text-zinc-600'}`}>{children}</blockquote>;
    },
    hr() { return <hr className={`my-4 border-t ${dark ? 'border-zinc-800' : 'border-zinc-200'}`} />; },
    a({ children, href }: any) {
      return <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline decoration-indigo-500/40 underline-offset-2 hover:decoration-indigo-500">{children}</a>;
    },
    strong({ children }: any) { return <strong className={`font-semibold ${dark ? 'text-zinc-50' : 'text-zinc-950'}`}>{children}</strong>; },
  };

  return (
    <div className={`ark-md font-sans text-[15px] leading-7 break-words ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components as any}>
        {prepared}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block w-2 h-4 ml-1 align-text-bottom bg-indigo-500 animate-pulse rounded-[2px]" aria-label="Generating" />
      )}
    </div>
  );
}

function CodeBlock({ raw, lang, dark }: { raw: string; lang: string; dark: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div className={`my-3 rounded-xl overflow-hidden border ${dark ? 'border-zinc-800 bg-[#0b0b0d]' : 'border-zinc-200 bg-zinc-950'}`}>
      <div className={`flex items-center justify-between px-3 py-1.5 text-[11px] font-mono ${dark ? 'bg-zinc-900 text-zinc-400' : 'bg-zinc-900 text-zinc-400'}`}>
        <span className="uppercase tracking-wider">{lang}</span>
        <button type="button" onClick={copy} className="flex items-center gap-1 hover:text-zinc-100 transition-colors cursor-pointer">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-[13px] leading-6 font-mono text-zinc-100"><code>{raw}</code></pre>
    </div>
  );
}
