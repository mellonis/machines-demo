// Minimal markdown subset for snippet lesson notes (#112).
// Author-controlled content from defaultCode.ts only — no user input. The
// renderer covers exactly what the showcase notes need: paragraphs, bullet
// lists, and inline-code spans. Everything else is left as plain text.

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

function inlineCode(text: string): string {
  return text.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
}

function isBulletBlock(block: string): boolean {
  const lines = block.split('\n');
  return lines.length > 0 && lines.every((l) => l.trim().startsWith('- '));
}

/**
 * Renders a small markdown subset to HTML. Intended for `{@html}` injection
 * of build-time author content (per the demo's existing `{@html}` policy
 * for SVG icon strings). Do NOT call on user-provided text without
 * sanitization — this only does HTML-entity escaping, not full sanitization.
 *
 * Supported:
 *   - Paragraphs (split on one-or-more blank lines).
 *   - Bullet lists (a block where every line starts with `- `).
 *   - Inline code via backticks.
 */
export function renderLessonMarkdown(source: string): string {
  // Escape FIRST, then apply formatters that emit HTML. The inline-code
  // replacement inserts `<code>` tags into already-escaped text, which is
  // safe because the inner content was already escaped before tagging.
  const escaped = escapeHtml(source.trim());
  const blocks = escaped.split(/\n\s*\n+/);
  return blocks
    .map((block) => {
      if (isBulletBlock(block)) {
        const items = block
          .split('\n')
          .map((l) => `<li>${inlineCode(l.trim().slice(2).trim())}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${inlineCode(block)}</p>`;
    })
    .join('');
}
