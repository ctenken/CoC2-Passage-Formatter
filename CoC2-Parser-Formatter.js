import {
  closeSearchPanel,
  indentUnit as codeMirrorIndentUnit,
  Decoration,
  defaultKeymap,
  drawSelection,
  EditorState,
  EditorView,
  findNext,
  findPrevious,
  getSearchQuery,
  highlightActiveLine, highlightActiveLineGutter,
  history,
  historyKeymap,
  indentationMarkers,
  indentWithTab,
  keymap,
  lineNumbers,
  lintGutter,
  placeholder,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setDiagnostics,
  setSearchQuery,
  ViewPlugin
} from './dist/cm6-bundle.js';

// ─── Formatter core (unchanged) ───────────────────────────────────────────────

let indentUnit = '    ';
let curlyFormatOn = true;
function isWhitespace(ch) { return ch === ' ' || ch === '\t' || ch === '\r'; }

const squarePair = { open: '[', close: ']' };
const curlyPair = { open: '{', close: '}' };

function enabledPairs() {
  return curlyFormatOn ? [squarePair, curlyPair] : [squarePair];
}

function openingPair(ch) {
  return enabledPairs().find(pair => pair.open === ch);
}

function closingPair(ch) {
  return enabledPairs().find(pair => pair.close === ch);
}

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
    const pair = openingPair(ch);
    if (pair) {
      const { formatted, endIndex, line: newLine } = processBracket(inner, i, baseIndent, line, pair);
      result += formatted; i = endIndex + 1; line = newLine;
    } else if (closingPair(ch)) {
      throw new Error(`Unmatched '${ch}' at line ${line}`);
    } else { result += ch; i++; }
  }
  return { result, line };
}

function processBracket(str, startIndex, bracketIndent, startLine, pair) {
  const openLine = startLine;
  let i = startIndex + 1, depth = 1, content = '', line = startLine;
  while (i < str.length && depth > 0) {
    const ch = str[i];
    if (ch === pair.open) depth++;
    else if (ch === pair.close) depth--;
    if (depth > 0) { content += ch; if (ch === '\n') line++; }
    else if (ch === '\n') line++;
    i++;
  }
  if (depth !== 0) throw new Error(`Unmatched '${pair.open}' at line ${openLine}`);
  const endIndex = i - 1;
  if (!hasTopLevelPipe(content)) {
    const { result: inner, line: newLine } = formatChoiceContent(content, bracketIndent, openLine);
    return { formatted: pair.open + inner + pair.close, endIndex, line: newLine };
  }
  const parts = splitOnTopLevelPipes(content);
  const qualifier = parts[0].trim();
  const choices = parts.slice(1);
  const innerIndent = bracketIndent + indentUnit;
  let formatted = pair.open + qualifier + '\n';
  let choiceLine = openLine;
  for (const choice of choices) {
    const { result: body, line: afterLine } = formatChoiceContent(choice, innerIndent, choiceLine);
    choiceLine = afterLine;
    formatted += innerIndent + '|' + body.replace(/\n$/, '') + '\n';
  }
  formatted += bracketIndent + pair.close;
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
    const pair = openingPair(ch);
    if (pair) {
      const { formatted, endIndex, line: newLine } = processBracket(content, i, knownIndent, line, pair);
      result += formatted; i = endIndex + 1; line = newLine;
    } else if (closingPair(ch)) {
      throw new Error(`Unmatched '${ch}' at line ${line}`);
    } else { result += ch; i++; }
  }
  return { result, line };
}

function hasTopLevelPipe(str) {
  const stack = [];
  for (const ch of str) {
    const opener = openingPair(ch);
    const closer = closingPair(ch);
    if (opener) stack.push(opener.close);
    else if (closer && stack[stack.length - 1] === ch) stack.pop();
    else if (ch === '|' && stack.length === 0) return true;
  }
  return false;
}

function splitOnTopLevelPipes(str) {
  const parts = []; const stack = []; let current = '';
  for (const ch of str) {
    const opener = openingPair(ch);
    const closer = closingPair(ch);
    if (opener) { stack.push(opener.close); current += ch; }
    else if (closer && stack[stack.length - 1] === ch) { stack.pop(); current += ch; }
    else if (ch === '|' && stack.length === 0) { parts.push(current); current = ''; }
    else current += ch;
  }
  parts.push(current);
  return parts;
}

// function findTopLevelPipes(str, offsetLine) {
//   const errors = [];
//   const stack = [];
//   let line = offsetLine;
//   for (let i = 0; i < str.length; i++) {
//     const ch = str[i];
//     if (ch === '\n') { line++; continue; }
//     const opener = openingPair(ch);
//     const closer = closingPair(ch);
//     if (opener) stack.push(opener.close);
//     else if (closer && stack[stack.length - 1] === ch) stack.pop();
//     else if (ch === '|' && stack.length === 0) {
//       errors.push({ line, message: "Pipe character '|' outside of brackets" });
//     }
//   }
//   return errors;
// }

function compactWhitespace(text) {
  return text
    .replace(/^[ \t]+/, '')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function compressTextify(inner, startLine, compactResult = false) {
  let result = '', i = 0, line = startLine;
  while (i < inner.length) {
    const ch = inner[i];
    const pair = openingPair(ch);
    if (pair) {
      const { formatted, endIndex, line: newLine } = compressBracket(inner, i, line, pair);
      result += formatted; i = endIndex + 1; line = newLine;
    } else if (closingPair(ch)) {
      throw new Error(`Unmatched '${ch}' at line ${line}`);
    } else {
      result += ch;
      if (ch === '\n') line++;
      i++;
    }
  }
  return { result: compactResult ? compactWhitespace(result) : result, line };
}

function compressBracket(str, startIndex, startLine, pair) {
  const openLine = startLine;
  let i = startIndex + 1, depth = 1, content = '', line = startLine;
  while (i < str.length && depth > 0) {
    const ch = str[i];
    if (ch === pair.open) depth++;
    else if (ch === pair.close) depth--;
    if (depth > 0) { content += ch; if (ch === '\n') line++; }
    else if (ch === '\n') line++;
    i++;
  }
  if (depth !== 0) throw new Error(`Unmatched '${pair.open}' at line ${openLine}`);
  const endIndex = i - 1;
  const parts = splitOnTopLevelPipes(content);
  const compressed = parts.map((part, idx) => {
    // Compress without compacting first, then compact carefully.
    // Only strip leading whitespace from the qualifier (first part);
    // for other parts, leading whitespace is content after a pipe.
    const raw = compressTextify(part, openLine, false).result;
    let compacted = raw.replace(/\n[ \t]*/g, '\n');
    if (idx === 0) compacted = compacted.replace(/^[ \t]+/, '');
    return compacted;
  });
  
  const inner = compressed.map((p, idx) => {
    let s = idx === 0 ? p.replace(/^\n/, '') : p;
    // strip ALL trailing whitespace (spaces, tabs, newlines) before the first pipe.
    if (idx === 0 && compressed.length > 1) {
      return s.replace(/\s+$/, '');
    }
    // Only strip the newline if it is a single formatting newline. 
    // This preserves both intentional trailing spaces and multiple newlines.
    if (s.endsWith('\n') && !s.endsWith('\n\n')) {
      return s.slice(0, -1);
    }
    return s;
  }).join('|');
  
  return { formatted: pair.open + inner + pair.close, endIndex, line };
}

function processContent(content) {
  content = content.replace(/\r\n/g, '\n');
  // const errors = [...findTopLevelPipes(content, 1)];
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

function compressContent(content) {
  content = content.replace(/\r\n/g, '\n');
  // const errors = [...findTopLevelPipes(content, 1)];
  const errors = [];
  if (!/textify`/.test(content)) {
    try {
      const { result } = compressTextify(content, 1);
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
        const { result: compressed } = compressTextify(seg.text, segLine);
        result += compressed;
      } catch (err) {
        const m = err.message.match(/line (\d+)/);
        errors.push({ line: m ? parseInt(m[1]) : segLine, message: err.message });
        result += seg.text;
      }
    } else {
      const [full, leadingIndent, prefix, inner] = seg.match;
      const blockLine = content.slice(0, seg.offset).split('\n').length;
      try {
        const { result: compressed } = compressTextify(inner, blockLine);
        result += `${leadingIndent}${prefix}textify\`${compressed}\``;
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
  const stack = [];
  let runStart = 0, runDepth = 0;

  function flush(end) {
    if (runStart >= end || runDepth === 0) { runStart = end; return; }
    marks.push(Decoration.mark({ class: `bd${Math.min(runDepth, 32)}` }).range(runStart, end));
    runStart = end;
  }

  // Advance position past any leading whitespace on a line
  function skipIndent(pos) {
    while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) pos++;
    return pos;
  }

  const text = doc.toString();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const opener = openingPair(ch);
    const closer = closingPair(ch);
    if (opener) {
      flush(i);
      stack.push(opener.close);
      marks.push(Decoration.mark({ class: `bd${Math.min(stack.length, 32)}` }).range(i, i + 1));
      runStart = i + 1; runDepth = stack.length;
    } else if (closer) {
      flush(i);
      marks.push(Decoration.mark({ class: `bd${Math.min(stack.length, 32)}` }).range(i, i + 1));
      if (stack[stack.length - 1] === ch) stack.pop();
      runStart = i + 1; runDepth = stack.length;
    } else if (ch === '\n') {
      flush(i);
      // Skip the indentation on the next line so the indent markers
      // (vertical guide lines) are not covered by the depth highlight.
      runStart = skipIndent(i + 1);
      i = runStart - 1; // -1 because the for-loop will i++
    }
  }
  flush(text.length);
  // marks must be sorted; they already are since we iterate left-to-right
  return Decoration.set(marks, true);
}

const depthPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.highlightOn = !document.body.classList.contains('no-highlight');
    this.curlyFormatOn = curlyFormatOn;
    this.decorations = this._build(view);
  }
  update(update) {
    const highlightOn = !document.body.classList.contains('no-highlight');
    if (update.docChanged || update.viewportChanged || highlightOn !== this.highlightOn || curlyFormatOn !== this.curlyFormatOn) {
      this.highlightOn = highlightOn;
      this.curlyFormatOn = curlyFormatOn;
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
const MAX_WRAP_INDENT = 400;

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
            style: `
              padding-left:calc(${indent}ch + 0.38rem);
              text-indent:-${indent}ch;
            `,
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

// ─── Search match highlight plugin ───────────────────────────────────────────

const searchMatchDeco = Decoration.mark({ class: 'cm-search-match-all', inclusive: false });

const searchMatchPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this._build(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.transactions.some(tr => tr.effects.length))
      this.decorations = this._build(update.view);
  }
  _build(view) {
    const query = getSearchQuery(view.state);
    if (!query.search) return Decoration.none;
    const sel = view.state.selection.main;
    const marks = [];
    try {
      const cursor = query.getCursor(view.state);
      while (!cursor.next().done) {
        const { from, to } = cursor.value;
        // Skip the currently selected match so the selection highlight shows through
        if (from === sel.from && to === sel.to) continue;
        marks.push(searchMatchDeco.range(from, to));
      }
    } catch (_) { return Decoration.none; }
    return Decoration.set(marks, true);
  }
}, { decorations: v => v.decorations });

let trailingSpacesOn = false;

const trailingSpacePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this._build(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged || trailingSpacesOn !== this._lastOn)
      this.decorations = this._build(update.view);
  }
  _build(view) {
    this._lastOn = trailingSpacesOn;
    if (!trailingSpacesOn) return Decoration.none;
    const marks = [];
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        const text = line.text;
        const match = text.match(/[ \t]+$/);
        if (match) {
          const start = line.from + text.length - match[0].length;
          marks.push(Decoration.mark({ class: 'cm-trailing-space' }).range(start, line.to));
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(marks, true);
  }
}, { decorations: v => v.decorations });

window.toggleTrailingSpaces = function () {
  trailingSpacesOn = !trailingSpacesOn;
  document.getElementById('trailingSpaceToggle').classList.toggle('active', trailingSpacesOn);
  view.dispatch({});
  saveState();
};

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
    search({ createPanel: () => ({ dom: document.createElement('div'), mount() {}, destroy() {} }) }),
    placeholder('Paste your text here and click Format.'),
    wrapIndentPlugin,
    indentationMarkers({
      highlightActiveBlock: true,
      hideFirstIndent: false,
      markerType: 'fullScope',
      thickness: 1,
      colors: {
        light: 'var(--indent-marker)',
        dark:  'var(--indent-marker)',
        activeLight: 'var(--indent-marker-active)',
        activeDark:  'var(--indent-marker-active)',
      },
    }),
    depthPlugin,
    selectedTextPlugin,
    searchMatchPlugin,
    trailingSpacePlugin,
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
const curlyCountEl   = document.getElementById('curlyCount');
const bracketWarnEl  = document.getElementById('bracketWarn');

function updateCounts(text) {
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  wordCountEl.textContent = words.toLocaleString() + ' word' + (words === 1 ? '' : 's');
  const n = text.length;
  charCountEl.textContent = n.toLocaleString() + ' char' + (n === 1 ? '' : 's');
  let open = 0, close = 0;
  let curlyOpen = 0, curlyClose = 0;
  for (const ch of text) {
    if (ch === '[') open++;
    else if (ch === ']') close++;
    else if (ch === '{') curlyOpen++;
    else if (ch === '}') curlyClose++;
  }
  const squareBalanced = open === close;
  const curlyBalanced = curlyOpen === curlyClose;
  const balanced = squareBalanced && (!curlyFormatOn || curlyBalanced);
  bracketCountEl.textContent = '[' + open + ' / ]' + close;
  bracketCountEl.style.color = squareBalanced || text.trim() === '' ? '' : 'var(--danger)';
  curlyCountEl.textContent = '{' + curlyOpen + ' / }' + curlyClose;
  curlyCountEl.style.display = curlyFormatOn ? '' : 'none';
  curlyCountEl.style.color = curlyBalanced || text.trim() === '' ? '' : 'var(--danger)';
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

function errorLineSummary(errors) {
  const lines = [...new Set(errors.map(err => err.line).filter(Number.isFinite))].sort((a, b) => a - b);
  if (lines.length === 0) return '';
  return lines.length === 1 ? ` on line ${lines[0]}` : ` on lines ${lines.join(', ')}`;
}

// ─── Toolbar actions (exposed to window for onclick= attributes) ───────────────

window.runFormat = function () {
  const text = view.state.doc.toString();
  if (!text.trim()) { showStatus('Nothing to format.', 'err'); return; }
  const { result, errors } = processContent(text);
  if (errors.length > 0) {
    applyErrors(errors);
    showStatus(`${errors.length} error${errors.length > 1 ? 's' : ''} found${errorLineSummary(errors)} — see annotations.`, 'err');
    return;
  }
  clearErrors();
  const normalized = text.replace(/\r\n/g, '\n');
  const changed = result !== normalized;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result } });
  saveState();
  showStatus(changed ? 'Formatted successfully.' : 'Already formatted — no changes needed.', 'ok');
};

window.runCompress = function () {
  const text = view.state.doc.toString();
  if (!text.trim()) { showStatus('Nothing to compress.', 'err'); return; }
  const { result, errors } = compressContent(text);
  if (errors.length > 0) {
    applyErrors(errors);
    showStatus(`${errors.length} error${errors.length > 1 ? 's' : ''} found${errorLineSummary(errors)} — see annotations.`, 'err');
    return;
  }
  clearErrors();
  const normalized = text.replace(/\r\n/g, '\n');
  const changed = result !== normalized;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result } });
  saveState();
  showStatus(changed ? 'Compressed successfully.' : 'Already compressed — no changes needed.', 'ok');
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

function updateCurlyToggle() {
  document.getElementById('curlyToggle').classList.toggle('active', curlyFormatOn);
  updateCounts(view.state.doc.toString());
  view.dispatch({});
}

window.toggleCurlyFormatting = function () {
  curlyFormatOn = !curlyFormatOn;
  updateCurlyToggle();
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
    localStorage.setItem('fmtTextify_curlyFormat', curlyFormatOn ? 'on' : 'off');
    localStorage.setItem('fmtTextify_fontSize', `${editorFontSize}px`);
    localStorage.setItem('fmtTextify_trailingSpaces', trailingSpacesOn ? 'on' : 'off');
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
    const savedCurlyFormat = localStorage.getItem('fmtTextify_curlyFormat');
    curlyFormatOn = savedCurlyFormat !== 'off';
    updateCurlyToggle();
    const savedHighlight = localStorage.getItem('fmtTextify_highlight');
    highlightOn = savedHighlight !== 'off';
    document.body.classList.toggle('no-highlight', !highlightOn);
    document.getElementById('highlightToggle').classList.toggle('active', highlightOn);
    view.dispatch({});
    const savedTrailingSpaces = localStorage.getItem('fmtTextify_trailingSpaces');
    trailingSpacesOn = savedTrailingSpaces === 'on';
    document.getElementById('trailingSpaceToggle').classList.toggle('active', trailingSpacesOn);
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

// ─── Search Panel ─────────────────────────────────────────────────────────────

let searchPanelOpen = false;
let searchReplaceVisible = false;

const searchPanel  = document.getElementById('searchPanel');
const searchInput  = document.getElementById('searchInput');
const replaceInput = document.getElementById('replaceInput');
const searchCount  = document.getElementById('searchCount');
const searchReplaceRow = document.getElementById('searchReplaceRow');
const searchToggleReplace = document.getElementById('searchToggleReplace');

function updateSearchCount() {
  const query = getSearchQuery(view.state);
  if (!query.search) {
    searchCount.textContent = '0/0';
    searchCount.classList.add('zero');
    return;
  }
  let total = 0;
  let cursor = query.getCursor(view.state);
  while (!cursor.next().done) {
    total++;
  }
  // Find current match index
  let current = 0;
  const sel = view.state.selection.main;
  if (!sel.empty) {
    let idx = 0;
    cursor = query.getCursor(view.state);
    while (!cursor.next().done) {
      idx++;
      // @ts-ignore - cursor.value has from/to
      const { from, to } = cursor.value;
      if (from <= sel.from && to >= sel.to) { current = idx; break; }
    }
  }
  if (total === 0) {
    searchCount.textContent = '0/0';
    searchCount.classList.add('zero');
  } else if (current === 0) {
    searchCount.textContent = `/${total}`;
    searchCount.classList.remove('zero');
  } else {
    searchCount.textContent = `${current}/${total}`;
    searchCount.classList.remove('zero');
  }
}

let searchCaseSensitive = false;
let searchUseRegex = false;

window.toggleSearchCase = function () {
  searchCaseSensitive = !searchCaseSensitive;
  document.getElementById('searchCaseBtn').classList.toggle('active', searchCaseSensitive);
  applySearchQuery(true);
};

window.toggleSearchRegex = function () {
  searchUseRegex = !searchUseRegex;
  document.getElementById('searchRegexBtn').classList.toggle('active', searchUseRegex);
  applySearchQuery(true);
};



function applySearchQuery(preservePos = false) {
  const searchTerm = searchInput.value;
  const replaceTerm = replaceInput.value;
  let query;
  try {
    query = new SearchQuery({
      search: searchTerm,
      replace: replaceTerm,
      caseSensitive: searchCaseSensitive,
      regexp: searchUseRegex,
      wholeWord: false,
      literal: true,
    });
  } catch (e) {
    updateSearchCount();
    return;
  }
  view.dispatch({ effects: setSearchQuery.of(query) });
  if (searchTerm && !preservePos) {
    findNext(view);
  }
  updateSearchCount();
}

window.toggleSearch = function () {
  if (searchPanelOpen) {
    closeSearch();
    return;
  }
  searchPanel.style.display = 'flex';
  searchPanelOpen = true;
  document.getElementById('searchToggle').classList.add('active');
  searchInput.focus();
  searchInput.select();
  applySearchQuery();
};

window.closeSearch = function () {
  searchPanel.style.display = 'none';
  searchPanelOpen = false;
  document.getElementById('searchToggle').classList.remove('active');
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
  closeSearchPanel(view);
};

window.toggleSearchReplace = function () {
  searchReplaceVisible = !searchReplaceVisible;
  searchReplaceRow.classList.toggle('visible', searchReplaceVisible);
  const icon = document.getElementById('searchToggleReplaceIcon');
  if (searchReplaceVisible) {
    searchToggleReplace.classList.add('active');
    if (icon) icon.innerHTML = '&#8897;';
    setTimeout(() => replaceInput.focus(), 0);
  } else {
    searchToggleReplace.classList.remove('active');
    if (icon) icon.innerHTML = '&#x276F;';
  }
};

window.applySearchQuery = applySearchQuery;

window.onSearchInput = function () {
  applySearchQuery();
};

window.onSearchKeyDown = function (e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) { findPrevious(view); }
    else { findNext(view); }
    updateSearchCount();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  } else if (e.key === 'Tab' && searchReplaceVisible) {
    e.preventDefault();
    replaceInput.focus();
  }
};

window.onReplaceKeyDown = function (e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    replaceOne();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
};

window.searchNext = function () {
  findNext(view);
  updateSearchCount();
};

window.searchPrev = function () {
  findPrevious(view);
  updateSearchCount();
};

window.replaceOne = function () {
  applySearchQuery(true);
  replaceNext(view);
  findNext(view);
  updateSearchCount();
};

window.replaceAll = function () {
  applySearchQuery(true);
  replaceAll(view);
  updateSearchCount();
};

// Keyboard shortcuts: Ctrl+F, Ctrl+H, F3, Shift+F3
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    if (searchPanelOpen) {
      searchInput.focus();
      searchInput.select();
    } else {
      toggleSearch();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
    e.preventDefault();
    if (!searchPanelOpen) {
      toggleSearch();
      toggleSearchReplace();
    } else if (!searchReplaceVisible) {
      toggleSearchReplace();
    } else {
      replaceInput.focus();
    }
  } else if (e.key === 'F3') {
    e.preventDefault();
    if (!searchPanelOpen) toggleSearch();
    if (e.shiftKey) { findPrevious(view); searchPrev(); }
    else { findNext(view); searchNext(); }
    updateSearchCount();
  } else if (e.altKey && e.key === 'c' && searchPanelOpen) {
    e.preventDefault();
    toggleSearchCase();
  } else if (e.altKey && e.key === 'r' && searchPanelOpen) {
    e.preventDefault();
    toggleSearchRegex();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadState();