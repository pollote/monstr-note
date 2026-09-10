import test from 'node:test';
import assert from 'node:assert';
import { renderMarkdown, toggleChecklistItem } from '../src/lib/utils/markdown.js';

test('Markdown Renderer - Basic & Checklist Parsing', () => {
  const md = `# Header 1
**Bold text** and *italic text*

- [ ] Task 1
- [x] Task 2
`;

  const html = renderMarkdown(md);
  assert.ok(html.includes('<h1>Header 1</h1>'));
  assert.ok(html.includes('<strong>Bold text</strong>'));
  assert.ok(html.includes('<em>italic text</em>'));
  assert.ok(html.includes('class="task-list-item "'));
  assert.ok(html.includes('class="task-list-item completed"'));
});

test('Markdown Renderer - Toggle Checklist Item', () => {
  const md = `- [ ] Buy coffee\n- [x] Write code`;
  
  // Toggle first item from unchecked -> checked
  const toggled = toggleChecklistItem(md, 0);
  assert.strictEqual(toggled, `- [x] Buy coffee\n- [x] Write code`);

  // Toggle second item from checked -> unchecked
  const toggled2 = toggleChecklistItem(toggled, 1);
  assert.strictEqual(toggled2, `- [x] Buy coffee\n- [ ] Write code`);
});
