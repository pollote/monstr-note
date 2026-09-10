/**
 * Fast Lightweight Markdown Renderer with interactive checklist support
 */
export function renderMarkdown(markdownText = '') {
  if (!markdownText) return '<p class="empty-note-placeholder">Start typing your note...</p>';

  // Escape basic HTML to prevent XSS
  let html = markdownText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code Blocks (```lang ... ```)
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline Code (`code`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Blockquotes
  html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

  // Interactive Checklists (- [ ] item or - [x] item)
  let checklistIndex = 0;
  html = html.replace(/^[*\-]\s+\[([ xX])\]\s+(.*$)/gim, (match, checked, label) => {
    const isChecked = checked.toLowerCase() === 'x';
    const index = checklistIndex++;
    return `<div class="task-list-item ${isChecked ? 'completed' : ''}">
      <input type="checkbox" class="task-checkbox" data-index="${index}" ${isChecked ? 'checked' : ''} />
      <span class="task-label">${parseInlineStyle(label)}</span>
    </div>`;
  });

  // Unordered Lists (- item or * item)
  html = html.replace(/^[*\-]\s+(?!<div class="task-list-item")(.*$)/gim, '<ul><li>$1</li></ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, ''); // merge adjacent lists

  // Ordered Lists (1. item)
  html = html.replace(/^\d+\.\s+(.*$)/gim, '<ol><li>$1</li></ol>');
  html = html.replace(/<\/ol>\s*<ol>/g, ''); // merge adjacent lists

  // Inline Styles: Bold, Italic, Strikethrough, Links
  html = parseInlineStyle(html);

  // Paragraph breaks (double line breaks)
  const lines = html.split(/\n\n+/);
  html = lines
    .map((line) => {
      line = line.trim();
      if (
        line.startsWith('<h1') ||
        line.startsWith('<h2') ||
        line.startsWith('<h3') ||
        line.startsWith('<pre') ||
        line.startsWith('<blockquote') ||
        line.startsWith('<ul') ||
        line.startsWith('<ol') ||
        line.startsWith('<div class="task-list-item')
      ) {
        return line;
      }
      return `<p>${line.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return html;
}

function parseInlineStyle(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

/**
 * Helper to toggle a checklist item at given index inside markdown text
 */
export function toggleChecklistItem(markdownText, itemIndex) {
  let currentIndex = 0;
  return markdownText.replace(/^[*\-]\s+\[([ xX])\]\s+(.*$)/gim, (match, checked, label) => {
    if (currentIndex === itemIndex) {
      const isCurrentlyChecked = checked.toLowerCase() === 'x';
      const newCheck = isCurrentlyChecked ? ' ' : 'x';
      currentIndex++;
      return `- [${newCheck}] ${label}`;
    }
    currentIndex++;
    return match;
  });
}
