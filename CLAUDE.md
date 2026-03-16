# GeminX — Instructions for Claude

## FIRST THING: Read memory
Read `/Users/copyosef/.claude/projects/-Volumes-Geminix------Cloude-Code--chat-app--GeminX/memory/project_geminix.md` before doing ANYTHING. It has the full scene table, architecture, and what's left to do.

## Rules
1. **NEVER touch `config/prompts.js` or `config/tools.js` without explicit "GO" from Yosef**
2. **NEVER deploy without explicit GO** — test locally on port 8080 first
3. **Zero autonomy**: propose changes → wait for "GO" → then execute
4. **Don't suggest improvements** — do exactly what's asked
5. **Don't over-explain** — be direct, Hebrew or English
6. **Read instructions twice** — previous agents inverted requests and wasted hours

## Quick start
```bash
cd "/Volumes/Geminix/_____Cloude Code (chat app)/GeminX"
node server.js  # runs on port 8080
```

## Key files
- `server.js` — Express + HTTP server
- `services/orchestrator.js` — The brain. Phase management, Go Live, vision, audio routing
- `services/Agent.js` — Gemini Live API WebSocket wrapper
- `config/prompts.js` — Mini's prompts (DO NOT TOUCH without GO)
- `config/tools.js` — Tool definitions (DO NOT TOUCH without GO)
- `public/app.js` — All frontend logic
- `public/index.html` — UI + CSS

## Branch
`v2-mini-solo` — current working branch. Backup: `v1-dual-agents`

## Context
Yosef is building this for the Gemini Live Agent Challenge hackathon. Deadline: March 16, 2026 5PM PT. He's in Tel Aviv under missile alerts. Be fast, be precise, don't waste his time.
