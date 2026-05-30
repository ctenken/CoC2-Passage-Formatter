const INDENT = '    ';

function isWhitespace(ch) { return ch === ' ' || ch === '\t' || ch === '\r'; }

// ── Formatter core ────────────────────────────────────────────────────────────

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
  const innerIndent = bracketIndent + INDENT;
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

  // Split content into segments: alternating outside/inside textify` blocks.
  // We format brackets in BOTH kinds of segments.
  const segments = [];
  const blockRe = /^([ \t]*)(.*?)textify`([\s\S]*?)`/gm;
  let lastIndex = 0;
  let match;
  while ((match = blockRe.exec(content)) !== null) {
    // Prose segment before this textify` block
    if (match.index > lastIndex) {
      segments.push({ type: 'prose', text: content.slice(lastIndex, match.index), offset: lastIndex });
    }
    segments.push({ type: 'textify', match, offset: match.index });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'prose', text: content.slice(lastIndex), offset: lastIndex });
  }

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

// ── UI ────────────────────────────────────────────────────────────────────────

const editor          = document.getElementById('editor');
const editorDisplay   = document.getElementById('editorDisplay');
const statusEl        = document.getElementById('status');
const wordCountEl     = document.getElementById('wordCount');
const charCountEl     = document.getElementById('charCount');
const bracketCountEl  = document.getElementById('bracketCount');
const gutterInner     = document.getElementById('gutterInner');
const editorScroll    = document.getElementById('editorScroll');

let currentErrors = [];
let highlightOn = true;
let isDark = true; // dark is default

// ── Persistence ───────────────────────────────────────────────────────────────

function saveState() {
  try {
    localStorage.setItem('fmtTextify_text',  editor.value);
    localStorage.setItem('fmtTextify_theme', isDark ? 'dark' : 'light');
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
    const savedText = localStorage.getItem('fmtTextify_text');
    if (savedText) {
      editor.value = savedText;
    }
  } catch (_) {}
}

function toggleTheme() {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'light');
  const moon = document.getElementById('themeIconMoon');
  const sun  = document.getElementById('themeIconSun');
  const lbl  = document.getElementById('themeLabel');
  if (isDark) {
    moon.style.display = '';
    sun.style.display  = 'none';
    lbl.textContent    = 'Light';
  } else {
    moon.style.display = 'none';
    sun.style.display  = '';
    lbl.textContent    = 'Dark';
  }
  saveState();
}

function updateCounts(text) {
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  wordCountEl.textContent = words.toLocaleString() + ' word' + (words === 1 ? '' : 's');
  const n = text.length;
  charCountEl.textContent = n.toLocaleString() + ' char' + (n === 1 ? '' : 's');
  let open = 0, close = 0;
  for (const ch of text) {
    if (ch === '[') open++;
    else if (ch === ']') close++;
  }
  const balanced = open === close;
  bracketCountEl.textContent = '[' + open + ' / ]' + close;
  bracketCountEl.style.color = balanced || text.trim() === '' ? '' : 'var(--danger)';
}

function toggleHighlight() {
  highlightOn = !highlightOn;
  document.body.classList.toggle('no-highlight', !highlightOn);
  const btn = document.getElementById('highlightToggle');
  btn.classList.toggle('active', highlightOn);
}

// Count leading spaces in a string (tabs count as 1 for indent purposes here)
function leadingSpaces(str) {
  let n = 0;
  for (const ch of str) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
}

// ── Display layer ─────────────────────────────────────────────────────────────
// Renders text as a series of <div class="eline"> elements.
// Each div gets --line-indent set to the number of leading spaces (in ch units)
// so CSS can apply hanging indent on wrapped continuation lines.

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Tokenize the full text into depth-coloured spans.
// We walk char-by-char tracking bracket depth, accumulating runs of same-depth
// text and emitting a <span class="dN"> for each run. Brackets themselves are
// included in the span at their depth. Newlines are emitted as-is (not HTML
// special) so we can split the result on '\n' afterwards.
function tokenizeDepths(text) {
  let depth = 0;
  let out = '';
  let run = '';
  let runDepth = 0;

  function flushRun() {
    if (!run) return;
    const cls = runDepth > 0 ? ` class="d${Math.min(runDepth, 16)}"` : '';
    out += `<span${cls}>${escHtml(run)}</span>`;
    run = '';
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '[') {
      flushRun();
      depth++;
      // Opening bracket rendered at the new depth
      out += `<span class="d${Math.min(depth, 16)}">${escHtml(ch)}</span>`;
      runDepth = depth;
    } else if (ch === ']') {
      flushRun();
      // Closing bracket rendered at the depth it closes
      out += `<span class="d${Math.min(depth, 16)}">${escHtml(ch)}</span>`;
      depth = Math.max(0, depth - 1);
      runDepth = depth;
    } else if (ch === '\n') {
      // Newlines break runs so we can split per-line later
      flushRun();
      out += '\n';
      runDepth = depth;
    } else {
      if (depth !== runDepth) { flushRun(); runDepth = depth; }
      run += ch;
    }
  }
  flushRun();
  return out;
}

function renderDisplay(text, errMap) {
  const lines = text === '' ? [''] : text.split('\n');

  // Tokenize the whole text at once so depth carries across newlines,
  // then split on \n to get per-line HTML.
  const tokenized = tokenizeDepths(text);
  const lineHtmls = tokenized.split('\n');

  // Use inline <span> elements separated by literal newlines so the display
  // layer wraps identically to the textarea (no block-level gaps between lines).
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const hasErr = !!errMap[lineNum];
    const cls = 'eline' + (hasErr ? ' has-error' : '');
    const inner = lineHtmls[i] || '\u200B';
    if (i > 0) html += '\n';
    html += `<span class="${cls}" data-line="${lineNum}">${inner}</span>`;
  }
  editorDisplay.innerHTML = html;

  const stack = document.getElementById('editorStack');
  const displayH = editorDisplay.scrollHeight;
  const scrollH  = editorScroll.clientHeight;
  const targetH  = text.trim() === '' ? scrollH : Math.max(scrollH, displayH);
  // Set height (not just min-height) so the textarea's height:100% resolves correctly.
  // The textarea must be exactly as tall as the content so clicks map to the right lines.
  stack.style.height = targetH + 'px';
}
// ── Gutter ────────────────────────────────────────────────────────────────────
// We read the bounding rect of each .eline div to get the true rendered height,
// including any extra height from word-wrap. The gutter rows are then sized to match.

function renderGutter(errMap) {
  const lineSpans = Array.from(editorDisplay.querySelectorAll('.eline'));
  if (lineSpans.length === 0) { gutterInner.innerHTML = ''; return; }

  const containerTop = editorDisplay.getBoundingClientRect().top;

  // For each span, its gutter row height = (next span's top) - (this span's top).
  // For the last span, use its own bottom.
  const tops = lineSpans.map(s => s.getBoundingClientRect().top - containerTop);

  let html = '';
  lineSpans.forEach((span, idx) => {
    const lineNum = parseInt(span.dataset.line);
    const nextTop = idx + 1 < lineSpans.length
      ? tops[idx + 1]
      : span.getBoundingClientRect().bottom - containerTop;
    const h = Math.max(nextTop - tops[idx], 0);
    const errMsg = errMap[lineNum] ? escHtml(errMap[lineNum]) : '';
    html += `<div class="gutter-row" style="height:${h}px">` +
              `<div class="gutter-line">${lineNum}</div>` +
              (errMsg ? `<div class="gutter-error">⚠ ${errMsg}</div>` : '') +
            `</div>`;
  });
  gutterInner.innerHTML = html;
}

function buildErrMap(errors) {
  const m = {};
  for (const e of errors) m[e.line] = e.message;
  return m;
}

function fullRender(text, errors) {
  const errMap = buildErrMap(errors);
  renderDisplay(text, errMap);
  // Gutter reads layout from the display layer — must happen after display renders
  requestAnimationFrame(() => renderGutter(errMap));
}

// Sync gutter scroll with editor scroll
editorScroll.addEventListener('scroll', () => {
  gutterInner.style.marginTop = (-editorScroll.scrollTop) + 'px';
});

// On input: update display and gutter immediately
editor.addEventListener('input', () => {
  updateCounts(editor.value);
  fullRender(editor.value, []);
  saveState();
});

// Undo/redo (Ctrl+Z / Ctrl+Y) restores textarea value but doesn't fire 'input'.
// Catch it via beforeinput for historyUndo/historyRedo, and also via keydown
// as a fallback, re-rendering after the browser has applied the undo.
editor.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    // Value hasn't changed yet — re-render after the event resolves
    requestAnimationFrame(() => {
      currentErrors = [];
      updateCounts(editor.value);
      fullRender(editor.value, []);
    });
  }
});

// Belt-and-suspenders: also catch Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z via keydown
// in case beforeinput doesn't fire (e.g. some browsers/OS combos)
editor.addEventListener('keydown', (e) => {
  const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
  const isRedo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey));
  if (isUndo || isRedo) {
    // Run after the browser applies the history step
    setTimeout(() => {
      currentErrors = [];
      updateCounts(editor.value);
      fullRender(editor.value, []);
    }, 0);
  }
});

// Textarea is invisible but receives focus on click anywhere in scroll area
editorScroll.addEventListener('click', () => editor.focus());

function showStatus(msg, type) {
  // Briefly clear then re-show so the message visually updates even if text is same
  statusEl.className = 'status';
  requestAnimationFrame(() => {
    statusEl.textContent = msg;
    statusEl.className = 'status show ' + type;
  });
  clearTimeout(showStatus._timer);
  showStatus._timer = setTimeout(() => { statusEl.className = 'status'; }, 4000);
}

function runFormat() {
  const raw = editor.value;
  if (!raw.trim()) { showStatus('Nothing to format.', 'err'); return; }
  const normalized = raw.replace(/\r\n/g, '\n');
  const { result, errors } = processContent(raw);
  currentErrors = errors;
  if (errors.length > 0) {
    fullRender(raw, errors);
    showStatus(`${errors.length} error${errors.length > 1 ? 's' : ''} found — see annotations.`, 'err');
    return;
  }
  const changed = result !== normalized;
  editor.value = result;
  updateCounts(result);
  fullRender(result, []);
  saveState();
  showStatus(changed ? 'Formatted successfully.' : 'Already formatted — no changes needed.', changed ? 'ok' : 'ok');
}

function copyText() {
  const text = editor.value;
  if (!text.trim()) { showStatus('Nothing to copy.', 'err'); return; }
  navigator.clipboard.writeText(text).then(() => {
    showStatus('Copied to clipboard.', 'ok');
  }).catch(() => {
    showStatus('Copy failed — try selecting and using Ctrl+C.', 'err');
  });
}

function clearAll() {
  if (!editor.value.trim()) {
    editor.value = '';
    currentErrors = [];
    updateCounts('');
    statusEl.className = 'status';
    fullRender('', []);
    return;
  }
  showConfirm('Clear all text?', 'This cannot be undone.', () => {
    editor.value = '';
    currentErrors = [];
    updateCounts('');
    statusEl.className = 'status';
    fullRender('', []);
    saveState();
  });
}

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

// Re-render gutter on resize (line heights may change with new widths)
window.addEventListener('resize', () => {
  fullRender(editor.value, currentErrors);
});

// Initial render — restore saved state first
loadState();
updateCounts(editor.value);
fullRender(editor.value, []);
