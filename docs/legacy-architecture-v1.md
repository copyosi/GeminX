# GeminX — Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    GOOGLE CLOUD RUN (me-west1)              │
│                                                             │
│  ┌──────────────┐    ┌─────────────────────────────────┐   │
│  │   VISION      │    │         ORCHESTRATOR             │   │
│  │               │    │                                   │   │
│  │ Gemini 3      │───►│  State Machine + Audio Router    │   │
│  │ Flash Preview │    │                                   │   │
│  │               │    │  Phases:                          │   │
│  │ Screenshots   │    │  Lock-on → Dissect → Refactor    │   │
│  │ → JSON issues │    │  → Credits (+ Elevate)            │   │
│  └──────────────┘    └──────────┬──────────────────────┘   │
│                                  │                           │
│                          WebSocket│                           │
│                                  │                           │
│  ┌──────────────┐    ┌──────────┴──────────────────────┐   │
│  │   MINI        │    │         NANO BANANA 2            │   │
│  │               │    │                                   │   │
│  │ Gemini 2.5    │    │  Gemini 3.1 Flash Image Preview  │   │
│  │ Flash Native  │    │                                   │   │
│  │               │    │  Critique → Redesigned UI image   │   │
│  │ Bidirectional │    └──────────────────────────────────┘   │
│  │ Voice + Tools │                                           │
│  └──────────────┘    ┌──────────────────────────────────┐   │
│                       │         LYRIA (realtime-exp)        │   │
│                       │                                     │   │
│                       │  Credits music / "Code is Disease"  │   │
│                       └──────────────────────────────────┘   │
│                                                             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                       WebSocket + Audio
                               │
          ┌────────────────────┴────────────────────┐
          │           iPAD (Safari)                  │
          │                                          │
          │  GeminX Frontend                         │
          │  - Live camera / video feed              │
          │  - B&W filter + scan ring                │
          │  - Netflix subtitles                     │
          │  - Chapter title cards                   │
          │  - Before/After slider                   │
          │  - Credits animation                     │
          │                                          │
          └────────────────────┬─────────────────────┘
                               │
                          Audio (room)
                               │
          ┌────────────────────┴─────────────────────┐
          │        iPHONE — THE DEFENDANT             │
          │                                           │
          │  Gemini Live + Video                      │
          │  Sees the Mac screen                      │
          │  Hears Mini roasting                      │
          │  Defends in real-time                     │
          │                                           │
          └───────────────────────────────────────────┘

Models (4):
  1. gemini-2.5-flash-native-audio  → Mini voice (bidirectional)
  2. gemini-3-flash-preview         → Vision (screenshot → issues)
  3. gemini-3.1-flash-image-preview → Nano Banana 2 (redesign)
  4. lyria-realtime-exp             → Music (credits)

Stack:
  - Node.js orchestrator
  - Google GenAI SDK
  - WebSocket (real-time)
  - HTML/CSS/JS (no frameworks)
  - Cloud Run me-west1
```
