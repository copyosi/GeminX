// ═══════════════════════════════════════════════════════════════════
// MiniX — live visual-critique instrument (scene-free frontend v2)
//
// Single flow:  idle → scan → MiniX roasts (audio + subtitles + red
// marks) → live debate (mic always streaming) → Rebuild → before/after.
//
// Speaks the existing server WS/HTTP protocol unchanged, plus:
//   • vision requests carry the selected mode (ui | print | art)
//   • a `rebuild` event triggers the Nano Banana redesign
// All runtime capabilities preserved: WS connect + reconnect, mic
// capture/streaming, Mini audio playback, camera, screenshot vision,
// tool-call handling, before/after slider, barge-in flush.
// ═══════════════════════════════════════════════════════════════════

'use strict';
const $ = id => document.getElementById(id);

const body       = document.body;
const video      = $('video');
const cap         = $('cap');
const marksLayer = $('marks');
const subtitles  = $('subtitles');
const subtitleText = $('subtitle-text');
const statusText = $('status-text');

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (REDUCED) body.classList.add('reduced');

// ── App state ─────────────────────────────────────────────────────
let mode        = 'print';           // ui | print | art  (default print)
let flowState   = 'idle';            // idle|scanning|live|rebuilding|reveal
let greetDone   = false;
let showMeSent  = false;
let lastFrame   = null;              // last captured jpeg dataURL (the "before")
let nanoReady   = false;
let stream      = null;              // camera MediaStream
let showMeFallbackTimer = null;

function setState(s) {
  flowState = s;
  body.classList.remove('state-idle','state-scanning','state-live','state-rebuilding','state-reveal');
  body.classList.add(`state-${s}`);
}

// ═══════════════════════════════════════════════════════════════════
// WEBSOCKET — connect + auto-reconnect
// ═══════════════════════════════════════════════════════════════════
let ws, retries = 0;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen    = () => { retries = 0; status('ready'); };
  ws.onmessage = e => { try { dispatch(JSON.parse(e.data)); } catch { /* ignore */ } };
  ws.onclose   = () => {
    status('reconnecting');
    if (++retries < 20) setTimeout(connectWS, 2000 + Math.min(retries * 500, 5000));
    else status('offline');
  };
  ws.onerror   = () => {};
}
function send(o) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); }
connectWS();

function status(s) {
  const labels = {
    ready: 'ready', reconnecting: 'reconnecting', offline: 'offline',
    scanning: 'scanning', live: 'live', rebuilding: 'rebuilding', done: 'done',
  };
  if (statusText) statusText.textContent = labels[s] || s;
}

// ═══════════════════════════════════════════════════════════════════
// SERVER → CLIENT dispatch
// ═══════════════════════════════════════════════════════════════════
function dispatch(ev) {
  switch (ev.event) {
    case 'init':            break;                       // fresh session on server
    case 'phase_change':    onPhase(ev.phase); break;
    case 'greet_done':      onGreetDone(); break;
    case 'agent_text':      break;                       // subtitles come from mini_transcript
    case 'mini_transcript': showSubtitle(ev.text); break;
    case 'agent_turn_end':  fadeSubtitle(); break;
    case 'audio_chunk':     playPCM(ev.data); break;
    case 'flush_audio':     flushAudio(); break;         // barge-in — user spoke over Mini
    case 'tool_execution':  onTool(ev); break;
    case 'mode_change':     applyMode(ev.mode); break;   // MiniX chose the eye via set_mode
    case 'vision_result':   onVisionResult(ev); break;
    case 'build_generating':onBuildStart(); break;
    case 'image_result':    onImage(ev); break;
    case 'nano_banana_failed': onNanoFailed(); break;
    case 'chapter':         break;                       // legacy card — no chrome in v2
    case 'credits_start':   break;                       // legacy — not part of v2 flow
    default:                break;
  }
}

function onPhase(phase) {
  if (phase === 'roast')       { status('live');    if (flowState === 'scanning') setState('live'); }
  else if (phase === 'build')  { status('rebuilding'); }
  else if (phase === 'credits'){ status('done'); }
}

// ═══════════════════════════════════════════════════════════════════
// FLOW — the single path
// ═══════════════════════════════════════════════════════════════════
async function startScan() {
  if (flowState !== 'idle') return;
  setState('scanning');
  status('scanning');
  hideVerdict();
  clearMarks();

  // 1. Unlock audio (this call is a user gesture) + camera/mic.
  ensureAudioCtx();
  await startMedia();

  // 2. Connect Mini + greet (Mini's WS connects on this event).
  greetDone = false; showMeSent = false;
  send({ event: 'greet' });

  // 3. Prefetch a vision scan of the current frame with the selected mode.
  //    The server caches it; `show_me` consumes it so Mini roasts with
  //    real coordinates the instant she's ready.
  prefetchVision();

  // 4. When Mini's greeting finishes → show_me. Fallback if greet never
  //    arrives (e.g. no live key) so the scan visuals still resolve.
  clearTimeout(showMeFallbackTimer);
  showMeFallbackTimer = setTimeout(() => { if (!showMeSent) sendShowMe(); }, 5000);
}

function onGreetDone() {
  greetDone = true;
  sendShowMe();
}

function sendShowMe() {
  if (showMeSent) return;
  showMeSent = true;
  clearTimeout(showMeFallbackTimer);
  send({ event: 'show_me' });
  body.classList.add('mic-live');   // bidirectional debate is now open
  status('live');
}

function startRebuild() {
  if (flowState !== 'live') return;
  setState('rebuilding');
  status('rebuilding');
  nanoReady = false;
  clearMarks();
  hideSubtitle();
  body.classList.remove('mic-live');
  $('btn-rebuild').hidden = true;
  captureBefore();
  send({ event: 'rebuild' });       // → orchestrator._startBuild() → Nano Banana
}

function resetAll() {
  setState('idle');
  status('ready');
  greetDone = false; showMeSent = false; nanoReady = false;
  clearTimeout(showMeFallbackTimer);
  flushAudio();
  clearMarks();
  hideSubtitle();
  hideVerdict();
  body.classList.remove('mic-live');
  $('btn-scan').hidden = false;
  $('btn-rebuild').hidden = true;
  $('btn-reset').hidden = true;
  $('reveal').classList.remove('on');
  send({ event: 'reset' });         // fresh Mini session on server
}

// ── Buttons ──
$('btn-scan').addEventListener('click', startScan);
$('btn-rebuild').addEventListener('click', startRebuild);
$('btn-reset').addEventListener('click', resetAll);

// ── Mode picker ──
function applyMode(m) {
  if (!['ui', 'print', 'art'].includes(m)) return;
  mode = m;
  body.dataset.mode = mode;
  document.querySelectorAll('#modes button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('medium-mode').textContent = mode === 'ui' ? 'interface' : mode;
}
document.querySelectorAll('#modes button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (flowState !== 'idle') return;               // lock manual picks once live (MiniX can still set_mode)
    applyMode(btn.dataset.mode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CAMERA + MEDIA
// ═══════════════════════════════════════════════════════════════════
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Warm up permissions early so the Scan tap is instant (best-effort).
(async function earlyPermissions() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });
    s.getTracks().forEach(t => (t.enabled = false));
    window._warmStream = s;
  } catch { /* permission granted on Scan instead */ }
})();

async function startMedia() {
  if (stream && stream.getVideoTracks().length && stream.getVideoTracks()[0].readyState === 'live') return;

  // Reuse a warmed stream if we have one.
  if (window._warmStream) {
    stream = window._warmStream; window._warmStream = null;
    stream.getTracks().forEach(t => (t.enabled = true));
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 5, max: 12 } },
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
    } catch (e) {
      // Camera denied — try audio-only so the debate still works.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
        });
      } catch { console.warn('[Media] no camera or mic:', e.message); return; }
    }
  }

  if (stream.getVideoTracks().length) {
    video.srcObject = stream;
    try { await video.play(); } catch { /* autoplay policies */ }
    stream.getVideoTracks()[0].onended = () => { setState('idle'); };
    positionMarks();
  }
  if (stream.getAudioTracks().length) startMicCapture(stream);
  startAudioHealthCheck();
}

// ═══════════════════════════════════════════════════════════════════
// VISION — screenshot → server (carries mode)
// ═══════════════════════════════════════════════════════════════════
function grabFrame() {
  if (!video.videoWidth) return null;
  cap.width  = video.videoWidth;
  cap.height = video.videoHeight;
  cap.getContext('2d').drawImage(video, 0, 0, cap.width, cap.height);
  const url = cap.toDataURL('image/jpeg', 0.9);
  lastFrame = url;
  return url.split(',')[1];
}

async function prefetchVision(attempt = 0) {
  const b64 = grabFrame();
  if (!b64) {
    if (attempt < 5) setTimeout(() => prefetchVision(attempt + 1), 700);
    return;
  }
  try {
    await fetch('/api/vision-prefetch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: b64, mode }),
    });
  } catch (e) { console.warn('[Vision] prefetch failed:', e.message); }
}

// ═══════════════════════════════════════════════════════════════════
// VISION RESULT — verdict + first pass of red marks
// ═══════════════════════════════════════════════════════════════════
function onVisionResult(ev) {
  const issues = ev.issues || [];
  showVerdict(ev.score, ev.worst);
  // Drop quiet marks where the scan found issues; Mini emphasizes them
  // live as she points via annotate_at.
  clearMarks();
  issues.slice(0, 5).forEach((iss, i) => {
    setTimeout(() => addMark(iss.x, iss.y, iss.label, 'scan'), 260 * i);
  });
  if (flowState === 'scanning') setState('live');
}

function showVerdict(score, worst) {
  if (score == null) return;
  $('score').textContent = String(score);
  $('worst').textContent = worst ? worst : '';
  $('verdict').setAttribute('aria-hidden', 'false');
  body.classList.add('has-verdict');
  // Offer the Rebuild action once there's a critique on the table.
  $('btn-scan').hidden = true;
  $('btn-rebuild').hidden = false;
  $('btn-reset').hidden = false;
}
function hideVerdict() { body.classList.remove('has-verdict'); $('verdict').setAttribute('aria-hidden', 'true'); }

// ═══════════════════════════════════════════════════════════════════
// CRITIQUE MARKS — an editor's red pen on a proof
// ═══════════════════════════════════════════════════════════════════
// Legacy enum targets (annotate_ui) → approximate frame positions so
// nothing breaks when Mini uses the old tool.
const LEGACY_TARGET = {
  dead_space: { x: 72, y: 45 }, cta: { x: 50, y: 30 }, sidebar: { x: 12, y: 22 },
  buttons: { x: 50, y: 55 }, search: { x: 50, y: 88 }, logo: { x: 14, y: 12 },
  headline: { x: 50, y: 22 }, copy: { x: 50, y: 60 }, brand: { x: 82, y: 88 },
  clear: null,
};

function onTool(ev) {
  const name = ev.tool_name;
  const a = ev.args || {};
  if (name === 'annotate_at') {
    addMark(a.x, a.y, a.label, 'pen');
  } else if (name === 'annotate_ui') {
    if (a.target === 'clear' || a.action === 'clear') clearMarks();
    else {
      const pos = LEGACY_TARGET[a.target];
      if (pos) addMark(pos.x, pos.y, a.label, 'pen');
    }
  }
  // render_new_ui: acknowledged (HTML preview retired in v2 — Nano Banana
  // image is the rebuild surface). Ack every tool so Mini isn't blocked.
  ack(ev.callId, name);
}

function ack(callId, toolName) {
  send({ event: 'tool_completed', callId, toolName, status: 'ok' });
}

const SVGNS = 'http://www.w3.org/2000/svg';
let markCount = 0;

// Place the marks layer over the actual letterboxed video content rect,
// so x/y percentages land on the artwork, not the black mat.
function videoContentRect() {
  const cw = video.clientWidth, ch = video.clientHeight;
  const vw = video.videoWidth  || 16, vh = video.videoHeight || 9;
  const scale = Math.min(cw / vw, ch / vh);
  const w = vw * scale, h = vh * scale;
  return { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
}
function positionMarks() {
  const r = videoContentRect();
  marksLayer.style.left   = r.left + 'px';
  marksLayer.style.top    = r.top + 'px';
  marksLayer.style.width  = r.width + 'px';
  marksLayer.style.height = r.height + 'px';
}
window.addEventListener('resize', positionMarks);

function addMark(x, y, label, kind = 'pen') {
  if (x == null || y == null) return;
  positionMarks();
  x = Math.max(2, Math.min(98, Number(x)));
  y = Math.max(2, Math.min(98, Number(y)));

  const wrap = document.createElement('div');
  wrap.className = 'mark';
  wrap.style.cssText = `position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-50%);`;

  // Hand-drawn red circle (SVG stroke, draw-on).
  const S = 96;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', S); svg.setAttribute('height', S);
  svg.setAttribute('viewBox', '0 0 96 96');
  // faint dark separation so the red loop reads on light or busy artwork
  svg.style.cssText = 'display:block;overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.55));';
  const ell = document.createElementNS(SVGNS, 'path');
  // slightly irregular ellipse → reads as a pen loop, not a UI badge
  ell.setAttribute('d', 'M48 8 C74 8 90 26 90 48 C90 72 70 90 47 90 C22 90 6 70 6 47 C6 24 24 8 48 8 Z');
  ell.setAttribute('fill', 'none');
  ell.setAttribute('stroke', 'var(--red)');
  ell.setAttribute('stroke-width', kind === 'pen' ? '2.6' : '2');
  ell.setAttribute('stroke-linecap', 'round');
  if (kind === 'scan') ell.setAttribute('opacity', '0.7');
  svg.appendChild(ell);
  wrap.appendChild(svg);

  // draw-on animation
  if (!REDUCED) {
    const len = ell.getTotalLength ? ell.getTotalLength() : 300;
    ell.style.strokeDasharray = String(len);
    ell.style.strokeDashoffset = String(len);
    ell.style.transition = 'stroke-dashoffset 620ms cubic-bezier(.22,.61,.36,1)';
    requestAnimationFrame(() => { ell.style.strokeDashoffset = '0'; });
  }

  if (label) {
    const lbl = document.createElement('div');
    const rtl = isRTL(label);
    lbl.textContent = label;
    lbl.style.cssText =
      'position:absolute;top:50%;transform:translateY(-50%);white-space:nowrap;' +
      'font-family:var(--mono);font-size:10px;letter-spacing:0.14em;text-transform:uppercase;' +
      'color:#fff;background:var(--red-ink);padding:3px 7px;border-radius:2px;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.5);opacity:0;transition:opacity 300ms ease 320ms;';
    // place label on the side with more room
    if (x > 55) { lbl.style.right = '58px'; lbl.style.textAlign = 'right'; }
    else        { lbl.style.left  = '58px'; }
    if (rtl) lbl.dir = 'rtl';
    wrap.appendChild(lbl);
    requestAnimationFrame(() => { lbl.style.opacity = kind === 'scan' ? '0.7' : '1'; });
  }

  marksLayer.appendChild(wrap);
  markCount++;

  // A live pen mark supersedes older ones for focus; keep at most a few.
  const all = marksLayer.querySelectorAll('.mark');
  if (all.length > 6) all[0].remove();

  // Pen marks fade after a beat so they feel like live annotation.
  if (kind === 'pen') setTimeout(() => { wrap.style.transition = 'opacity 800ms ease'; wrap.style.opacity = '0'; setTimeout(() => wrap.remove(), 850); }, 7000);
}

function clearMarks() { marksLayer.innerHTML = ''; markCount = 0; }

// ═══════════════════════════════════════════════════════════════════
// SUBTITLES — cinematic, RTL-aware, max 2 lines
// ═══════════════════════════════════════════════════════════════════
let subSentence = '';
let subTimer = null;
function isRTL(t) { return /[֐-׿؀-ۿ]/.test(t || ''); }

function showSubtitle(text) {
  if (!text) return;
  subSentence += text;
  const trimmed = subSentence.trim();

  // keep the last sentence(s) that fit ~150 chars
  const sentences = trimmed.split(/(?<=[.!?…])\s+/);
  let display = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    const cand = sentences.slice(i).join(' ');
    if (cand.length <= 150) display = cand; else break;
  }
  if (!display) display = sentences[sentences.length - 1] || trimmed;
  if (display.length > 150) display = '…' + display.slice(-149);

  const rtl = isRTL(display);
  subtitles.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  subtitleText.textContent = display;
  subtitles.classList.add('visible');

  clearTimeout(subTimer);
  subTimer = setTimeout(() => { subtitles.classList.remove('visible'); subSentence = ''; }, 11000);
}
function fadeSubtitle() {
  clearTimeout(subTimer);
  subTimer = setTimeout(() => { subtitles.classList.remove('visible'); subSentence = ''; }, 5000);
}
function hideSubtitle() {
  subtitles.classList.remove('visible');
  clearTimeout(subTimer);
  subSentence = '';
}

// ═══════════════════════════════════════════════════════════════════
// REBUILD — Nano Banana image → before/after
// ═══════════════════════════════════════════════════════════════════
function captureBefore() {
  // Freeze the current frame as the "before" plate.
  if (!lastFrame) grabFrame();
  if (lastFrame) $('before-img').src = lastFrame;
}
function onBuildStart() { status('rebuilding'); }

function onImage(ev) {
  nanoReady = true;
  $('after-img').src = `data:${ev.mimeType || 'image/png'};base64,${ev.data}`;
  openReveal();
}
function onNanoFailed() {
  console.warn('[Rebuild] Nano Banana failed');
  // Iron rule: visible failure, never a silent shrug. Say it, then return
  // to the live critique so the session continues.
  showNotice('rebuild failed — no image generated');
  status('live');
  setState('live');
  $('btn-rebuild').hidden = false;
}

// ── Notice: a short, visible failure line (gallery mono, critique red) ──
let noticeTimer = null;
function showNotice(text) {
  const n = $('notice');
  if (!n) return;
  n.textContent = text;
  n.classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => n.classList.remove('visible'), 6000);
}

function openReveal() {
  setState('reveal');
  status('done');
  const rv = $('reveal');
  rv.classList.add('on');
  rv.style.setProperty('--pos', '100%');
  // sweep from before → after, settle at center
  if (REDUCED) { rv.style.setProperty('--pos', '50%'); }
  else {
    let pos = 100; let phase = 'reveal';
    const step = () => {
      if (phase === 'reveal') {
        pos -= 1.4;
        if (pos <= 0) { pos = 0; phase = 'hold'; setTimeout(() => { phase = 'return'; requestAnimationFrame(step); }, 1200); }
        rv.style.setProperty('--pos', `${pos}%`);
        if (phase === 'reveal') requestAnimationFrame(step);
      } else if (phase === 'return') {
        pos += 0.9; if (pos >= 50) pos = 50;
        rv.style.setProperty('--pos', `${pos}%`);
        if (pos < 50) requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }
  $('btn-reset').hidden = false;
  $('btn-rebuild').hidden = true;
}

// Draggable before/after handle
(function initSlider() {
  const rv = $('reveal'), handle = $('rv-handle');
  let dragging = false;
  const setPos = clientX => {
    const r = rv.getBoundingClientRect();
    let pct = ((clientX - r.left) / r.width) * 100;
    pct = Math.max(0, Math.min(100, pct));
    rv.style.setProperty('--pos', `${pct}%`);
  };
  handle.addEventListener('pointerdown', e => { dragging = true; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
  handle.addEventListener('pointermove', e => { if (dragging) setPos(e.clientX); });
  handle.addEventListener('pointerup',   () => { dragging = false; });
  handle.addEventListener('pointercancel',() => { dragging = false; });
  rv.addEventListener('pointerdown', e => { if (e.target === handle) return; setPos(e.clientX); });
})();

// ═══════════════════════════════════════════════════════════════════
// MIC CAPTURE — bidirectional audio → Mini (16kHz PCM16, 40ms chunks)
// ═══════════════════════════════════════════════════════════════════
let micStream = null, micCtx = null, micProcessor = null;

function startMicCapture(existingStream) {
  const track = existingStream && existingStream.getAudioTracks()[0];
  if (!track) { console.warn('[Mic] no audio track'); return; }
  if (micProcessor) return;                     // already capturing

  micStream = new MediaStream([track]);
  micCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = micCtx.createMediaStreamSource(micStream);
  const gain = micCtx.createGain(); gain.gain.value = 4.0;  // EC/NS eat volume
  source.connect(gain);

  micProcessor = micCtx.createScriptProcessor(256, 1, 1);
  const targetRate = 16000, CHUNK = 640;        // 40ms @ 16kHz
  const ratio = micCtx.sampleRate / targetRate;
  let acc = new Int16Array(CHUNK), idx = 0;

  micProcessor.onaudioprocess = e => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    const outLen = Math.floor(input.length / ratio);
    for (let i = 0; i < outLen; i++) {
      const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
      acc[idx++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      if (idx >= CHUNK) {
        const bytes = new Uint8Array(acc.buffer);
        let bin = '';
        for (let j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]);
        send({ event: 'audio_input', data: btoa(bin) });
        idx = 0; acc = new Int16Array(CHUNK);
      }
    }
  };
  gain.connect(micProcessor);
  micProcessor.connect(micCtx.destination);     // required for ScriptProcessor to fire
  console.log(`[Mic] ${micCtx.sampleRate}Hz → 16kHz, 40ms chunks`);
}

function stopMicCapture() {
  if (micProcessor) micProcessor.disconnect();
  if (micCtx) micCtx.close().catch(() => {});
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  micProcessor = null; micCtx = null; micStream = null;
}

// ═══════════════════════════════════════════════════════════════════
// AUDIO PLAYBACK — Mini's voice, PCM16-LE @ 24kHz, gapless, iOS-safe
// ═══════════════════════════════════════════════════════════════════
let audioCtx = null, nextStart = 0, pcmQueue = [], resuming = false;
let activeSources = [], outGain = null;

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    outGain = audioCtx.createGain(); outGain.gain.value = 3.0;   // volume boost
    outGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended' && !resuming) {
    resuming = true;
    audioCtx.resume().then(() => {
      try {
        const sil = audioCtx.createBuffer(1, 1, 24000);
        const s = audioCtx.createBufferSource(); s.buffer = sil; s.connect(audioCtx.destination); s.start();
      } catch {}
      resuming = false;
      while (pcmQueue.length) schedulePCM(pcmQueue.shift());
    });
  }
  return audioCtx;
}
// Unlock on any user gesture (iOS)
['click','touchend','pointerdown','keydown'].forEach(ev =>
  document.addEventListener(ev, ensureAudioCtx, { passive: true }));

function decodePCM(b64) {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const f32 = new Float32Array(bytes.length / 2);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < f32.length; i++) f32[i] = dv.getInt16(i * 2, true) / 32768;
  return f32;
}
function schedulePCM(f32) {
  const ctx = ensureAudioCtx();
  if (!ctx || ctx.state !== 'running') { pcmQueue.push(f32); return; }
  nextStart = Math.max(nextStart, ctx.currentTime);
  const buf = ctx.createBuffer(1, f32.length, 24000);
  buf.getChannelData(0).set(f32);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(outGain || ctx.destination);
  src.start(nextStart); nextStart += buf.duration;
  activeSources.push(src);
  src.onended = () => { activeSources = activeSources.filter(s => s !== src); };
}
function playPCM(b64) {
  if (!b64) return;
  const ctx = ensureAudioCtx();
  const f32 = decodePCM(b64);
  if (!ctx || ctx.state !== 'running') { pcmQueue.push(f32); return; }
  schedulePCM(f32);
}
function flushAudio() {
  pcmQueue.length = 0;
  for (const s of activeSources) { try { s.stop(); } catch {} }
  activeSources = []; nextStart = 0;
}

// iOS randomly suspends the context — keep it alive.
let audioHealthTimer = null;
function startAudioHealthCheck() {
  clearInterval(audioHealthTimer);
  audioHealthTimer = setInterval(async () => {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
        const sil = audioCtx.createBuffer(1, 1, 24000);
        const s = audioCtx.createBufferSource(); s.buffer = sil; s.connect(audioCtx.destination); s.start();
        while (pcmQueue.length) schedulePCM(pcmQueue.shift());
      } catch {}
    }
  }, 2000);
}

// ── Agent connection dots via /health (kept from protocol) ──
setInterval(async () => {
  try {
    const h = await fetch('/health').then(r => r.json());
    if (flowState === 'idle') status(h.agents && h.agents.mini === 'connected' ? 'ready' : 'ready');
  } catch {}
}, 12000);

window.addEventListener('beforeunload', () => { stopMicCapture(); });
