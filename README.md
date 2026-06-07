# CoC2 Parser Formatter

A browser-based formatter and compressor for CoC2 parser syntax, using a CodeMirror 6 editor.

## Features

- **Format** — expands and indents bracket structures (`[]` and `{}`) for readability
- **Compress** — collapses formatted syntax
- **Bracket depth highlighting** — 32 colors indicate nesting depth at a glance
- **Find & Replace** — literal search with case, and regex options, replace with replace and replace all options
- **Word / char / bracket counts** — live counts with unbalanced bracket warnings
- **Indent style toggle** — spaces, tabs, or none
- **Font size control** — adjustable editor font size
- **Light & dark theme**

## Build

Requires [Node.js](https://nodejs.org/).

```sh
npm install
npm run build
```

The build writes `dist/cm6-bundle.js`, which is imported by `CoC2-Parser-Formatter.js`.

## Usage

Open `index.html` using a web server after building.
