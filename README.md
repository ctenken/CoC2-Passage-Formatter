# Format Textify

This project builds its local CodeMirror browser bundle from npm packages.

## Build

```sh
npm install
npm run build
```

The build writes `dist/cm6-bundle.js`, which is imported by `CoC2-Passage-Formatter.js`.

Open `index.html` in a browser after building.
