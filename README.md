# GeminX

**One agent. One defendant. Zero mercy.**

Your UI's worst nightmare.

---

## What is GeminX?

A live UX critique app. An AI agent named Mini roasts a real app's interface in real-time — while the app defends itself live. Four cinematic chapters. A punk rock finale. Built for the Gemini Live Agent Challenge.

I asked Gemini who should be roasted. It volunteered.

---

## Demo

📺 [YouTube Demo Video](YOUR_YOUTUBE_LINK_HERE)

🔗 [Live App](https://minix-576399802715.me-west1.run.app)

---

## Architecture

```
iPad (Safari) ←── WebSocket ──→ Cloud Run (me-west1)
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              Gemini 2.5      Gemini 3        Gemini 3.1
              Flash Native    Flash Preview   Flash Image
              (Mini voice)    (Vision/Jam)    (Nano Banana 2)
                                                    │
                                              Lyria
                                              (realtime-exp)
```

iPhone with Gemini Live + Video = The Defendant. Hears Mini through room audio. Defends live.

---

## Models

| Model | Role | What it does |
|-------|------|-------------|
| `gemini-2.5-flash-native-audio` | Mini | Bidirectional voice agent. Roasts, argues, produces. |
| `gemini-3-flash-preview` | Vision (Jam) | Screenshots → structured UX issues with coordinates |
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | Generates redesigned UI from critique |
| `lyria-realtime-exp` | Music | Credits track / "Code is Disease" |

---

## Setup & Run

### Prerequisites

- Node.js 18+
- Google Cloud account with Gemini API access
- `GEMINI_API_KEY` environment variable

### Local

```bash
git clone https://github.com/YOUR_REPO_HERE
cd geminx
npm install
echo "GEMINI_API_KEY=your_key_here" > .env
node server.js
```

Open `http://localhost:8080` in Safari (iPad) or Chrome (Mac).

### Deploy to Cloud Run

```bash
gcloud run deploy minix \
  --source . \
  --region=me-west1 \
  --allow-unauthenticated \
  --cpu=2 \
  --memory=4Gi \
  --min-instances=1
```

---

## Project Structure

```
├── server.js              # Express + routes
├── config/
│   ├── index.js           # Model names, ports, API config
│   ├── prompts.js         # Mini system prompt
│   └── tools.js           # annotate_ui + render_new_ui
├── services/
│   ├── orchestrator.js    # State machine, turns, audio routing
│   ├── Agent.js           # WebSocket to Gemini Live API
│   ├── vision.js          # Screenshot → JSON issues
│   ├── imageGen.js        # Nano Banana 2 redesign
│   ├── musicGen.js        # Lyria credits music
│   └── router.js          # Turn prompts per chapter
├── public/
│   ├── index.html         # Frontend (4 screens)
│   └── app.js             # UI, audio, WebSocket client
└── Dockerfile
```

---

## The Demo — 4 Chapters

1. **The Volunteer** — ChatGPT refuses. Grok refuses. Gemini volunteers.
2. **The Roast** — Mini tears apart Gemini's home screen. Gemini defends live.
3. **The Rebuild** — Nano Banana 2 generates a redesign. Before/After.
4. **The Upgrade** — Gemini asks to be upgraded. Mini produces a punk song instead.

Post-credits: Claude gets invited. Declines.

---

## Built With

- Google GenAI SDK
- Gemini Live API (bidirectional)
- Google Cloud Run (me-west1)
- Node.js
- WebSocket
- HTML/CSS/JS (no frameworks)

---

## Category

**Live Agents** — Real-time voice interaction with barge-in, distinct persona, live context-awareness.

---

*Solo developer. Built with the best models available.*

*#GeminiLiveAgentChallenge*
