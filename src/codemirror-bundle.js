export { EditorState } from '@codemirror/state';

export {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';

export {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';

export {
  indentUnit,
} from '@codemirror/language';

export {
  lintGutter,
  setDiagnostics,
} from '@codemirror/lint';

export {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  search,
  searchKeymap,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search';
