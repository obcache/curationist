# OBS Studio Plugins Forum — Resource Submission Copy

Ready-to-use copy for submitting **Curationist** to the [OBS Project Resources — OBS Studio Plugins](https://obsproject.com/forum/resources/categories/obs-studio-plugins.6/) forum (XenForo).

---

## Resource Submission Form Fields

- **Category:** `OBS Studio Plugins`
- **Title:** `Curationist — Native Audio, Video & projectM Visualizer Sources + Live Control Studio`
- **Tag Line (≤ 100 chars):** `Native OBS 33+ audio, video & MilkDrop/projectM visualizer sources with a live desktop control deck.`
- **Version Number:** `1.2.4`
- **Supported Operating Systems:** `Windows` *(Windows 11 64-bit, Build 22000+)*
- **Supported OBS Studio Version:** `33.0+`
- **External Download URL:** `https://github.com/obcache/curationist/releases`
- **Source Code URL:** `https://github.com/obcache/curationist`
- **Additional Information / Website URL:** `https://sorryneedboost.com`

### Screenshots to Upload & Attach
Upload these four files from `docs/screenshots/` to the forum post and insert them where marked `[INSERT SCREENSHOT ...]` below:
1. `docs/screenshots/curationist-obs-live.jpg` — *Hero image (also set as the Resource Icon / Cover or first inline screenshot)*
2. `docs/screenshots/milklab-preset-ide.jpg` — *Bundled milkLab Preset IDE (visual node workflow editor + live projectM preview)*
3. `docs/screenshots/setup-wizard-step1-plugin.jpg` — *Setup Wizard Step 1: Native OBS Plugin installer*
4. `docs/screenshots/setup-wizard-step2-websocket.jpg` — *Setup Wizard Step 2: OBS WebSocket & Auto-Connect*

---

## Overview Description (XenForo BBCode — Copy & Paste Ready)

```bbcode
[B][SIZE=5]Curationist — Native Audio, Video & projectM / MilkDrop Visualizer Suite for OBS Studio 33+[/SIZE][/B]

[B]Curationist[/B] combines a native C++ OBS Studio plugin bundle (adding three dedicated scene sources directly inside OBS) with a fast, local-first desktop curation studio and real-time OBS WebSocket v5 live control deck.

Manage thousands of audio tracks, video loops, and MilkDrop ([ICODE].milk[/ICODE]) GPU shader presets in one workspace—then publish queues atomically and drive all three OBS sources live without browser sources, virtual audio cables, or fragile external players.

[INSERT SCREENSHOT 1: curationist-obs-live.jpg]

[HR][/HR]

[B][SIZE=4]Three Native C++ OBS Scene Sources[/SIZE][/B]

Installing the bundled plugin (one click from the in-app Setup Wizard into [ICODE]%ProgramData%\obs-studio\plugins\milkyway[/ICODE]) adds three native sources to OBS Studio:

[LIST]
[*][B]Curationist Audio[/B] — Native playlist player ([ICODE]MP3, FLAC, WAV, M4A, AIFF, OGG, OPUS, AAC, WMA[/ICODE]) with embedded album-art GPU shader effects (Brightness, Contrast, Saturation, Glow Size/Intensity/Color, Vignette Strength/Roundness, Audio Bounce, Camera Shake), Loop, Shuffle, and configurable [B]-15s to +15s Crossfade / Auto-Fade[/B] (overlap crossfade on positive values, sequential fade-out → fade-in on negative values).
[*][B]Curationist Video[/B] — Zero-copy video playlist player ([ICODE]MP4, MKV, WEBM, MOV, AVI, M4V[/ICODE]) with [B]-15s to +15s GPU Cross-Dissolve / Auto-Fade[/B], Loop, Shuffle, and [B]Advance on Song Change[/B] sync with Curationist Audio.
[*][B]Curationist Visualizer[/B] — Real-time GPU-accelerated [B]projectM v4 / MilkDrop[/B] shader visualizer driven by any OBS audio source or scene mix (or internal time-driven mode). Supports up to 1920×1080 at 10–60 FPS, configurable soft-cut transitions (0–30,000 ms), preset hold timing, Auto-Advance, Loop, Shuffle, and [B]Advance on Song Change[/B].
[/LIST]

[HR][/HR]

[B][SIZE=4]Desktop Curation Studio & Live Broadcast Control[/SIZE][/B]

[LIST]
[*][B]Audio, Video & Visualizer Workspaces[/B] — Dense, dockable VS Code-styled interface backed by local SQLite. Organize multiple logical libraries, filter by recursive folder tree or 5-star ratings, batch-edit ID3 tags/cover art/synced lyrics, and stage playlists with Play Now, Play Next, Append, or Publish.
[*][B]Automatic .milk Preset Validator & Repair + Built-In Preview[/B] — Validates and automatically repairs common MilkDrop shader compatibility issues for projectM v4 on import, with a live embedded projectM v4 preview panel.
[*][B]Bundled milkLab Preset IDE[/B] — Create new [ICODE].milk[/ICODE] presets ([ICODE]Ctrl+N[/ICODE]) or edit existing presets ([ICODE]Ctrl+E[/ICODE]) using either the visual node-based Workflow editor (wave generator + composable motion, color & echo effect blocks) or the Source code editor, with real-time projectM preview, equation linting, and instant sync back into your Curationist library.
[*][B]Universal Control Surface & Master OB Toggle[/B] — Persistent transport bar with Audio shuttle, live Video preview, and live projectM preview. Flip individual [B]OB[/B] remote toggles (or the 3-position [B]Master OB Toggle[/B]) to switch cleanly between local auditioning and live OBS WebSocket control.
[*][B]Performance Mode & Detachable Popouts[/B] — Expand into a distraction-free fullscreen live command deck or pop out the control surface / individual monitors onto a second display without interrupting playback.
[*][B]Persistent OBS WebSocket v5 Connection[/B] — Automatically connects on startup, polls every 3 seconds to stay connected, and self-heals source bindings if you recreate a source in OBS.
[/LIST]

[INSERT SCREENSHOT 2: milklab-preset-ide.jpg]

[HR][/HR]

[B][SIZE=4]Guided 2-Step Installation & Setup[/SIZE][/B]

[LIST=1]
[*]Download and run [B]Curationist-1.2.4-win11-x64.exe[/B] from GitHub Releases.
[*]Launch Curationist and follow [B]Step 1[/B] of the Welcome & OBS Integration Setup Wizard to install the native C++ plugin bundle into OBS Studio, then restart OBS.
[*]In OBS Studio, open [B]Tools → WebSocket Server Settings[/B], enable the WebSocket Server (default port [ICODE]4455[/ICODE]), and copy your Server Password into [B]Step 2[/B] of the wizard.
[*]Add [B]Curationist Audio[/B], [B]Curationist Video[/B], and/or [B]Curationist Visualizer[/B] to your OBS scene, choose your audio driver in the Visualizer settings, publish a playlist, and flip [B]OB[/B] to ON!
[/LIST]

[INSERT SCREENSHOT 3: setup-wizard-step1-plugin.jpg]
[INSERT SCREENSHOT 4: setup-wizard-step2-websocket.jpg]

[HR][/HR]

[B][SIZE=4]Requirements[/SIZE][/B]

[LIST]
[*][B]OS:[/B] Windows 11 64-bit (Build 22000 or newer, x64)
[*][B]OBS Studio:[/B] OBS Studio 33.0 or newer (64-bit) with built-in WebSocket Server v5 enabled
[*][B]GPU:[/B] DirectX 11 / OpenGL-capable GPU for cover-art shaders and projectM rendering
[/LIST]

[HR][/HR]

[B][SIZE=4]Open-Source & Licensing Disclosure[/SIZE][/B]

The native OBS plugin ([ICODE]milkyway.dll[/ICODE] / [ICODE]milkyway-projectm.dll[/ICODE]) uses the OBS Studio Host API (GPL-2.0+), the separately replaceable [B]projectM v4[/B] shared library (LGPL-2.1), OBS media-playback components (ISC), and [ICODE]projectm-eval[/ICODE] / [ICODE]HLSLParser[/ICODE] (MIT). OBS and FFmpeg runtime DLLs are supplied by the user's installed OBS Studio distribution and are not bundled. Full license texts and notices are included in [ICODE]vendor/obs-plugin/licenses/[/ICODE].

Built by [URL='https://sorryneedboost.com']sorryneedboost.com[/URL] • Source & Releases: [URL='https://github.com/obcache/curationist']GitHub[/URL]
```

---

## Resource Update / Changelog Post Copy (v1.2.4)

Use this when posting an update in the OBS Resource **Updates** tab:

```bbcode
[B]Curationist v1.2.4[/B]

[B]Highlights in v1.2.x / v1.2.4:[/B]
[LIST]
[*][B]Welcome & OBS Integration Setup Wizard:[/B] Guided 2-step first-run wizard for one-click native OBS plugin installation/updates and OBS WebSocket v5 configuration.
[*][B]Native Curationist Video Source & Video Studio Workspace:[/B] Zero-copy MP4/MKV/WEBM/MOV/AVI/M4V video playlist playback with GPU cross-dissolve / auto-fade (-15s to +15s) and Advance on Song Change sync.
[*][B]Audio Crossfade & Auto-Fade (-15s to +15s):[/B] Support for both overlapping crossfades (+1s to +15s) and sequential fade-out → fade-in (-1s to -15s) on Curationist Audio.
[*][B]Universal Control Surface, Master OB Toggle & Performance Mode:[/B] Unified bottom transport deck for Audio, Video, and Visualizer with 3-position Master OB Toggle, detachable popout windows, and fullscreen Performance Mode.
[*][B]Bundled milkLab Preset IDE:[/B] Author and edit MilkDrop [ICODE].milk[/ICODE] presets directly from Curationist with live projectM equation diagnostics and two-way library sync.
[*][B]Persistent OBS WebSocket Auto-Connect:[/B] Automatic startup connection, 3-second endpoint polling, self-healing source re-binding, and default Loop + Auto-Advance initialization.
[/LIST]

[B]Download:[/B] [URL='https://github.com/obcache/curationist/releases']Curationist-1.2.4-win11-x64.exe (GitHub Releases)[/URL]
```
