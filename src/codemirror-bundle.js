export { EditorState } from '@codemirror/state';

export {
  Decoration, drawSelection, EditorView, highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder, ViewPlugin
} from '@codemirror/view';

export {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands';

export {
  indentUnit
} from '@codemirror/language';

export {
  lintGutter,
  setDiagnostics
} from '@codemirror/lint';

export {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext, search,
  searchKeymap, SearchQuery, selectMatches,
  setSearchQuery
} from '@codemirror/search';

export { indentationMarkers } from '@replit/codemirror-indentation-markers';
