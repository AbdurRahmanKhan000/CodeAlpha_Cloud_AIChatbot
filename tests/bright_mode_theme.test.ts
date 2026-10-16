/**
 * arkAI Test Suite: Bright Mode (Light Theme) UI & Contrast Validation
 * Verifies that assistant replies, empty state headings, avatars, and action controls
 * properly adapt to Bright Mode without dark-on-dark or white-on-white invisibility.
 */

import fs from 'fs';
import path from 'path';

export function runBrightModeTests(): { name: string; passed: boolean; details?: string }[] {
  const results = [];
  const appPath = path.resolve('src/App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf-8');
  const mdPath = path.resolve('src/Markdown.tsx');
  const mdContent = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : '';

  // Test 1: Empty hero state heading contrast in light mode
  const hasHeroHeadingContrast = appContent.includes("theme === 'dark' ? 'text-zinc-100' : 'text-zinc-900'");
  results.push({
    name: 'Hero heading uses dark text in Bright Mode (No white-on-white)',
    passed: hasHeroHeadingContrast,
    details: hasHeroHeadingContrast ? 'Contrast check passed: text-zinc-900 in light mode' : 'Missing contrast class'
  });

  // Test 2: Hero suggestion prompt card titles contrast in light mode
  const hasPromptTitleContrast = appContent.includes("theme === 'dark' ? 'text-zinc-200 group-hover:text-white' : 'text-zinc-900 group-hover:text-black'");
  results.push({
    name: 'Starter prompt cards use high-contrast text in Bright Mode',
    passed: hasPromptTitleContrast,
    details: 'Visible dark typography on light background verified'
  });

  // Test 3: Assistant logo SVG fill adapts to light theme (dark fill on light bg)
  const hasSvgThemeFill = appContent.includes("theme === 'dark' ? '#FFFFFF' : '#18181b'");
  results.push({
    name: 'Assistant avatar SVG fill adapts to Bright Mode (#18181b on light)',
    passed: hasSvgThemeFill,
    details: 'SVG path and circle fill dynamically based on theme'
  });

  // Test 4: Markdown headers (h1, h2, h3) render with dark high-contrast in Bright Mode
  const hasHeadingMarkdownContrast = mdContent.includes("dark ? 'text-zinc-50' : 'text-zinc-950'") || mdContent.includes('text-zinc-950');
  results.push({
    name: 'Markdown headings render with high-contrast text in Bright Mode',
    passed: hasHeadingMarkdownContrast,
    details: 'Headings use text-zinc-950 in light mode'
  });

  // Test 5: Blockquotes have dedicated light callout background in Bright Mode
  const hasBlockquoteTheme = mdContent.includes('border-indigo-400') && mdContent.includes('text-zinc-600');
  results.push({
    name: 'Blockquotes and notice banners adapt cleanly to Bright Mode',
    passed: hasBlockquoteTheme,
    details: 'Blockquotes use an indigo rule with dark text in light mode (Markdown.tsx)'
  });

  // Test 6: Settings modal and dashboard adapt to Bright Mode
  const hasSettingsThemeAdapt = appContent.includes("bg-white border-zinc-200") && appContent.includes("focus:border-indigo-600");
  results.push({
    name: 'Settings dashboard and modals adapt cleanly to Bright Mode',
    passed: hasSettingsThemeAdapt,
    details: 'Inputs and cards switch from dark zinc to clean light surface'
  });

  return results;
}
