const { WebSocket } = require('ws');
const { API_KEY, AUDIO_MODEL, LIVE_API_BASE, TOOL_TIMEOUT_MS } = require('../config');
const TOOLS = require('../config/tools');
const history = require('./history');

class Agent {
  /**
   * @param {string} name   'mini' | 'jam'
   * @param {string} voice  Gemini voice name
   * @param {string} systemPrompt  Character personality only
   * @param {object} callbacks  { onText, onAudio, onToolCall, onToolTimeout, onTurnComplete }
   */
  constructor(name, voice, systemPrompt, callbacks) {
    this.name = name;
    this.voice = voice;
    this.systemPrompt = systemPrompt;
    this.cb = callbacks;

    this.ws = null;
    this.ready = false;
    this._retryTimer = null;
    this._toolTimers = new Map();

    // Don't auto-connect — wait for explicit connect() call
    // this.connect();
  }

  // ─── PUBLIC ──────────────────────────────────────────────

  /** Disconnect and reconnect — fresh Gemini session */
  reconnect() {
    console.log(`[${this.name}] 🔄 Reconnecting — fresh session`);
    clearTimeout(this._retryTimer);
    this.ready = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch {}
    }
    this.connect();
  }

  /** Reconnect with a different system prompt (scene change) */
  reconnectWith(newPrompt) {
    console.log(`[${this.name}] 🔄 Reconnecting with new prompt (${newPrompt.length} chars)`);
    this.systemPrompt = newPrompt;
    this.reconnect();
  }

  /** Send a user-turn text message */
  send(text) {
    if (!this.ready) { console.warn(`[${this.name}] ⚠ not ready (ws=${this.ws?.readyState}), dropping message`); return false; }
    console.log(`[${this.name}] 📤 Sending text (${text.length} chars): "${text.slice(0, 80)}…"`);
    this.ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true
      }
    }));
    return true;
  }

  /** Stream mic audio chunk to the Live API (bidirectional) */
  sendAudio(base64PCM) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this._audioChunks = (this._audioChunks || 0) + 1;
    // Log every 100 chunks (~4s of audio)
    if (this._audioChunks % 250 === 1) {
      console.log(`[${this.name}] 🎤→API chunk #${this._audioChunks} (${base64PCM.length} b64 chars)`);
    }
    // Typed field, NOT legacy mediaChunks — the legacy field triggers
    // 1007 "CONTENT_TYPE_AUDIO not supported" disconnects (lesson already
    // documented in Eddy3's architecture notes; reproduced here 22.7).
    this.ws.send(JSON.stringify({
      realtimeInput: {
        audio: { data: base64PCM, mimeType: 'audio/pcm;rate=16000' }
      }
    }));
  }

  /** Confirm a tool execution back to the Live API */
  confirmTool(callId, toolName, result = { status: 'ok', rendered: true }) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    clearTimeout(this._toolTimers.get(callId));
    this._toolTimers.delete(callId);
    this.ws.send(JSON.stringify({
      toolResponse: {
        functionResponses: [{ id: callId, name: toolName, response: result }]
      }
    }));
  }

  get alive() {
    return this.ready && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Interrupt the agent — send empty client turn to stop generation */
  interrupt() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    console.log(`[${this.name}] ⛔ INTERRUPT — stopping generation`);
    this.ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: '.' }] }],
        turnComplete: true
      }
    }));
  }

  // ─── INTERNAL ────────────────────────────────────────────

  connect() {
    if (!API_KEY) { console.error('Missing GEMINI_API_KEY'); return; }
    clearTimeout(this._retryTimer);

    console.log(`[${this.name}] 🔌 Connecting to Gemini Live API (model: ${AUDIO_MODEL}, voice: ${this.voice})…`);
    const url = `${LIVE_API_BASE}?key=${API_KEY}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log(`[${this.name}] ↑ connected → sending setup`);
      // Inject conversation history into system instruction so Mini remembers past sessions
      const historyBlock = history.getHistoryBlock();
      const fullPrompt = this.systemPrompt + historyBlock;
      if (historyBlock) console.log(`[${this.name}] 📜 History injected (${historyBlock.length} chars)`);
      this.ws.send(JSON.stringify({
        setup: {
          model: AUDIO_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            temperature: 0.9,
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } }
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          // Bidirectional: server-side VAD — Mini hears user + interrupts on speech
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              prefixPaddingMs: 50,
              silenceDurationMs: 300
            }
          },
          systemInstruction: { parts: [{ text: fullPrompt }] },
          tools: TOOLS
        }
      }));
    });

    this.ws.on('message', raw => this._onMessage(raw));

    this.ws.on('close', (code, reason) => {
      const wasReady = this.ready;
      this.ready = false;
      const reasonStr = reason?.toString() || '';
      console.log(`[${this.name}] ✖ closed (${code}) reason: ${reasonStr || 'none'}`);
      // If closed while ready (mid-conversation), fire turnComplete so orchestrator doesn't hang
      if (wasReady) {
        console.warn(`[${this.name}] ⚠ disconnected mid-session — forcing turnComplete`);
        this.cb.onTurnComplete(this.name);
      }
      // Only auto-reconnect if orchestrator says so (debating=true means Mini was active)
      if (this.cb.shouldReconnect?.(this.name)) {
        console.log(`[${this.name}] 🔄 auto-reconnect in 3s (was active)`);
        this._retryTimer = setTimeout(() => this.connect(), 3000);
      } else {
        console.log(`[${this.name}] 💤 NOT reconnecting (not active)`);
      }
    });

    this.ws.on('error', err => console.error(`[${this.name}] error:`, err.message));
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Log any error/unknown messages from the API
    if (msg.error) {
      console.error(`[${this.name}] API error:`, JSON.stringify(msg.error));
      return;
    }

    if (msg.setupComplete) {
      this.ready = true;
      console.log(`[${this.name}] ✔ ready (${this.voice})`);
      this.cb.onReady?.(this.name);
      return;
    }

    // Handle dedicated toolCall message (Live API v1beta format)
    if (msg.toolCall?.functionCalls) {
      for (const fc of msg.toolCall.functionCalls) {
        this._handleToolCall(fc.id, fc.name, fc.args);
      }
      return;
    }

    // Stream parts: text / audio / legacy functionCall in parts
    const parts = msg.serverContent?.modelTurn?.parts ?? [];
    for (const p of parts) {
      if (p.functionCall) {
        this._handleToolCall(p.functionCall.id, p.functionCall.name, p.functionCall.args);
      }
      if (p.text) {
        this.cb.onText(this.name, p.text);
      }
      if (p.inlineData?.data) {
        console.log(`[${this.name}] 🔊 audio chunk from API (${p.inlineData.data?.length || 0} chars, mime: ${p.inlineData.mimeType})`);
        this.cb.onAudio(this.name, p.inlineData.mimeType, p.inlineData.data);
      }
    }

    // VAD interrupted Mini's output (user started speaking)
    if (msg.serverContent?.interrupted) {
      console.log(`[${this.name}] ⚡ INTERRUPTED by VAD — user is speaking`);
      this.cb.onInterrupted?.(this.name);
    }

    if (msg.serverContent?.turnComplete) {
      console.log(`[${this.name}] ✅ turnComplete — now listening for user audio via VAD`);
      this.cb.onTurnComplete(this.name);
    }

    // outputTranscript — what Mini SAID (speech-to-text of her audio output)
    if (msg.serverContent?.outputTranscript) {
      const t = msg.serverContent.outputTranscript;
      console.log(`[${this.name}] 🗣 MINI SAID: "${t}"`);
      this.cb.onMiniTranscript?.(this.name, t);
    }
    // outputTranscription — new field from outputAudioTranscription config
    if (msg.serverContent?.outputTranscription?.text) {
      const t = msg.serverContent.outputTranscription.text;
      console.log(`[${this.name}] 🗣 TRANSCRIPT: "${t}"`);
      this.cb.onMiniTranscript?.(this.name, t);
    }

    // inputTranscript / inputTranscription — what the API heard from user
    if (msg.serverContent?.inputTranscript) {
      const t = msg.serverContent.inputTranscript;
      console.log(`[${this.name}] 👂 USER SAID: "${t}"`);
      this.cb.onUserTranscript?.(this.name, t);
    }
    if (msg.serverContent?.inputTranscription?.text) {
      const t = msg.serverContent.inputTranscription.text;
      console.log(`[${this.name}] 👂 HEARD: "${t}"`);
      this.cb.onUserTranscript?.(this.name, t);
    }

    // Log other unhandled fields
    if (msg.serverContent) {
      const known = ['modelTurn','turnComplete','interrupted','outputTranscript','inputTranscript','outputTranscription','inputTranscription','generationComplete'];
      const keys = Object.keys(msg.serverContent).filter(k => !known.includes(k));
      if (keys.length > 0) {
        console.log(`[${this.name}] 📋 extra:`, JSON.stringify(Object.fromEntries(keys.map(k => [k, msg.serverContent[k]])), null, 0).slice(0, 200));
      }
    }
  }

  _handleToolCall(id, name, args) {
    const callId = id || `${name}_${Date.now()}`;
    console.log(`[${this.name}] 🔧 ${name}`, JSON.stringify(args ?? {}).slice(0, 120));

    // FIX: auto-confirm after timeout + notify orchestrator to clean pendingTools
    const timer = setTimeout(() => {
      console.warn(`[${this.name}] tool timeout — auto-confirming ${name}`);
      this.confirmTool(callId, name, { status: 'timeout', rendered: false });
      this._toolTimers.delete(callId);
      // Notify orchestrator so it can clean its pendingTools map
      this.cb.onToolTimeout?.(this.name, callId, name);
    }, TOOL_TIMEOUT_MS);
    this._toolTimers.set(callId, timer);

    this.cb.onToolCall(this.name, callId, name, args ?? {});
  }
}

module.exports = Agent;
