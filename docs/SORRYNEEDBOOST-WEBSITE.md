# Curationist — Website Copy for sorryneedboost.com

Modular, ready-to-publish copy tailored to the creative-technology voice and portfolio structure of **https://sorryneedboost.com**.

---

## 1. Portfolio Card / Projects Index Entry

- **Category / Eyebrow:** `CREATIVE SOFTWARE • LIVE BROADCAST`
- **Title:** `Curationist`
- **One-Line Tagline:** `A local-first media curation studio and native OBS Studio plugin suite for live audio, video loops, and MilkDrop GPU visualizers.`
- **Card Summary (2–3 sentences):**
  > Built for music-driven broadcasts and live visual sets, Curationist unifies audio libraries, video clip playlists, and projectM / MilkDrop shader curation into one dense desktop studio—paired directly with a native C++ OBS Studio 33+ plugin. Stage playlists locally, author `.milk` shaders in the bundled `milkLab` IDE, and switch cleanly into live OBS broadcast control from a unified performance deck.
- **Primary Link Label:** `Explore Curationist` / `Download for Windows 11`

---

## 2. Project Page Hero

- **Eyebrow:** `SOFTWARE • OBS STUDIO 33+ • WINDOWS 11`
- **Headline:** `Curationist`
- **Subheadline:** `One studio for live audio playlists, zero-copy video loops, and audio-reactive GPU visualizers—running natively inside OBS Studio.`
- **Lead Paragraph:**
  > Live music streams shouldn't require duct-taping together desktop players, browser overlays, virtual audio routers, and fragile hotkeys. **Curationist** replaces that patchwork with a single desktop curation studio and a native C++ OBS plugin bundle—keeping your tracks, cover art, video loops, and MilkDrop presets organized locally and synchronized cleanly on air.
- **CTA Buttons:**
  - Primary: `Download v1.2.4 (Windows 11 x64)` → `https://github.com/obcache/curationist/releases`
  - Secondary: `View on GitHub` → `https://github.com/obcache/curationist`
- **Hero Media:** `docs/screenshots/curationist-obs-live.jpg`
  - **Caption:** `Curationist Visualizer and the Universal Control Surface driving Curationist Audio, Video, and Visualizer live inside OBS Studio 33.`

---

## 3. Long-Form Project Description

### Built for Live Creative Continuity

Curationist was born directly out of running music-first livestreams and visual broadcasts at Sorry Need Boost—pairing catalogs like **Echoteric** and visual loops with real-time reactive graphics without losing creative control mid-set.

Rather than treating curation and live playback as two separate worlds, Curationist bridges them deliberately. You curate, tag, rate, validate, and audition everything in a fast, SQLite-backed desktop workspace. When you're ready to go live, a single click publishes atomic queue snapshots to OBS Studio, and flipping the **OB** switch hands transport control directly to your live broadcast sources over OBS WebSocket v5.

### Three Native C++ OBS Sources, Zero Workarounds

Installed in one click through Curationist's guided setup wizard, the bundled C++ plugin adds three native scene sources directly into **OBS Studio 33+**:

- **Curationist Audio** — Plays `MP3`, `FLAC`, `WAV`, `M4A`, and `AIFF` playlists natively in OBS with real-time cover-art GPU shaders (glow, vignette, color grading, audio-reactive bounce, and camera shake) alongside configurable `-15s` to `+15s` crossfading and auto-fade transitions.
- **Curationist Video** — Zero-copy playback for `MP4`, `MKV`, `WEBM`, `MOV`, `AVI`, and `M4V` visual loops with `-15s` to `+15s` GPU cross-dissolves and optional **Advance on Song Change** synchronization.
- **Curationist Visualizer** — Real-time GPU-accelerated **projectM v4 / MilkDrop** shader rendering driven by any OBS audio source or scene mix, with smooth soft-cut transitions, configurable resolution and frame rate (up to 1080p60), and automatic song-change advancement.

### From Library Curation to Performance Mode

Every workspace shares a persistent **Universal Control Surface** anchored to the bottom of the studio—putting Audio transport, live Video monitoring, and live projectM preset previews side by side. Flip individual **OB** remote toggles per channel, or throw the three-position **Master OB Toggle** to arm Audio, Video, and Visualizer together.

When it's time to focus purely on the broadcast, **Performance Mode** expands into a clean fullscreen live command deck—or lets you pop out the control deck and individual monitors onto a second display without interrupting playback.

### Built-In Shader Repair & `milkLab` Preset IDE

Classic MilkDrop preset collections often contain subtle syntax quirks that break modern renderers. Curationist automatically validates and repairs `.milk` presets on import for projectM v4, showing full shader diagnostics and live native previews right inside the workspace. And whenever you want to build something original, pressing `Ctrl+N` or `Ctrl+E` opens the bundled **milkLab Preset IDE**—offering both a visual node-graph workflow (with wave generators and composable motion, color, and echo effects) and direct source editing with live equation linting, real-time projectM preview, and automatic two-way sync back to your Curationist library.

> **Suggested Inline Media:** `docs/screenshots/milklab-preset-ide.jpg`
> **Caption:** `Bundled milkLab Preset IDE: author and edit MilkDrop .milk presets visually with composable wave and effect nodes or direct equation code, with real-time projectM preview.`

---

## 4. Feature Highlights Grid (6 Tiles)

1. **Native OBS 33+ Plugin Bundle**
   One-click guided installation adds `Curationist Audio`, `Curationist Video`, and `Curationist Visualizer` directly to OBS Studio—no browser sources or virtual audio routing required.

2. **Synced Transitions & Crossfades**
   Dial in `-15s` to `+15s` audio crossfades and GPU video cross-dissolves, or sync video clips and MilkDrop shaders to advance automatically whenever a new track begins.

3. **High-Capacity Local Libraries**
   Manage thousands of audio tracks, video clips, and `.milk` presets in local SQLite libraries with recursive folder trees, 5-star ratings, and full ID3 tag, cover-art, and synced-lyrics editing.

4. **Universal Control Surface & Master OB Toggle**
   Monitor and control Audio, Video, and Visualizer from one persistent deck. Switch cleanly between local auditioning and live OBS WebSocket control per channel or all at once.

5. **Performance Mode & Popout Windows**
   Switch to a distraction-free fullscreen live command surface or detach monitors and transport controls onto a second display with uninterrupted audio.

6. **Embedded projectM Preview & `milkLab` IDE**
   Validate, auto-repair, preview, and author `.milk` GPU shader presets inside one cohesive workflow, with instant sync back to your playlists and OBS scenes.

---

## 5. Technical Spec Strip

| Spec | Details |
| :--- | :--- |
| **Current Release** | v1.2.4 (`Curationist-1.2.4-win11-x64.exe`) |
| **Platform** | Windows 11 64-bit (Build 22000+, x64) |
| **OBS Compatibility** | OBS Studio 33.0+ (64-bit) + OBS WebSocket v5 |
| **Audio Formats** | MP3, FLAC, WAV, M4A, AIFF *(+ OGG, OPUS, AAC, WMA in OBS)* |
| **Video Formats** | MP4, MKV, WEBM, MOV, AVI, M4V |
| **Visualizer Engine** | Native projectM v4 / MilkDrop (`.milk`) + bundled `milkLab` IDE |
| **Architecture** | Local-first Electron + TypeScript + SQLite + Native C++ OBS Plugin |

---

## 6. Screenshot Gallery Captions & Alt Text

1. **`docs/screenshots/curationist-obs-live.jpg`**
   - **Alt text:** `Curationist Studio running side-by-side with OBS Studio 33, displaying the projectM preset workspace, Universal Control Surface, and a live OBS broadcast combining Curationist Audio, Video, and Visualizer sources.`
   - **Caption:** `Live broadcast setup: Curationist driving synchronized audio, video overlay, and audio-reactive projectM shaders natively inside OBS Studio 33.`

2. **`docs/screenshots/milklab-preset-ide.jpg`**
   - **Alt text:** `The bundled milkLab Preset IDE displaying its visual node-based Workflow editor with a Wave generator, chained Tidal warp, Color shift, Kaleido fold, and Echo trails effect blocks, alongside a live projectM shader preview and synced preset library.`
   - **Caption:** `Bundled milkLab Preset IDE: build or customize MilkDrop .milk presets visually with composable wave and effect nodes—or edit raw equations—with real-time projectM preview.`

3. **`docs/screenshots/setup-wizard-step1-plugin.jpg`**
   - **Alt text:** `Curationist Welcome and OBS Integration Setup Wizard Step 1 showing one-click installation status for the native C++ OBS Studio plugin bundle.`
   - **Caption:** `Step 1 of the guided Setup Wizard detects OBS Studio 33+ and installs the native Curationist Audio, Video, and Visualizer sources in one click.`

4. **`docs/screenshots/setup-wizard-step2-websocket.jpg`**
   - **Alt text:** `Curationist Welcome and OBS Integration Setup Wizard Step 2 showing OBS WebSocket server instructions, password input, and persistent auto-connect toggle.`
   - **Caption:** `Step 2 connects Curationist to OBS WebSocket v5 with persistent auto-reconnect and automatic source discovery.`
