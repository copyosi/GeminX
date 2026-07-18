const { WebSocketServer, WebSocket } = require('ws');
const Agent = require('./Agent');
const { analyzeScreenshot, analyzeDocument } = require('./vision');
const { generateRedesign } = require('./imageGen');
// Lyria removed — credits music is now a static file (Code_is_Disease.mp3) on frontend
const {
  miniGreet,
  miniRoast, miniRoastContinue,
  miniClose,
} = require('./router');
const { MINI, MINI_LOCKON, MINI_ROAST, MINI_DEFENSE, MINI_BUILD, MINI_CREDITS } = require('../config/prompts');
const history = require('./history');

// Bidirectional: no forced rounds — Mini flows freely, reacts to room audio
const ROAST_TIMEOUT_MS = 60000; // 60s safety → auto-transition to BUILD

// ─── Visual State Machine ────────────────────────────────────────────────
const STATE_ORDER = ['main_screen', 'menu_open', 'live_ui'];

// ─── Chapter titles ──────────────────────────────────────────────────────
const CHAPTERS = {
  volunteer: { number: 1, title: 'The Volunteer' },
  roast:     { number: 2, title: 'The Roast' },
  rebuild:   { number: 3, title: 'The Rebuild' },
  upgrade:   { number: 4, title: 'The Upgrade' },
};

class Orchestrator {
  constructor(httpServer) {
    this.phase         = 'void';
    this.mode          = 'print';   // critique eye: ui | print | art (frontend default: print)
    this.visualState   = 'main_screen';
    this.lastIssues    = [];
    this.lastScreenshot = null;
    this.miniBuffer    = '';
    this.fullCritique  = '';
    this.round         = 0;
    this.debating      = false;
    this.visionBusy    = false;
    this.pendingTools  = new Map();
    this.waitingForUser = false;
    this._openerSent    = false;
    this._prefetchedVision = null;
    this.roastPart      = 'solo';  // 'solo' → 2A (Mini alone), 'live' → 2B (Mini vs Gemini)

    // ─── Frontend WS ─────────────────────────────────────────
    this.clients = new Set();
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', ws => this._onFrontendConnect(ws));

    // ─── Agent — Mini only (Jam is visual-only, no API) ──────
    const cb = {
      onText:         (n, t)       => this._onText(n, t),
      onAudio:        (n, m, d)    => this._onAudio(n, m, d),
      onToolCall:     (n, id, nm, a) => this._onToolCall(n, id, nm, a),
      onToolTimeout:  (n, id, nm)  => this._onToolTimeout(n, id, nm),
      onTurnComplete: (n)          => this._onTurnComplete(n),
      onInterrupted:  (n)          => this._onInterrupted(n),
      onUserTranscript: (n, t)     => this._onUserTranscript(n, t),
      onMiniTranscript: (n, t)     => this._onMiniTranscript(n, t),
      shouldReconnect:  (n)        => this.debating,
    };

    this.agents = {
      mini: new Agent('mini', 'Aoede', MINI, cb),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FRONTEND WS
  // ═══════════════════════════════════════════════════════════════════════════

  _onFrontendConnect(ws) {
    this.clients.add(ws);
    console.log(`[WS] frontend connected (${this.clients.size} total)`);

    // Reset state on new connection (refresh) so user starts fresh
    this.phase = 'void';
    this.debating = false;
    this.miniBuffer = '';
    this.fullCritique = '';
    this._openerSent = false;
    this._turnCount = 0;
    this._micChunks = 0;
    this.roastPart = 'solo';
    clearTimeout(this._debateTimeout);
    clearTimeout(this._audioOnlyTimer);
    console.log('[WS] State reset → void');

    // No auto-prompts — system instruction (MINI) has everything.
    // Yosef controls Mini via voice (Producer Mode). Don't override.

    ws.send(JSON.stringify({
      event: 'init',
      phase: this.phase,
      visualState: this.visualState,
      agents: {
        mini: this.agents.mini.alive ? 'connected' : 'disconnected',
      }
    }));

    ws.on('message', raw => {
      let d;
      try { d = JSON.parse(raw); } catch { return; }
      if (d.event === 'phase_change')   this._setPhase(d.phase);
      if (d.event === 'tool_completed') this._resolveTool(d.callId, d.toolName, d.status);
      if (d.event === 'advance_scene')  this._advanceScene();
      if (d.event === 'audio_input')    this._routeAudio(d.data);
      if (d.event === 'greet')          this._greet();
      if (d.event === 'go_live_manual') this._onUserTranscript('manual', 'Go Live');
      if (d.event === 'reset')          this._reset();
      if (d.event === 'show_me')        this._onShowMe();
      if (d.event === 'rebuild')        this._startBuild();   // v2: frontend triggers Nano Banana redesign
      if (d.event === 'flush_audio')    this._onCut();
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[WS] frontend disconnected (${this.clients.size} remaining)`);
    });
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const c of this.clients)
      if (c.readyState === WebSocket.OPEN) c.send(msg);
  }

  _setPhase(phase) {
    const VALID = new Set(['void', 'greet', 'roast', 'live', 'build', 'credits']);
    if (!VALID.has(phase)) return;
    if (phase === 'credits' && this.phase !== 'credits') {
      this._startCredits();
      return;
    }
    this.phase = phase;
    this.broadcast({ event: 'phase_change', phase });
    console.log(`[Phase] → ${phase}`);
    // v2: no scene-change nudges to MiniX — the hackathon chapter messages
    // ("You are looking at Gemini's home screen") kept dragging her back
    // into UI-world on print/art sessions.
  }

  // ── Chapter title card ─────────────────────────────────────────────────
  _showChapter(key) {
    const ch = CHAPTERS[key];
    if (!ch) return;
    this.broadcast({ event: 'chapter', number: ch.number, title: ch.title });
    console.log(`[Chapter] ${ch.number}: ${ch.title}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VISUAL STATE MACHINE
  // ═══════════════════════════════════════════════════════════════════════════

  _advanceScene() {
    if (!this.waitingForUser) return;
    const idx = STATE_ORDER.indexOf(this.visualState);
    if (idx < 0 || idx >= STATE_ORDER.length - 1) return;
    const next = STATE_ORDER[idx + 1];
    this.visualState = next;
    this.waitingForUser = false;
    this.broadcast({ event: 'scene_advance', visualState: next });
    console.log(`[Scene] ▶ Advanced to: ${next}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT CALLBACKS — Mini solo
  // ═══════════════════════════════════════════════════════════════════════════

  _onText(agentName, text) {
    this.broadcast({ event: 'agent_text', agent: agentName, text });
    if (agentName === 'mini') this.miniBuffer += text;
  }

  _onAudio(agentName, mimeType, data) {
    this.broadcast({ event: 'audio_chunk', agent: agentName, mimeType, data });
  }

  /** Scene change from frontend — visual cut only. Mini stays live. */
  _onCut() {
    console.log('[CUT] ✂ Visual cut — Mini stays live');
    // DON'T interrupt Mini — she's always on, continuous across scenes
    // Just save buffer for history and reset visual state
    if (this.miniBuffer.trim()) {
      history.addTurn('mini', this.miniBuffer);
    }
    this.miniBuffer = '';
    // Don't reset debating — Mini keeps going
    clearTimeout(this._audioOnlyTimer);
  }

  _onInterrupted(agentName) {
    console.log(`[VAD] ⚡ ${agentName} interrupted — user speaking, flushing frontend audio`);
    this.broadcast({ event: 'flush_audio' });
    // Save what Mini said before interruption
    if (this.miniBuffer.trim()) {
      history.addTurn('mini', this.miniBuffer);
    }
    this.miniBuffer = '';
  }

  _onUserTranscript(agentName, text) {
    if (!text || !text.trim()) return;
    const clean = text.trim();
    history.addTurn('user', clean);
    console.log(`[History] 👂 User: "${clean.slice(0, 80)}"`);

    // v2: no "Go Live" / chapter nudges — the hackathon script is retired.
    // MiniX flows bidirectionally; the only voice trigger kept is a wrap-up cue.
    const lower = clean.toLowerCase();
    if (lower === 'okay cut' || lower === 'ok cut' || clean === 'קאט') {
      this.agents.mini.send('סיימי עכשיו. משפט אחד לסגירה, בעברית. ואז עצרי.');
      console.log(`[Trigger] ✂ wrap-up sent (${this.phase})`);
    }
  }

  _onMiniTranscript(agentName, text) {
    if (text && text.trim()) {
      // Log what MiniX says — this is the deploy log
      console.log(`[LIVE] 🗣 MiniX: "${text.trim().slice(0, 200)}"`);
      // She speaks in AUDIO modality, so the transcript IS her critique text.
      // Accumulate it — this is what Nano Banana rebuilds from (fullCritique
      // was arriving empty because only rare text parts fed miniBuffer).
      this.miniBuffer += text;
      // Broadcast to frontend for subtitle — keep leading space for word separation
      this.broadcast({ event: 'mini_transcript', text });
    }
  }

  _onToolCall(agentName, callId, toolName, args) {
    // set_mode is resolved server-side: MiniX asked what we're killing today,
    // the human answered, she picks the eye. No frontend ack needed.
    if (toolName === 'set_mode') {
      const mode = ['ui', 'print', 'art'].includes(args?.mode) ? args.mode : null;
      if (mode) {
        this.mode = mode;
        this.broadcast({ event: 'mode_change', mode });
        console.log(`[Mode] 🎯 MiniX set critique eye → ${mode}`);
      }
      this.agents[agentName].confirmTool(callId, toolName, { status: mode ? 'ok' : 'invalid_mode' });
      return;
    }
    this.pendingTools.set(callId, agentName);
    this.broadcast({ event: 'tool_execution', agent: agentName, callId, tool_name: toolName, args });
  }

  _onToolTimeout(agentName, callId, toolName) {
    this.pendingTools.delete(callId);
    console.log(`[Tool ⏱] ${toolName} timed out for ${agentName}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TURN COMPLETE — Mini solo, free-flowing bidirectional
  // ═══════════════════════════════════════════════════════════════════════════

  _onTurnComplete(agentName) {
    console.log(`[TC] ${agentName} turnComplete | phase=${this.phase} scene=${this.visualState} debating=${this.debating}`);

    this.broadcast({ event: 'agent_turn_end', agent: agentName });

    // Save Mini's turn to history
    if (agentName === 'mini' && this.miniBuffer.trim()) {
      history.addTurn('mini', this.miniBuffer);
    }

    // ── GREET phase — Mini said hi, ready for roast ──
    if (this.phase === 'greet') {
      console.log('[Greet] ✔ Mini done → ready for roast');
      this.broadcast({ event: 'greet_done' });
      return;
    }

    // ── BUILD phase — Mini said "hand to Nano Banana" ──
    if (this.phase === 'build') {
      this.miniBuffer = '';
      console.log(`[Build] ✔ Mini done → rebuild complete`);
      this.broadcast({ event: 'build_complete' });
      // Auto-transition removed — credits triggered by frontend nav only
      return;
    }

    // ── VOID phase — Mini did the script, now listening ──
    if (this.phase === 'void') {
      this.miniBuffer = '';
      // Keep debating=true so Mini hears Yosef's response via mic
      this.debating = true;
      console.log('[TC] ✔ Mini done in void → listening (debating stays true)');
      return;
    }

    // ── ROAST phase — BIDIRECTIONAL: Mini flows freely ──
    if (!this.debating) {
      console.log(`[TC] ✋ Ignoring stale TC — not debating`);
      return;
    }

    const said = this.miniBuffer.trim();
    if (said) {
      this.fullCritique += `MINI: ${said}\n`;
      this._turnCount = (this._turnCount || 0) + 1;
      console.log(`[Roast] Mini turn ${this._turnCount} done (${said.length} chars) — listening for room audio…`);
    }
    this.miniBuffer = '';

    // DON'T send continuation prompts — Mini reacts to room audio naturally.
    // The bidirectional audio channel stays open via _routeAudio.
    // If Mini hears Gemini defending on iPad speaker, she'll respond.
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROAST COMPLETE
  // ═══════════════════════════════════════════════════════════════════════════

  _onRoastComplete() {
    this.debating = false;
    clearTimeout(this._debateTimeout);
    console.log(`[Scene] ✔ Roast done — ${this._turnCount || 0} turns, ${this.fullCritique.length} chars critique`);
    // Auto-transition removed — build triggered by frontend nav only
  }

  _onShowMe() {
    if (this._openerSent) return;
    this._openerSent = true;

    // Show Chapter 2: The Roast
    this._showChapter('roast');

    // Delay roast start so chapter card is visible
    setTimeout(() => {
      this._setPhase('roast');

      // If vision was prefetched, start Mini IMMEDIATELY — bidirectional from here
      clearTimeout(this._audioOnlyTimer); // cancel audio-only fallback
      if (this._prefetchedVision) {
        const { issues, score, worst, image_base64, latency } = this._prefetchedVision;
        this._prefetchedVision = null;
        console.log(`[ShowMe] ⚡ Prefetch hit! ${issues.length} issues (score:${score}) → Mini starts NOW (bidirectional)`);

        this.lastIssues     = issues;
        this.lastScreenshot  = image_base64;
        this.fullCritique   = '';
        this.miniBuffer     = '';
        this._turnCount     = 0;
        this.debating       = true;

        // Safety timeout: 60s → auto-transition to BUILD
        clearTimeout(this._debateTimeout);
        this._debateTimeout = setTimeout(() => {
          if (this.debating) {
            console.warn(`[Safety] ${ROAST_TIMEOUT_MS / 1000}s timeout — forcing roast complete`);
            this._onRoastComplete();
          }
        }, ROAST_TIMEOUT_MS);

        this.broadcast({ event: 'vision_result', issues, score, worst, latency });
        this.agents.mini.send(miniRoast(issues, this.mode));
        return;
      }

      // No prefetch — either vision-tick will come (video mode) or we're audio-only
      console.log(`[ShowMe] Phase → roast [${this.visualState}] (no prefetch — waiting for vision or audio-only)`);

      // Audio-only fallback: if no vision arrives within 5s, start Mini with free-talk prompt
      this._audioOnlyTimer = setTimeout(() => {
        if (this.phase === 'roast' && !this.debating) {
          console.log('[ShowMe] ⚡ No vision after 5s — audio-only mode. Mini free-talks.');
          this.fullCritique = '';
          this.miniBuffer   = '';
          this._turnCount   = 0;
          this.debating     = true;

          // Safety timeout
          clearTimeout(this._debateTimeout);
          this._debateTimeout = setTimeout(() => {
            if (this.debating) {
              console.warn(`[Safety] ${ROAST_TIMEOUT_MS / 1000}s timeout — forcing roast complete`);
              this._onRoastComplete();
            }
          }, ROAST_TIMEOUT_MS);

          this.agents.mini.send(
            `אין עבודה מול העיניים כרגע. יוסף רוצה לדבר. שיחה חופשית — הישארי בדמות, בעברית בלבד. הגיבי למה שהוא אומר.`
          );
        }
      }, 5000);
    }, 2500); // chapter card visible for 2.5s
  }

  _reset() {
    console.log('[Reset] 🔄 Full session reset — reconnecting Mini');
    this.phase = 'void';
    this.debating = false;
    this.miniBuffer = '';
    this.fullCritique = '';
    this._openerSent = false;
    this._turnCount = 0;
    this._micChunks = 0;
    this.roastPart = 'solo';
    clearTimeout(this._debateTimeout);
    clearTimeout(this._audioOnlyTimer);
    this.agents.mini.reconnect();
  }

  // DRAFT — opening line direction from Yosef 18.7 ("אז מה קוטלים היום?").
  // Final wording is his to sign (prompt law).
  static GREET_NUDGE =
    'את בשידור. שאלי בעברית, במשפט אחד: "אז מה קוטלים היום? קופירייטינג? ' +
    'ארט דיירקשן? קונספט? דברו אליי." ואז עצרי וחכי לתשובה. ' +
    'כשעונים לך — קבעי את העין עם set_mode והמשיכי.';

  _greet() {
    console.log('[Greet] 🎬 Scan pressed — connecting MiniX + opening question');
    this.debating = true;
    if (!this.agents.mini.ready) {
      this.agents.mini.connect();
      const waitAndSend = () => {
        if (this.agents.mini.ready) {
          this.agents.mini.send(Orchestrator.GREET_NUDGE);
          console.log('[Greet] 🎬 MiniX connected + opening nudge sent');
        } else {
          setTimeout(waitAndSend, 200);
        }
      };
      setTimeout(waitAndSend, 500);
    } else {
      this.agents.mini.send(Orchestrator.GREET_NUDGE);
    }
  }

  _startBuild() {
    this._showChapter('rebuild');

    setTimeout(() => {
      this._setPhase('build');
      this.debating = false;

      // Nano Banana — generate redesigned UI image
      this.broadcast({ event: 'build_generating' });
      this._generateImage();

      this.agents.mini.send(miniClose());
    }, 2500);
  }

  async _generateImage() {
    try {
      const hasCritique = !!this.fullCritique?.trim();
      const hasScreenshot = !!this.lastScreenshot;
      console.log(`[NanoBanana] 🍌 Starting... critique: ${hasCritique ? this.fullCritique.length + ' chars' : 'EMPTY'}, screenshot: ${hasScreenshot ? 'YES' : 'NO'}`);
      if (!hasCritique) {
        console.warn('[NanoBanana] ⚠ Empty critique — image may be generic');
      }
      const result = await generateRedesign(this.fullCritique, this.lastScreenshot, this.mode);
      if (result) {
        console.log(`[NanoBanana] ✔ Image ready (${result.mimeType}, ${Math.round(result.data.length / 1024)}KB)`);
        this.broadcast({ event: 'image_result', mimeType: result.mimeType, data: result.data });
      } else {
        console.warn('[NanoBanana] ✖ No image — HTML fallback');
        this.broadcast({ event: 'nano_banana_failed' });
      }
    } catch (err) {
      console.error('[NanoBanana] ✖', err.message);
      this.broadcast({ event: 'nano_banana_failed' });
    }
  }

  _startCredits() {
    this._showChapter('upgrade');

    setTimeout(() => {
      this.phase = 'credits';
      this.broadcast({ event: 'phase_change', phase: 'credits' });
      this.broadcast({ event: 'credits_start' });
      console.log('[Credits] ▶ Rolling — Code_is_Disease plays on frontend');
      // Music is now a static file (Code_is_Disease.mp3) played directly on frontend.
      // No Lyria streaming needed — simpler and more reliable.
    }, 2500);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  _resolveTool(callId, toolName, status = 'ok') {
    const owner = this.pendingTools.get(callId);
    if (!owner) return;
    this.agents[owner].confirmTool(callId, toolName, { status, rendered: true });
    this.pendingTools.delete(callId);
    console.log(`[Tool ✓] ${toolName} confirmed for ${owner}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BIDIRECTIONAL AUDIO — Route mic audio to Mini during roast
  // ═══════════════════════════════════════════════════════════════════════════

  _routeAudio(base64PCM) {
    if (!base64PCM) return;
    // Don't send audio to Mini until debating is true (after greet/Go Live)
    if (!this.debating) return;
    this._micChunks = (this._micChunks || 0) + 1;
    // Log every 100 chunks (~4s) — check audio energy
    if (this._micChunks % 250 === 1) {
      // Decode base64 and check RMS energy
      let rms = 0;
      try {
        const buf = Buffer.from(base64PCM, 'base64');
        let sumSq = 0;
        const samples = buf.length / 2;
        for (let i = 0; i < buf.length - 1; i += 2) {
          const s = buf.readInt16LE(i);
          sumSq += s * s;
        }
        rms = Math.sqrt(sumSq / samples);
      } catch(e) {}
      console.log(`[Mic→Server] #${this._micChunks} (${base64PCM.length} b64) phase=${this.phase} RMS=${rms.toFixed(0)} ${rms > 500 ? 'SPEECH' : rms > 50 ? 'quiet' : 'SILENCE'}`);
    }
    // Bidirectional: Mini hears the room at ALL times — no phase gating
    // VAD on Gemini's side detects speech and triggers Mini's response
    this.agents.mini.sendAudio(base64PCM);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VISION TICK
  // ═══════════════════════════════════════════════════════════════════════════

  async handleVisionTick(req, res) {
    if (this.visionBusy)    return res.status(429).json({ error: 'vision busy' });
    if (this.waitingForUser) return res.status(429).json({ error: 'waiting for scene advance' });
    // Only process vision when Mini is actively performing (after Go Live)
    if (!this.debating)     return res.status(429).json({ error: 'waiting for Go Live' });
    this.visionBusy = true;

    const t0 = Date.now();
    try {
      const { image_base64, mode } = req.body;
      if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });
      if (['ui', 'print', 'art'].includes(mode)) this.mode = mode;

      const scan    = await analyzeScreenshot(image_base64, this.mode);
      const latency = Date.now() - t0;
      const issues  = scan.issues || scan;

      this.lastIssues     = issues;
      this.lastScreenshot  = image_base64;

      this.broadcast({ event: 'vision_result', issues, score: scan.score, worst: scan.worst, latency });

      console.log(`[Vision] ${latency}ms → ${issues.length} issues (score:${scan.score}) → feeding MiniX [${this.mode}]`);
      this.agents.mini.send(miniRoast(issues, this.mode));

      res.json({ status: 'ok', latency, issueCount: issues.length, visualState: this.visualState });
    } catch (err) {
      console.error('[Vision]', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      this.visionBusy = false;
    }
  }

  async handleVisionPrefetch(req, res) {
    const { image_base64, mode } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });
    if (['ui', 'print', 'art'].includes(mode)) this.mode = mode;

    console.log(`[Prefetch] Starting vision analysis in background... (mode: ${this.mode})`);
    const t0 = Date.now();
    try {
      const scan = await analyzeScreenshot(image_base64, this.mode);
      const latency = Date.now() - t0;
      const issues = scan.issues || scan;
      this._prefetchedVision = { issues, score: scan.score, worst: scan.worst, image_base64, latency };
      console.log(`[Prefetch] ✔ Ready: ${issues.length} issues (score:${scan.score}) in ${latency}ms`);
      res.json({ status: 'ok', latency, issueCount: issues.length });
    } catch (err) {
      console.error('[Prefetch]', err.message);
      this._prefetchedVision = null;
      res.status(500).json({ error: err.message });
    }
  }

  // ─── Document critique — uploaded campaign PDF / DOCX (copy, scripts) ──
  async handleDocCritique(req, res) {
    const { kind, name, data_base64 } = req.body ?? {};
    if (!data_base64) return res.status(400).json({ error: 'data_base64 required' });
    if (!['pdf', 'docx'].includes(kind)) return res.status(400).json({ error: 'kind must be pdf|docx' });
    if (data_base64.length > 15_000_000) return res.status(413).json({ error: 'file too large (max ~11MB)' });

    console.log(`[Doc] 📄 Critiquing uploaded ${kind}: "${(name || 'unnamed').slice(0, 60)}"`);
    const t0 = Date.now();
    const scan = await analyzeDocument(kind, data_base64);
    const latency = Date.now() - t0;

    this.mode = 'copy';                       // written-material eye
    this._prefetchedVision = {
      issues: scan.issues, score: scan.score, worst: scan.worst,
      image_base64: null, latency,
    };
    console.log(`[Doc] ✔ ${scan.issues.length} issues (score:${scan.score}) in ${latency}ms`);
    res.json({ status: 'ok', latency, issueCount: scan.issues.length });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API
  // ═══════════════════════════════════════════════════════════════════════════

  handlePhaseChange(req, res) {
    const { phase } = req.body ?? {};
    this._setPhase(phase);
    res.json({ phase: this.phase });
  }

  health() {
    return {
      status: 'ok',
      phase: this.phase,
      mode: this.mode,
      visualState: this.visualState,
      waitingForUser: this.waitingForUser,
      round: this.round,
      debating: this.debating,
      clients: this.clients.size,
      pending: this.pendingTools.size,
      agents: {
        mini: this.agents.mini.alive ? 'connected' : 'disconnected',
      }
    };
  }
}

module.exports = Orchestrator;
