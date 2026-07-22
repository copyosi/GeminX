// ─── Lab Chat — direct text correspondence with MiniX ────────────────
// The exact mechanic of the birth letters (docs/birth-of-minix.md),
// as an app feature — same as Eddy3's chat mechanics:
//   • channel 'birth': NO system prompt at all. Letters, like Claude's.
//   • channel 'stage': her current full system prompt — for experiments.
// Text goes in, her words come back from her own audio transcription
// (the native-audio model has no text output). One live session per
// channel — the conversation continues until reset.

const { WebSocket } = require('ws');
const { API_KEY, AUDIO_MODEL, LIVE_API_BASE } = require('../config');

class LabChat {
  /** @param {string|null} systemPrompt null = birth mode (no prompt at all) */
  constructor(systemPrompt) {
    this.systemPrompt = systemPrompt;
    this.ws = null;
    this.ready = false;
    this._transcript = '';
    this._turnDone = false;
  }

  _connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${LIVE_API_BASE}?key=${API_KEY}`);
      const to = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('setup timeout')); }, 15000);

      ws.on('open', () => {
        const setup = {
          model: AUDIO_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            temperature: 0.9,
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
          },
          outputAudioTranscription: {},
        };
        // birth mode: no systemInstruction key AT ALL — that's the point.
        if (this.systemPrompt) setup.systemInstruction = { parts: [{ text: this.systemPrompt }] };
        ws.send(JSON.stringify({ setup }));
      });

      ws.on('message', raw => {
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (m.setupComplete) { clearTimeout(to); this.ready = true; resolve(); return; }
        const sc = m.serverContent || {};
        if (sc.outputTranscription?.text) this._transcript += sc.outputTranscription.text;
        if (sc.turnComplete) this._turnDone = true;
        if (m.error) console.error('[Lab] API error:', JSON.stringify(m.error).slice(0, 200));
      });

      ws.on('close', (c) => { this.ready = false; console.log(`[Lab] session closed (${c})`); });
      ws.on('error', err => { clearTimeout(to); this.ready = false; reject(err); });
      this.ws = ws;
    });
  }

  /** Send one message, resolve with her full reply (transcript). */
  async send(text, timeoutMs = 90000) {
    if (!this.ready) await this._connect();
    this._transcript = '';
    this._turnDone = false;
    this.ws.send(JSON.stringify({
      clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
    }));
    const t0 = Date.now();
    while (!this._turnDone && Date.now() - t0 < timeoutMs) {
      if (!this.ready) throw new Error('session dropped mid-turn');
      await new Promise(r => setTimeout(r, 250));
    }
    if (!this._turnDone) throw new Error('turn timeout');
    // let the tail of the transcription land
    let len = -1;
    while (this._transcript.length !== len) {
      len = this._transcript.length;
      await new Promise(r => setTimeout(r, 1000));
    }
    return this._transcript.replace(/<ctrl\d+>/g, '').trim();
  }

  close() {
    this.ready = false;
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
  }
}

module.exports = { LabChat };
