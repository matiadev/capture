# Capture

A desktop app that turns a web page into an MP4 video or a full-page PNG. Paste a
URL, preview the real page, then render a smooth top-to-bottom scroll at your
chosen width, duration, and frame rate.

## How it works

Electron is the capture engine. The app loads the target page in an offscreen
`BrowserWindow`, scrolls it one frame at a time with an ease-in-out curve, and
pipes each screenshot straight into ffmpeg as H.264.

There is no second browser and no Playwright. Electron already ships Chromium,
including the proprietary codecs, so `<video>` content on the target page renders
correctly.

## Running it

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the Vite server and opens the Electron window against it.

To run the built app:

```sh
pnpm start
```

To build a Linux AppImage:

```sh
pnpm dist
```

Packaging for macOS or Windows would need their own `electron-builder` targets,
which this project does not define. The app itself runs anywhere Electron does.

If Electron fails to launch with a missing binary, run its installer directly:

```sh
node node_modules/electron/install.js
```

## Using it

1. Paste a URL into the address bar and press **Preview**. The real page loads
   in a live view.
2. Pick a viewport width, duration, frame rate, and theme in the bottom bar.
   Theme sets the page's colour preference (System, Light, Dark) and applies to
   both the preview and the capture.
3. Press **Capture MP4**. The button turns red and shows progress; click it again
   to cancel. For a still instead of a video, press **Save image**.
4. The result appears inline. Use **Save as** to copy it elsewhere.

Both formats are written to your platform's video folder: `~/Videos` on Linux,
`~/Movies` on macOS, and the Videos folder on Windows. Images capture the full
page, capped at 16000px tall.

## Logged-in sites

The preview and the capture engine share one browser session, so a login done in
the preview carries over to the capture.

1. Paste the URL and press **Preview**.
2. Log in inside the preview. Popups are allowed, so OAuth flows work.
3. Press **Capture MP4** or **Save image**.

The session lives in memory only, so it is dropped when you quit and nothing is
written to disk. Log in again after restarting the app.

## Notes and limits

- Full-page images are capped at 16000px tall, since Chromium cannot render a
  surface much larger than that.
- Fixed and sticky headers stay pinned to the viewport while scrolling.
- Cross-origin iframes cannot be captured.
- The page is reloaded before capture so entry animations replay, which adds
  about a second of preparation.
- `navigator.webdriver` is not set, but some sites may still treat an automated
  browser differently from a normal one.
- If `ffmpeg-static` is missing, the app falls back to `ffmpeg` on your `PATH`.

## Installing on Linux

```sh
pnpm app:install
```

Builds the AppImage if one is missing, copies it to `~/Applications/Capture.AppImage`,
and registers a desktop entry and icon so it shows up in your launcher.

To remove it:

```sh
./scripts/uninstall.sh
```

Unknown flags abort, and `--dry-run` prints what would be removed without
touching anything. The scripts have a shebang and are executable, so the `bash`
prefix is unnecessary. `pnpm app:install` and `pnpm app:uninstall` run the same
files.

That deletes the AppImage, the desktop entry, the icon, and `~/.config/Capture`.
It never touches your captures in the video folder.

## Using it over MCP

The packaged app doubles as an MCP server. With `--mcp` it skips the window and
speaks JSON-RPC over stdin/stdout instead:

```sh
~/Applications/Capture.AppImage --mcp
```

From a checkout the same thing runs as `npx electron . --mcp`.

Add it to an MCP client with that command. For opencode:

```jsonc
"mcp": {
  "servers": {
    "capture": {
      "type": "local",
      "command": ["~/Applications/Capture.AppImage", "--mcp"]
    }
  }
}
```

Two tools are exposed:

| Tool | Arguments | Returns |
|---|---|---|
| `capture_video` | `url`, `width?`, `duration?`, `fps?`, `theme?` | file path |
| `capture_image` | `url`, `width?`, `theme?` | file path plus a scaled preview |

The MCP server runs with its own user data directory (`~/.config/Capture-mcp`) so
it can run at the same time as the window without both fighting over the profile.
It still needs a display server, so on a headless machine run it under `xvfb-run`.

## Design tokens

All colours, spacing, radii, and type sizes live in `src/lib/theme.css`:

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#0a0a0a` | window background |
| `--color-surface` | `#141414` | bars, cards |
| `--color-surface-raised` | `#1e1e1e` | inputs, ghost buttons |
| `--color-text` | `#f0f0f0` | body text |
| `--color-text-muted` | `#7a7e94` | secondary text |
| `--color-accent` | `#ffd54f` | buttons, focus, slider, progress |
| `--color-on-accent` | `#0a0a0a` | text on accent surfaces |
| `--color-danger` | `#e06b7b` | errors and the cancelling state |
| `--color-success` | `#7ec699` | the saved state |

Spacing, radii, type sizes, shadows, and transitions use the same file. The only
raw colours left in components are the page's own white background and the
video's black.

## Layout

```
electron/main.ts          entry point, picks the GUI or the MCP server
electron/gui.ts           window, IPC, app:// and capture:// protocols
electron/mcp.ts           MCP server over stdio
electron/api.ts           shared capture entry point
electron/capture.ts       page loading, frame loop, ffmpeg encoding
electron/preload.cjs      the bridge exposed to the UI as window.api
electron/tsconfig.json    type checking for the main process
src/routes/+page.svelte   the interface
src/lib/theme.css         design tokens
src/lib/types.ts          shared types
scripts/install.sh        build, install, register the desktop entry
scripts/uninstall.sh      remove the app and its data
assets/icon.svg           app icon source
```

The main process is TypeScript, run directly by Electron with no build step.
`preload.cjs` is the exception: Electron's preload loader does not strip types.
