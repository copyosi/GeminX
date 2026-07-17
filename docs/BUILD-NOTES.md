# Frontend rebuild — build notes

*Scene-free v2 frontend. Replaces the hackathon 4-screen UI with a single
gallery-black critique instrument. Written by the frontend builder for the
architect to run the live checks.*

## What changed

### `public/index.html` — full rewrite
- **Gallery black.** One ground (`#0A0A0C`), warm off-white ink, one accent:
  the critique red (`#FF362B`). No cards, no decorative gradients, no chrome.
  The camera feed is the only exhibit — `object-fit: contain`, matted in black
  like a framed print, so the whole work shows and mark coordinates land on the
  artwork rather than a cropped edge.
- **Committed single visual world (dark).** Deliberate — a gallery is dark. No
  light theme by design (noted here so it reads as a choice, not an omission).
- **Type as system, not soup.** Editorial serif (`ui-serif` → New York / Georgia)
  for the wordmark and the verdict score; system sans for cinematic subtitles;
  `ui-monospace` with tracking for mode / status / mark labels. No webfont CDN
  (offline-safe); no `@font-face` data-URI was needed — the Apple system serif
  carries the gallery voice at zero weight.
- **Scan ring** is the only theatrical element: viewfinder brackets + a red
  sweep, with a `lock-on` contract animation on scan. All motion is gated behind
  `prefers-reduced-motion`.
- **Layout** pins every control to the safe-area edges (exhibit-placard logic).
  Mode picker + Scan sit in the bottom cluster (thumb reach on iPad; also avoids
  colliding with the placard on narrow widths).
- iPad-ready: `playsinline` video, `viewport-fit=cover` + safe-area insets,
  48px touch targets, no hover-dependent UI, visible focus states.

### `public/app.js` — full rewrite
Kept every runtime capability, ported the proven (iOS-hardened) audio/mic code:
- WebSocket connect + auto-reconnect (unchanged protocol).
- Mic capture → 16 kHz PCM16, 40 ms chunks, gain 4× (`audio_input`).
- Mini voice playback: 24 kHz PCM16, gapless scheduling, gain 3×, iOS
  suspend/resume health check, barge-in flush on `flush_audio`.
- Camera via `getUserMedia` (environment facing), early-permission warmup so the
  Scan tap is instant; audio-only fallback if the camera is denied.
- Screenshot vision: `/api/vision-prefetch` (+ `/api/vision-tick` still supported).
- Tool-call handling with ack for every call (never blocks Mini).
- Before/after slider (draggable, minimal handle, animated reveal sweep).

**New flow (single path):** `idle` → Scan → (greet connects Mini) →
prefetch scan with selected mode → `show_me` consumes it → Mini roasts (audio +
subtitles + red marks) → live debate (mic always streaming) → **Rebuild** →
before/after. `New` resets to a fresh Mini session.

**Critique marks** — the core visual. Rendered as an editor's red-pen loop
(SVG stroke, draw-on) + a short mono label, positioned to the letterboxed video
content rect so `x/y` percentages hit the artwork:
- `annotate_at` (new tool): x/y percent + label — the primary path.
- `annotate_ui` (legacy enum): mapped to approximate frame positions
  (`LEGACY_TARGET`) so old targets still render.
- `vision_result` issues also drop quiet marks + fill the verdict placard
  (score /10 + worst area); Mini's live `annotate_at` calls land emphasized.
- Subtitles and mark labels detect Hebrew and render RTL.

### `services/orchestrator.js` — minimal protocol extension (only)
Two small changes, both within the allowed scope:
1. **Mode wired through the scan.** `handleVisionTick` and
   `handleVisionPrefetch` now read `req.body.mode` and pass it to
   `analyzeScreenshot(image_base64, mode)`, so the UI / Print / Art picker
   actually selects the critique taxonomy (`services/vision.js`). Default
   remains `ui` when absent — backward compatible.
2. **Rebuild trigger.** Added `if (d.event === 'rebuild') this._startBuild();`
   to the frontend WS handler. `_startBuild()` already existed but was unwired;
   it runs the Nano Banana redesign and broadcasts `build_generating` /
   `image_result` / `nano_banana_failed`. No behavior change to any other path.

No other `services/*` files touched. `config/prompts.js` untouched. No hackathon
assets deleted (`public/demo/`, mp3/m4a/mp4, before/after PNGs remain).

## Verified (dummy key, `GEMINI_API_KEY=dummy node server.js`)
- Server boots and serves `/`, `/app.js`, `/health` (all 200).
- Page loads with **zero console errors/warnings** (idle, live, and reveal states).
- WS protocol end-to-end via a Node client: `init` → `vision-prefetch` with
  `mode:print` returns the print-taxonomy fallback → `show_me` broadcasts
  `vision_result` → new `rebuild` event drives `build_generating` →
  `nano_banana_failed` (expected on a dummy key).
- Client rendering (simulated server messages in-browser): verdict placard
  (score + worst), red marks from `annotate_at`, `annotate_ui`, and
  `vision_result`, RTL Hebrew subtitle, Rebuild reveal, before/after slider
  drag + clip compositing. Screenshotted on iPad viewport (768×1024).

## Needs a live key (architect to run)
These paths were read carefully and exercised with the protocol, but the real
Gemini models were not called:
- **Mini voice** (native-audio WS): greeting → `greet_done` → `show_me`, audio
  playback, output transcription → subtitles, barge-in interrupt.
- **Bidirectional debate**: mic audio reaching Mini and her replying to room
  speech (server VAD).
- **Real vision** taxonomy per mode (dummy key returns the per-mode fallback,
  which is correct-shaped but generic).
- **Nano Banana** `image_result` → the before/after "after" plate (dummy key
  hits `nano_banana_failed`, which the UI handles by returning to the live
  critique).
- **On real hardware**: iPad Safari camera + mic permission flow, AudioContext
  unlock on the Scan gesture, and mark placement accuracy against a physical
  print ad photographed at an angle.

## Notes / follow-ups for Yosef
- The greeting nudge in `orchestrator._greet()` still says "Hey Yosef… Chapter 1
  — The Volunteer." It's harmless (Mini just greets), but if you want the
  scene-free voice all the way through, that string is the place — your call,
  your signature (left untouched here since it's persona-adjacent).
- Wordmark reads "Mini". Rename freely in `index.html` (`.wordmark`).
- Legacy credits / music / Lyria / chapter-card flow is intentionally not part
  of the v2 UI; the server still emits those events and they're safely ignored.
