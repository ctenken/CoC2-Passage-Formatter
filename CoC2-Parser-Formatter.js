import {
  indentUnit as codeMirrorIndentUnit,
  Decoration,
  defaultKeymap,
  drawSelection,
  EditorState,
  EditorView,
  highlightActiveLine, highlightActiveLineGutter,
  history,
  historyKeymap, indentWithTab,
  keymap,
  lineNumbers,
  lintGutter,
  placeholder,
  setDiagnostics,
  ViewPlugin,
} from './dist/cm6-bundle.js';

// ─── Formatter core (unchanged) ───────────────────────────────────────────────

let indentUnit = '\t';
function isWhitespace(ch) { return ch === ' ' || ch === '\t' || ch === '\r'; }

function formatTextify(inner, baseIndent, startLine) {
  let result = '', i = 0, line = startLine, atLineStart = false;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '\n') { result += '\n'; atLineStart = true; line++; i++; continue; }
    if (atLineStart) {
      while (i < inner.length && isWhitespace(inner[i])) i++;
      atLineStart = false;
      if (i >= inner.length || inner[i] === '\n') continue;
      result += baseIndent;
      continue;
    }
    if (ch === '[') {
      const { formatted, endIndex, line: newLine } = processBracket(inner, i, baseIndent, line);
      result += formatted; i = endIndex + 1; line = newLine;
    } else if (ch === ']') {
      throw new Error(`Unmatched ']' at line ${line}`);
    } else { result += ch; i++; }
  }
  return { result, line };
}

function processBracket(str, startIndex, bracketIndent, startLine) {
  const openLine = startLine;
  let i = startIndex + 1, depth = 1, content = '', line = startLine;
  while (i < str.length && depth > 0) {
    const ch = str[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (depth > 0) { content += ch; if (ch === '\n') line++; }
    else if (ch === '\n') line++;
    i++;
  }
  if (depth !== 0) throw new Error(`Unmatched '[' at line ${openLine}`);
  const endIndex = i - 1;
  if (!hasTopLevelPipe(content)) {
    const { result: inner, line: newLine } = formatChoiceContent(content, bracketIndent, openLine);
    return { formatted: '[' + inner + ']', endIndex, line: newLine };
  }
  const parts = splitOnTopLevelPipes(content);
  const qualifier = parts[0].trim();
  const choices = parts.slice(1);
  const innerIndent = bracketIndent + indentUnit;
  let formatted = '[' + qualifier + '\n';
  let choiceLine = openLine;
  for (const choice of choices) {
    const { result: body, line: afterLine } = formatChoiceContent(choice, innerIndent, choiceLine);
    choiceLine = afterLine;
    formatted += innerIndent + '|' + body.replace(/[\r\n]+$/, '') + '\n';
  }
  formatted += bracketIndent + ']';
  return { formatted, endIndex, line };
}

function formatChoiceContent(content, knownIndent, startLine) {
  let result = '', i = 0, line = startLine, atLineStart = false;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\n') { result += '\n'; atLineStart = true; line++; i++; continue; }
    if (atLineStart) {
      while (i < content.length && isWhitespace(content[i])) i++;
      atLineStart = false;
      if (i >= content.length || content[i] === '\n') continue;
      result += knownIndent;
      continue;
    }
    if (ch === '[') {
      const { formatted, endIndex, line: newLine } = processBracket(content, i, knownIndent, line);
      result += formatted; i = endIndex + 1; line = newLine;
    } else if (ch === ']') {
      throw new Error(`Unmatched ']' at line ${line}`);
    } else { result += ch; i++; }
  }
  return { result, line };
}

function hasTopLevelPipe(str) {
  let depth = 0;
  for (const ch of str) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === '|' && depth === 0) return true;
  }
  return false;
}

function splitOnTopLevelPipes(str) {
  const parts = []; let depth = 0, current = '';
  for (const ch of str) {
    if (ch === '[') { depth++; current += ch; }
    else if (ch === ']') { depth--; current += ch; }
    else if (ch === '|' && depth === 0) { parts.push(current); current = ''; }
    else current += ch;
  }
  parts.push(current);
  return parts;
}

function processContent(content) {
  content = content.replace(/\r\n/g, '\n');
  const errors = [];
  if (!/textify`/.test(content)) {
    try {
      const { result } = formatTextify(content, '', 1);
      return { result, errors };
    } catch (err) {
      const m = err.message.match(/line (\d+)/);
      errors.push({ line: m ? parseInt(m[1]) : 1, message: err.message });
      return { result: content, errors };
    }
  }
  const segments = [];
  const blockRe = /^([ \t]*)(.*?)textify`([\s\S]*?)`/gm;
  let lastIndex = 0, match;
  while ((match = blockRe.exec(content)) !== null) {
    if (match.index > lastIndex)
      segments.push({ type: 'prose', text: content.slice(lastIndex, match.index), offset: lastIndex });
    segments.push({ type: 'textify', match, offset: match.index });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length)
    segments.push({ type: 'prose', text: content.slice(lastIndex), offset: lastIndex });

  let result = '';
  for (const seg of segments) {
    if (seg.type === 'prose') {
      const segLine = content.slice(0, seg.offset).split('\n').length;
      try {
        const { result: formatted } = formatTextify(seg.text, '', segLine);
        result += formatted;
      } catch (err) {
        const m = err.message.match(/line (\d+)/);
        errors.push({ line: m ? parseInt(m[1]) : segLine, message: err.message });
        result += seg.text;
      }
    } else {
      const [full, leadingIndent, prefix, inner] = seg.match;
      const blockLine = content.slice(0, seg.offset).split('\n').length;
      try {
        const { result: formatted } = formatTextify(inner, leadingIndent, blockLine);
        const closingIndent = /^\r?\n/.test(inner) ? leadingIndent : '';
        const body = closingIndent ? formatted.replace(/\n*$/, '\n') : formatted;
        result += `${leadingIndent}${prefix}textify\`${body}${closingIndent}\``;
      } catch (err) {
        const m = err.message.match(/line (\d+)/);
        errors.push({ line: m ? parseInt(m[1]) : blockLine, message: err.message });
        result += full;
      }
    }
  }
  return { result, errors };
}

// ─── Bracket-depth highlighting ───────────────────────────────────────────────

function buildDepthDecorations(doc) {
  const marks = [];
  let depth = 0;
  let runStart = 0, runDepth = 0;

  function flush(end) {
    if (runStart >= end || runDepth === 0) { runStart = end; return; }
    marks.push(Decoration.mark({ class: `bd${Math.min(runDepth, 16)}` }).range(runStart, end));
    runStart = end;
  }

  const text = doc.toString();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '[') {
      flush(i);
      depth++;
      marks.push(Decoration.mark({ class: `bd${Math.min(depth, 16)}` }).range(i, i + 1));
      runStart = i + 1; runDepth = depth;
    } else if (ch === ']') {
      flush(i);
      marks.push(Decoration.mark({ class: `bd${Math.min(depth, 16)}` }).range(i, i + 1));
      depth = Math.max(0, depth - 1);
      runStart = i + 1; runDepth = depth;
    } else if (ch === '\n') {
      flush(i);
      runStart = i + 1;
    }
  }
  flush(text.length);
  // marks must be sorted; they already are since we iterate left-to-right
  return Decoration.set(marks, true);
}

const depthPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.highlightOn = !document.body.classList.contains('no-highlight');
    this.decorations = this._build(view);
  }
  update(update) {
    const highlightOn = !document.body.classList.contains('no-highlight');
    if (update.docChanged || update.viewportChanged || highlightOn !== this.highlightOn) {
      this.highlightOn = highlightOn;
      this.decorations = this._build(update.view);
    }
  }
  _build(view) {
    if (!this.highlightOn) return Decoration.none;
    try { return buildDepthDecorations(view.state.doc); }
    catch (_) { return Decoration.none; }
  }
}, { decorations: v => v.decorations });

// ─── Wrapped-line indentation ─────────────────────────────────────────────────

const WRAP_TAB_COLUMNS = 4;
const MAX_WRAP_INDENT = 80;

function leadingColumns(text) {
  let columns = 0;
  for (const ch of text) {
    if (ch === ' ') columns++;
    else if (ch === '\t') columns += WRAP_TAB_COLUMNS - (columns % WRAP_TAB_COLUMNS);
    else break;
  }
  return Math.min(columns, MAX_WRAP_INDENT);
}

function previousIndentColumns(doc, lineNumber) {
  for (let number = lineNumber - 1; number >= 1; number--) {
    const text = doc.line(number).text;
    if (text.length === 0) continue;
    return leadingColumns(text);
  }
  return 0;
}

function guideColumns(columns) {
  return Math.floor(columns / WRAP_TAB_COLUMNS) * WRAP_TAB_COLUMNS;
}

function buildWrapIndentDecorations(view) {
  const marks = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const indent = leadingColumns(line.text);
      if (indent > 0) {
        marks.push(Decoration.line({
          attributes: {
            style: `padding-left:${indent}ch;text-indent:-${indent}ch;`,
          },
        }).range(line.from));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(marks, true);
}

function buildIndentGuideDecorations(view) {
  const marks = [];
  let activeIndent = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const lineIndent = leadingColumns(line.text);
      if (lineIndent > 0) activeIndent = lineIndent;
      else if (line.text.trim() !== '') activeIndent = 0;

      const rawGuideWidth = lineIndent || (line.text.length === 0 ? activeIndent || previousIndentColumns(view.state.doc, line.number) : 0);
      const guideWidth = guideColumns(rawGuideWidth);
      if (guideWidth > 0) {
        marks.push(Decoration.line({
          attributes: {
            class: 'cm-indentGuideLine',
            style: `--indent-guide-width:${guideWidth}ch;`,
          },
        }).range(line.from));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(marks, true);
}

const wrapIndentPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildWrapIndentDecorations(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged)
      this.decorations = buildWrapIndentDecorations(update.view);
  }
}, { decorations: v => v.decorations });

const indentGuidePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildIndentGuideDecorations(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged)
      this.decorations = buildIndentGuideDecorations(update.view);
  }
}, { decorations: v => v.decorations });

// ─── Selected text coloring ───────────────────────────────────────────────────

function buildSelectedTextDecorations(view) {
  const marks = [];
  for (const range of view.state.selection.ranges) {
    if (range.empty) continue;
    for (const visible of view.visibleRanges) {
      const from = Math.max(range.from, visible.from);
      const to = Math.min(range.to, visible.to);
      if (from < to)
        marks.push(Decoration.mark({ class: 'cm-selectedText' }).range(from, to));
    }
  }
  return Decoration.set(marks, true);
}

const selectedTextPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildSelectedTextDecorations(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged)
      this.decorations = buildSelectedTextDecorations(update.view);
  }
}, { decorations: v => v.decorations });

// ─── Build the editor ─────────────────────────────────────────────────────────

const host = document.getElementById('cm-host');

const view = new EditorView({
  parent: host,
  extensions: [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    lineNumbers(),
    lintGutter(),
    codeMirrorIndentUnit.of('    '),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    placeholder('Paste your text here and click Format.'),
    wrapIndentPlugin,
    indentGuidePlugin,
    depthPlugin,
    selectedTextPlugin,
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        updateCounts(update.state.doc.toString());
        saveState();
      }
    }),
  ],
});

// ─── Counts ───────────────────────────────────────────────────────────────────

const wordCountEl    = document.getElementById('wordCount');
const charCountEl    = document.getElementById('charCount');
const bracketCountEl = document.getElementById('bracketCount');
const bracketWarnEl  = document.getElementById('bracketWarn');

function updateCounts(text) {
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  wordCountEl.textContent = words.toLocaleString() + ' word' + (words === 1 ? '' : 's');
  const n = text.length;
  charCountEl.textContent = n.toLocaleString() + ' char' + (n === 1 ? '' : 's');
  let open = 0, close = 0;
  for (const ch of text) { if (ch === '[') open++; else if (ch === ']') close++; }
  const balanced = open === close;
  bracketCountEl.textContent = '[' + open + ' / ]' + close;
  bracketCountEl.style.color = balanced || text.trim() === '' ? '' : 'var(--danger)';
  bracketWarnEl.style.display = (!balanced && text.trim() !== '') ? '' : 'none';
}

// ─── Status bar ───────────────────────────────────────────────────────────────

const statusEl = document.getElementById('status');
function showStatus(msg, type) {
  statusEl.className = 'status';
  requestAnimationFrame(() => {
    statusEl.textContent = msg;
    statusEl.className = 'status show ' + type;
  });
  clearTimeout(showStatus._timer);
  showStatus._timer = setTimeout(() => { statusEl.className = 'status'; }, 10000);
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

function applyErrors(errors) {
  const doc = view.state.doc;
  const diags = errors.map(err => {
    const lineNum = Math.max(1, Math.min(err.line, doc.lines));
    const line = doc.line(lineNum);
    return { from: line.from, to: line.to, severity: 'error', message: err.message };
  });
  view.dispatch(setDiagnostics(view.state, diags));
}

function clearErrors() {
  view.dispatch(setDiagnostics(view.state, []));
}

// ─── Toolbar actions (exposed to window for onclick= attributes) ───────────────

window.runFormat = function () {
  const text = view.state.doc.toString();
  if (!text.trim()) { showStatus('Nothing to format.', 'err'); return; }
  const { result, errors } = processContent(text);
  if (errors.length > 0) {
    applyErrors(errors);
    showStatus(`${errors.length} error${errors.length > 1 ? 's' : ''} found — see annotations.`, 'err');
    return;
  }
  clearErrors();
  const normalized = text.replace(/\r\n/g, '\n');
  const changed = result !== normalized;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result } });
  saveState();
  showStatus(changed ? 'Formatted successfully.' : 'Already formatted — no changes needed.', 'ok');
};

window.copyText = function () {
  const text = view.state.doc.toString();
  if (!text.trim()) { showStatus('Nothing to copy.', 'err'); return; }
  navigator.clipboard.writeText(text)
    .then(() => showStatus('Copied to clipboard.', 'ok'))
    .catch(() => showStatus('Copy failed — try selecting and using Ctrl+C.', 'err'));
};

window.clearAll = function () {
  if (!view.state.doc.toString().trim()) return;
  showConfirm('Clear all text?', 'This cannot be undone.', () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
    clearErrors();
    statusEl.className = 'status';
    saveState();
  });
};

// ─── Theme / highlight ────────────────────────────────────────────────────────

let isDark = true;
let highlightOn = true;
let editorFontSize = 16;

function normalizeFontSize(size) {
  const parsed = Number.parseInt(String(size || '').replace('px', ''), 10);
  if (!Number.isFinite(parsed)) return 16;
  return Math.max(1, Math.min(100, parsed));
}

function refreshEditorLayout() {
  view.requestMeasure();
  view.dispatch({});
  requestAnimationFrame(() => view.requestMeasure());
}

function applyFontSize(size) {
  editorFontSize = normalizeFontSize(size);
  document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`);
  const input = document.getElementById('fontSizeInput');
  if (input) input.value = editorFontSize;
  refreshEditorLayout();
}

window.toggleTheme = function () {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'light');
  const moon = document.getElementById('themeIconMoon');
  const sun  = document.getElementById('themeIconSun');
  const lbl  = document.getElementById('themeLabel');
  if (isDark) { moon.style.display = ''; sun.style.display = 'none'; lbl.textContent = 'Light'; }
  else        { moon.style.display = 'none'; sun.style.display = ''; lbl.textContent = 'Dark'; }
  saveState();
};

window.setFontSize = function (size) {
  applyFontSize(size);
  saveState();
};

window.adjustFontSize = function (amount) {
  applyFontSize(editorFontSize + amount);
  saveState();
};

window.commitFontSizeInput = function (event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    window.setFontSize(event.currentTarget.value);
    view.focus();
  } else if (event.key === 'Escape') {
    event.currentTarget.value = editorFontSize;
  }
};

window.toggleHighlight = function () {
  highlightOn = !highlightOn;
  document.body.classList.toggle('no-highlight', !highlightOn);
  document.getElementById('highlightToggle').classList.toggle('active', highlightOn);
  view.dispatch({}); // nudge plugin to re-evaluate
  saveState();
};

function updateIndentToggle() {
  const label = indentUnit === '\t' ? 'Tabs' : indentUnit === '    ' ? 'Spaces' : 'None';
  document.getElementById('indentToggle').classList.toggle('active', indentUnit !== '');
  document.getElementById('indentLabel').textContent = label;
}

window.toggleIndent = function () {
  indentUnit = indentUnit === '\t' ? '    ' : indentUnit === '    ' ? '' : '\t';
  updateIndentToggle();
  saveState();
};

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function showConfirm(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-title">${title}</div>
      <div class="confirm-message">${message}</div>
      <div class="confirm-actions">
        <button class="confirm-cancel">Cancel</button>
        <button class="confirm-ok danger-btn">Clear</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('.confirm-cancel').addEventListener('click', close);
  overlay.querySelector('.confirm-ok').addEventListener('click', () => { close(); onConfirm(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.confirm-cancel').focus();
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function saveState() {
  try {
    localStorage.setItem('fmtTextify_text',  view.state.doc.toString());
    localStorage.setItem('fmtTextify_theme', isDark ? 'dark' : 'light');
    localStorage.setItem('fmtTextify_indent', indentUnit === '\t' ? 'tab' : indentUnit === '    ' ? 'spaces' : 'none');
    localStorage.setItem('fmtTextify_highlight', highlightOn ? 'on' : 'off');
    localStorage.setItem('fmtTextify_fontSize', `${editorFontSize}px`);
  } catch (_) {}
}

function loadState() {
  try {
    const savedTheme = localStorage.getItem('fmtTextify_theme');
    if (savedTheme === 'light') {
      isDark = false;
      document.documentElement.setAttribute('data-theme', 'light');
      document.getElementById('themeIconMoon').style.display = 'none';
      document.getElementById('themeIconSun').style.display  = '';
      document.getElementById('themeLabel').textContent       = 'Dark';
    }
    const savedIndent = localStorage.getItem('fmtTextify_indent');
    indentUnit = savedIndent === 'spaces' ? '    ' : savedIndent === 'none' ? '' : '\t';
    updateIndentToggle();
    applyFontSize(localStorage.getItem('fmtTextify_fontSize'));
    const savedHighlight = localStorage.getItem('fmtTextify_highlight');
    highlightOn = savedHighlight !== 'off';
    document.body.classList.toggle('no-highlight', !highlightOn);
    document.getElementById('highlightToggle').classList.toggle('active', highlightOn);
    view.dispatch({});
    const savedText = localStorage.getItem('fmtTextify_text');
    if (savedText) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: savedText } });
      updateCounts(savedText);
    } else {
      updateCounts('');
    }
  } catch (_) { updateCounts(''); }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadState();
