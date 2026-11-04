# vue-webscreenshot

**WeChat-style screenshot for the browser** — a pure client-side screenshot & annotation component built with Vue 3. One click to capture, select, annotate, and copy to clipboard or download — everything happens locally in the browser, **no upload, no storage, zero backend**.

<p align="center">
  <a href="https://www.npmjs.com/package/@yswenli/vue-webscreenshot"><img src="https://img.shields.io/npm/v/@yswenli%2Fvue-webscreenshot" alt="npm version"></a>
  <a href="https://github.com/yswenli/vue-webscreenshot/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@yswenli%2Fvue-webscreenshot" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Vue-3.2+-42b883" alt="Vue 3.2+">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript">
  <a href="https://github.com/yswenli/vue-webscreenshot"><img src="https://img.shields.io/badge/GitHub-yswenli%2Fvue-webscreenshot-181717?logo=github" alt="GitHub"></a>
</p>

<p align="center">
  <strong>English</strong> ·
  <strong><a href="./README.md">简体中文</a></strong>
</p>

---

## Why this component?

Adding a "screenshot feedback" feature usually drags in a screenshot library, backend storage, and even a whole OSS pipeline. `vue-webscreenshot` cuts all of that out:

- **Zero backend**: `getDisplayMedia` capture + Canvas composition, all inside the user's browser — no network requests at all.
- **Plug & play**: a single `<WebScreenshot />` tag, controlled with `v-model:show`; three lines of code to integrate.
- **WeChat-screenshot experience**: six annotation tools — rectangle, ellipse, arrow, brush, mosaic and text — with thickness presets, a six-color palette and one-step undo.
- **Local & privacy-safe**: the captured image never leaves the browser, ideal for privacy-sensitive workflows (support tickets, bug reports, design walkthroughs).
- **Crisp & sharp**: rendered at device-pixel-ratio (DPR) resolution, so annotations stay clean at full quality.

> Great for: feedback / ticketing systems, bug reporting, test reports, live support, and collaborative docs — whenever you need to "draw a box around it and say what's wrong".

## Highlights

| Capability | Description |
| --- | --- |
| 🖱 Select & capture | Grab the full screen, drag to select, live pixel size readout |
| ✏️ Six annotations | Rectangle / Ellipse / Arrow / Brush / Mosaic / Text |
| 🎨 Fine control | Three thickness levels (shapes/brush) · six-color palette · mosaic block size |
| ⏪ Undo | `Ctrl / Cmd + Z` or the toolbar button — one step back |
| 📋 One-click copy | Writes to clipboard first, falls back to download when unsupported |
| 💾 Timestamped download | Auto-named files like `screenshot-20261104-153000.png` |
| 🧩 Low coupling | `Teleport` to body, configurable `z-index`, no host-layout pollution |
| 🔤 Smart text | Input box auto-grows, final text lands **exactly where it previews**, multi-line with wrap |
| 📐 Directional arrows | Preserves the drag direction — all eight directions point where you released |
| 📱 Responsive | Re-lays out on window resize; selection and annotations stay in place |

## Requirements

- **Chromium-based browsers only** (Chrome / Edge / 360 Speed mode); Firefox and Safari are not adapted.
- Must run in a **secure context**: `https` or `localhost` / `127.0.0.1`. Screenshot capture is disabled by the browser on `http` pages served over LAN IPs.
- The first trigger shows the system screen-share dialog, letting the user choose what to capture (this tab / window / entire screen). That is a browser mechanism, not a component defect.

## Install

```bash
npm install @yswenli/vue-webscreenshot --save
```

> The stylesheet is a separate artifact and **must be imported explicitly**, otherwise you get bare, unstyled controls:

```ts
import '@yswenli/vue-webscreenshot/css';
```

## Quick start

```vue
<template>
  <button @click="show = true">Take a screenshot</button>
  <WebScreenshot v-model:show="show" @success="onSuccess" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import WebScreenshot from '@yswenli/vue-webscreenshot';
import '@yswenli/vue-webscreenshot/css';

const show = ref(false);

function onSuccess(payload: { mode: 'clipboard' | 'download'; blob: Blob }) {
  // mode === 'clipboard': already written to clipboard, just Ctrl+V to paste
  // mode === 'download'  : the browser can't copy images, fell back to download
  console.log(payload.mode, payload.blob);
  show.value = false;
}
</script>
```

## API

### Props

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `show` | `boolean` | — | Set `true` to start capture and enter editing; the component emits `update:show` `false` when finished, so `v-model:show` works |
| `z-index` | `number` | `3000` | Overlay z-index; raise it if the host has higher-level overlays |
| `file-name` | `string` | `网页截图` | Download filename prefix, resulting in e.g. `网页截图-20261104-153000.png` |
| `capture-delay` | `number` | `1000` | Wait time (ms) after permission before grabbing the frame, to avoid a residual ghost of the closing share dialog |

### Events

| Name | Payload | Description |
| --- | --- | --- |
| `update:show` | `boolean` | Set to `false` when the component ends (done / cancelled / error) |
| `success` | `{ mode: 'clipboard' \| 'download'; blob: Blob }` | Clicked "Done". `mode` tells whether it actually wrote to clipboard or fell back to download |
| `download` | `{ blob: Blob }` | Clicked the toolbar "Download"; the tool stays open so you can keep editing |
| `cancel` | — | Clicked "Cancel", pressed `Esc`, or the user denied the screen-share permission |
| `error` | `{ stage: 'unsupported' \| 'capture' \| 'clipboard'; message: string }` | Environment unsupported, capture failed, or image composition failed |

### Shortcuts

| Action | Description |
| --- | --- |
| Drag | Select the screenshot region; drag inside the region to annotate after it's fixed |
| `Esc` | Close the text input if open; otherwise cancel and close |
| `Ctrl / Cmd + Z` | Undo the last annotation |
| `Enter` | Same as "Done"; while typing text, commits the text |
| `Shift + Enter` | New line while typing text — multi-line annotations supported |

### Usage notes

Toolbar: `Rectangle ｜ Ellipse ｜ Arrow ｜ Brush ｜ Mosaic ｜ Text ｜ Undo ｜ Download ｜ Cancel ｜ Done`. Selecting a drawing tool expands a secondary toolbar: shapes/brush get three thickness levels and a six-color palette, mosaic only gets block size, text only gets color. Default is red, 2px.

The text input box auto-grows with content; on commit, text lands according to the actual layout inside the box (including line breaks), exactly where you saw it — no shifting. Clicking elsewhere on the canvas, switching tools, undo / download / done all commit the in-progress text first.

## Known limitations

Kept transparent so you can judge whether it fits:

- No window/element auto-snapping, no magnifier, no color picker, no scrollable long screenshots.
- Annotations can't be re-edited (no select, drag, or individual delete) — only whole-undo.
- Annotations are clipped to the selection; text extending below the selection's bottom edge gets cut off.
- After a selection is fixed you can't drag its corners to resize — click "Cancel" and re-enter to reselect.
- The captured content is whatever the user authorized to share; it isn't guaranteed to equal the current page.

## Local development

```bash
npm install
npm run dev     # opens the demo page in index.html
npm run build   # vue-tsc type check + produce dist
```

## Contributing

Issues and pull requests are welcome via the [issue tracker](https://github.com/yswenli/vue-webscreenshot/issues) and [pull requests](https://github.com/yswenli/vue-webscreenshot/pulls). The codebase enforces strict TypeScript; please make sure `npm run build` passes before submitting.

## License

[MIT](./LICENSE) © yswenli
