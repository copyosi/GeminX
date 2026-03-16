// MiniX — Cinematic Edition
// VOID → ROAST → BUILD → CREDITS

const $ = id => document.getElementById(id);
const screens = {
  void: $('screen-void'), scan: $('screen-scan'),
  rebuild: $('screen-rebuild'), curtain: $('screen-curtain'),
};
// Alias: "scan" screen IS "stage" — same HTML, different name
const stage = screens.scan;

const video = $('screenVideo');
const offCanvas = $('offCanvas');
const annoLayer = $('annoLayer');
const scanRing = $('scan-ring');
const scanMini = $('scan-mini');
const scanJam = $('scan-jam');
const preview = $('previewFrame');
const genImg = $('generatedImg');
const transcript = $('transcript');
const glowL = $('glow-l');
const glowR = $('glow-r');
const badge = $('round-badge');
const rebuildProg = $('rebuild-progress');
const scanStatus = $('scan-status');
const scanAgents = $('scan-agents');
const greetLayer = $('greet-layer');
const chapterCard = $('chapter-card');
const chapterNumber = $('chapter-number');
const chapterTitle = $('chapter-title');
const orchLogBody = $('orch-log-body');

// Netflix subtitles
const subtitleBar = $('subtitle-bar');
const subtitleSpeaker = $('subtitle-speaker');
const subtitleText = $('subtitle-text');
let _subtitleTimer = null;

let currentScreen = 'void';
let _currentPhase = 'void';
let _greetDone = false;  // true after Mini's greet dialogue completes
let stream = null;
let visionTimer = null;
let interval = 1000;
let speaking = null;
let glowTimer = null;
let lastFrame = null;
let focusTimer = null;
let nanoBananaReady = false;  // true once Nano Banana image arrived — skip HTML fallback
let FX_MUTED = false;        // visual effects ON (rings, annotations, overlays)
let greetBuf = '';            // accumulates Mini's greet text
let greetWordIdx = 0;         // tracks which words are already displayed
let _totalIssues = 0;         // credits: total issues found
let _totalRounds = 0;         // credits: total rounds completed

// ── Production mode: hide dev tools on Cloud Run ──
const IS_PROD = !['localhost','127.0.0.1'].includes(location.hostname);
if (IS_PROD) {
  document.getElementById('timeline-timer')?.classList.add('prod-hidden');
}

// ── VIDEO MODE: play pre-recorded video instead of live camera ──
// Set to filename (e.g. 'dolly.mp4') to use pre-recorded video, or null for live camera
const VIDEO_MODE = null; // DEMO: live camera/screen share — new video TBD

// ── Music: Pixies "Hey" covers vision wait ──────────────────────
const MUSIC_MODE = null; // MUTED for testing — was 'brake'
const musicPlayback = new Audio('hey-playback.m4a');
const musicBrake    = new Audio('hey-brake.m4a');
musicPlayback.preload = 'auto';
musicBrake.preload    = 'auto';
let musicEl = null;           // active audio element
let musicDucked = false;      // true after Mini starts talking
let _brakeBuffer = [];        // audio chunks buffered while brake music plays
let _brakeBuffering = false;  // true = buffer audio, don't play yet

// ── iOS / iPadOS detection ──────────────────────────────────────
// iPad reports as "MacIntel" but real Macs have maxTouchPoints 0-1.
// Don't check (hover: none) — iPadOS 17+ reports hover:hover even without keyboard.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ── Gemini sparkle SVG ──────────────────────────────────────────
function sparkleSVG(color) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 't-sparkle glow-anim');
  svg.style.color = color;
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M8 0C8 4.4 4.4 8 0 8C4.4 8 8 11.6 8 16C8 11.6 11.6 8 16 8C11.6 8 8 4.4 8 0Z');
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

// ── WebSocket ───────────────────────────────────────────────────
let ws, retries = 0;
function connectWS() {
  const p = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${p}://${location.host}/ws`);
  ws.onopen = () => { retries = 0; status('ready'); };
  ws.onmessage = e => { try { dispatch(JSON.parse(e.data)); } catch { } };
  ws.onclose = () => {
    status('reconnecting');
    if (++retries < 20) setTimeout(connectWS, 2000 + Math.min(retries * 500, 5000));
    else status('offline');
  };
  ws.onerror = () => { };
}
connectWS();
function send(o) { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); }

// ── Request permissions on page load (not on START) ──────────────
// Avoids permission dialogs interrupting recording
(async function earlyPermissions() {
  try {
    // Only request permissions — AudioContext needs user gesture (START button)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 5, max: 10 } },
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
    });
    // Keep tracks alive so permissions persist, stop them from consuming resources
    stream.getTracks().forEach(t => t.enabled = false);
    window._earlyStream = stream;
    console.log('[EarlyPerms] ✔ Camera + mic permissions granted');
  } catch (e) { console.warn('[EarlyPerms]', e.message); }
})();

// ── Status ──────────────────────────────────────────────────────
function status(s) {
  const el = $('conn-status'); if (!el) return;
  const m = {
    ready: ['READY', 'rgba(34,197,94,0.4)'],
    reconnecting: ['RECONNECTING…', 'rgba(251,191,36,0.35)'],
    offline: ['OFFLINE', 'rgba(239,68,68,0.35)'],
    live: ['SCANNING', 'rgba(168,85,247,0.4)'],
  };
  const [t, c] = m[s] || [s.toUpperCase(), 'rgba(255,255,255,0.15)'];
  el.textContent = t; el.style.color = c;
}

// ── Screens ─────────────────────────────────────────────────────
function go(name) {
  if (!screens[name]) return;
  currentScreen = name;
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');

  // Reset ring state when entering scan screen
  if (name === 'scan') {
    const sc = document.querySelector('.scan-capture');
    if (sc) {
      sc.classList.remove('intro-scan');
      // Keep B&W — color only inside ring
    }
    // Show pipeline after a beat
    setTimeout(() => pipelineShow(), 2000);
    // Show brand watermark + viewfinder
    setTimeout(() => {
      document.querySelector('.scan-brand')?.classList.add('visible');
      $('scan-frame')?.classList.add('visible');
    }, 2500);
    // Start lyrics sync if music is playing
    if (musicEl && !musicEl.paused) startLyricsSync();
  }
}

// ── Pipeline circles: MiniX → Banana → Lyria ──────────────────
function pipelineShow() {
  const el = document.getElementById('pipeline');
  if (el) el.classList.add('visible');
}
function pipelineActivate(nodeId, lineId) {
  const node = document.getElementById(nodeId);
  const line = lineId ? document.getElementById(lineId) : null;
  if (node) node.classList.add('active');
  if (line) line.classList.add('flowing');
}

// ── Jam Dot Animation — Silent Observer slides to pipeline icons ──
function jamSlideTo(targetId) {
  const jamDot = $('scan-jam');
  const target = document.getElementById(targetId);
  if (!jamDot || !target) return;

  // Get target position relative to viewport
  const tRect = target.getBoundingClientRect();
  const scanCapture = document.querySelector('.scan-capture');
  if (!scanCapture) return;
  const sRect = scanCapture.getBoundingClientRect();

  // Convert target center to percentage of scan-capture
  const tx = ((tRect.left + tRect.width / 2 - sRect.left) / sRect.width) * 100;
  const ty = ((tRect.top + tRect.height / 2 - sRect.top) / sRect.height) * 100;

  // Add sliding class for smooth transition
  jamDot.classList.add('jam-sliding');
  jamDot.style.left = `${tx}%`;
  jamDot.style.top = `${ty}%`;

  // On arrival: pulse glow, then fade
  setTimeout(() => {
    jamDot.classList.remove('jam-sliding');
    jamDot.classList.add('jam-arrived');
    // Make target icon glow
    target.classList.add('active');
    setTimeout(() => {
      jamDot.classList.remove('jam-arrived');
      jamDot.style.opacity = '0.3';
    }, 1200);
  }, 1000);

  console.log(`[Jam] Dot slides to ${targetId}`);
}

// ── Lyrics Sync — "Hey" by Pixies, timed to music ──────────────────
// FORMAT: { t: seconds into song, text: 'lyric line' }
// Yosef: fill in the actual lyrics + timestamps. Empty text = hide lyric.
const LYRICS = [
  // ── FILL IN LYRICS HERE ──
  // Example format:
  // { t: 0.0,  text: '' },
  // { t: 3.5,  text: 'First line...' },
  // { t: 7.2,  text: 'Second line...' },
  // { t: 11.0, text: '' },  // ← empty = clear lyrics
];

let _lyricsTimer = null;
let _lastLyricIdx = -1;
const lyricsBar = $('lyrics-bar');
const lyricsText = $('lyrics-text');

function startLyricsSync() {
  if (!musicEl || LYRICS.length === 0) return;
  if (_lyricsTimer) clearInterval(_lyricsTimer);
  _lastLyricIdx = -1;

  lyricsBar?.classList.add('visible');
  console.log(`[Lyrics] ▶ Sync started (${LYRICS.length} cues)`);

  _lyricsTimer = setInterval(() => {
    if (!musicEl || musicEl.paused) return;
    const t = musicEl.currentTime;

    // Find the latest lyric cue that's <= current time
    let idx = -1;
    for (let i = LYRICS.length - 1; i >= 0; i--) {
      if (LYRICS[i].t <= t) { idx = i; break; }
    }

    if (idx !== _lastLyricIdx) {
      _lastLyricIdx = idx;
      if (idx >= 0 && LYRICS[idx].text) {
        if (lyricsText) lyricsText.textContent = LYRICS[idx].text;
        lyricsBar?.classList.add('visible');
      } else {
        lyricsBar?.classList.remove('visible');
      }
    }
  }, 100); // 10fps check — smooth enough for lyrics
}

function stopLyricsSync() {
  if (_lyricsTimer) { clearInterval(_lyricsTimer); _lyricsTimer = null; }
  lyricsBar?.classList.remove('visible');
  _lastLyricIdx = -1;
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const m = { '1': 'void', '2': 'scan', '3': 'rebuild', '4': 'curtain' };
  if (m[e.key]) return go(m[e.key]);
  if ((e.key === ' ' || e.key === 'Enter') && currentScreen === 'void') {
    e.preventDefault();
    // Simulate tap on void screen
    $('screen-void')?.click();
  }
  if ((e.key === ' ' || e.key === 'Enter') && waitingForAdvance) {
    e.preventDefault(); advanceScene();
  }
  if (e.key === 'd' || e.key === 'D') downloadDebate();
});

// ── Download Debate Transcript ──────────────────────────────────
function downloadDebate() {
  if (!debateLog.length) return console.log('[DL] No debate to download yet');
  const lines = debateLog.map(e => `[${e.agent}] ${e.text}`).join('\n\n');
  const blob = new Blob([lines], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `debate-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  console.log(`[DL] Downloaded ${debateLog.length} turns`);
}

// Floating download button (bottom-left, subtle)
(function addDLBtn() {
  const btn = document.createElement('div');
  btn.id = 'dl-debate';
  btn.textContent = '↓';
  btn.title = 'Download debate transcript';
  btn.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:9999;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);font:16px system-ui;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:opacity .2s;opacity:0.3;';
  btn.addEventListener('mouseenter', () => btn.style.opacity = '1');
  btn.addEventListener('mouseleave', () => btn.style.opacity = '0.3');
  btn.addEventListener('click', downloadDebate);
  btn.addEventListener('touchend', e => { e.preventDefault(); downloadDebate(); });
  document.body.appendChild(btn);
})();

// ── HOOK: "hey" + orbiting ball → tap → sentence + CTA ──
let greetActive = false;

function revealSentence() {
  if (greetActive) return;
  greetActive = true;
  hookTapHint?.classList.add('hidden');
  greetLayer?.classList.add('active');
  // Title already in HTML — just ensure CTA is visible
  greetCta?.classList.add('visible');
}

// VOID — "MiniX presents" + tagline visible from start
setTimeout(() => {
  greetLayer?.classList.add('active');
}, 800);

// ── TAP to begin — THE single action: music + greet + scan ──────────
let _tapStarted = false;
function handleTapToBegin() {
  if (_tapStarted) return;
  _tapStarted = true;

  // Start music
  musicEl = MUSIC_MODE === 'playback' ? musicPlayback : musicBrake;
  musicEl.currentTime = 0;
  musicEl.volume = 1.0;
  musicDucked = false;
  musicEl.play().catch(e => console.warn('[Music] autoplay blocked:', e));
  window._musicStartTime = performance.now();

  // Start timeline timer
  const timerEl = document.getElementById('timeline-timer');
  if (timerEl) {
    const t0 = performance.now();
    timerEl.classList.add('running');
    window._timelineInterval = setInterval(() => {
      timerEl.textContent = ((performance.now() - t0) / 1000).toFixed(1);
    }, 100);
  }

  // Fade dots out
  const dotMini = $('void-ring-mini');
  const dotJam = $('void-ring-jam');
  if (dotMini) { dotMini.style.transition = 'opacity 0.8s ease'; dotMini.style.opacity = '0'; }
  if (dotJam) { dotJam.style.transition = 'opacity 0.8s ease'; dotJam.style.opacity = '0'; }

  // Hide tap hint
  $('void-tap-hint')?.classList.add('hidden');

  // Tell server: start greet phase (Mini says "Hey Yosef" — bidirectional)
  send({ event: 'greet' });
  // show_me is sent later: either from greet_done or brake ended handler

  // Fade void screen
  const voidScreen = $('screen-void');
  if (voidScreen) voidScreen.style.transition = 'opacity 1.2s ease';

  console.log('[TAP] ▶ Music + Greet + Scan');
  startCapture();
}

// Tap-to-begin DISABLED — scene nav buttons control everything now
// $('screen-void')?.addEventListener('click', handleTapToBegin);

async function startCapture() {
  try {
    // ── VIDEO MODE: start video on SHOW US click ──
    if (VIDEO_MODE) {
      console.log(`[VideoMode] SHOW US → starting video + audio + vision`);
      // Start video
      video.srcObject = null;
      video.src = VIDEO_MODE;
      video.muted = true;
      video.playsInline = true;
      video.loop = false;
      stream = 'video-mode';
      video.play().catch(e => console.warn('[VideoMode] autoplay:', e));
      document.body.classList.add('camera-mode');
      video.addEventListener('ended', () => {
        console.log('[VideoMode] Video ended — looping');
        video.currentTime = 0;
        video.play();
      }, { once: false });
      // AudioContext setup (SHOW US click = user gesture for iOS unlock)
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx) audioCtx = new AudioCtxClass({ sampleRate: 24000 });
      const unlockBuf = audioCtx.createBuffer(1, 1, 22050);
      const unlockSrc = audioCtx.createBufferSource();
      unlockSrc.buffer = unlockBuf; unlockSrc.connect(audioCtx.destination); unlockSrc.start(0);
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      // Lyria context
      if (!songCtx) {
        songCtx = new AudioCtxClass({ sampleRate: 48000 });
        songGain = songCtx.createGain(); songGain.gain.value = 0.65; songGain.connect(songCtx.destination);
        const silSong = songCtx.createBuffer(1, 1, 48000);
        const silSrc = songCtx.createBufferSource(); silSrc.buffer = silSong; silSrc.connect(songCtx.destination); silSrc.start();
        if (songCtx.state === 'suspended') await songCtx.resume();
      }
      while (pcmQueue.length > 0) schedulePCM(pcmQueue.shift());
      status('live');
      setTimeout(() => go('scan'), 800);
      startAudioHealthCheck();

      // ── BIDIRECTIONAL: Capture mic even in VIDEO_MODE ──
      try {
        const micOnly = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
        });
        startMicCapture(micOnly);
        console.log('[VideoMode] Mic captured for bidirectional audio');
      } catch (e) { console.warn('[VideoMode] No mic:', e.message, '— no bidirectional'); }

      // ── BRAKE MODE: prefetch vision NOW, Mini enters when song ends ──
      if (MUSIC_MODE === 'brake' && musicEl) {
        console.log('[Brake] ♪ Song playing — prefetching vision in background');
        logEvent('♪ prefetching vision…', 'system');
        // Send first frame to prefetch IMMEDIATELY (don't wait for music)
        setTimeout(() => sendPrefetch(), 500); // 500ms = video needs a frame
        musicEl.addEventListener('ended', () => {
          console.log('[Brake] ♪ BREAK hit!');
          logEvent('♪ BREAK', 'vision');
          // If show_me was already pre-fired (prefetch succeeded), just flush buffered audio
          if (_brakeBuffering) {
            _brakeBuffering = false;
            console.log(`[Brake] Flushing ${_brakeBuffer.length} buffered audio chunks → Mini instant!`);
            for (const ev of _brakeBuffer) {
              glow(ev.agent); playPCM(ev.data);
            }
            _brakeBuffer = [];
            musicDucked = true;
          } else if (_greetDone) {
            // Greet finished during music, now send show_me
            console.log('[Brake] Greet done + music done → sending show_me');
            send({ event: 'show_me' });
          } else {
            // Neither prefetch pre-fire nor greet done yet — wait for greet_done
            console.log('[Brake] Music ended but greet not done yet — waiting for greet_done');
          }
          startVision();
        }, { once: true });
      } else {
        startVision();
      }
      return;
    }

    // ── Step 1: Request audio+video permissions FIRST (Eddy³ pattern) ──
    // On iOS, getUserMedia({audio:true}) is what truly unlocks AudioContext.
    // The permission dialog must happen BEFORE we create/resume AudioContext.
    if (isIOS) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 5, max: 10 }
        },
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
      });
      // Start mic capture for bidirectional audio (instead of killing the track)
      startMicCapture(stream);
      console.log('[iOS] getUserMedia granted (video+audio). Mic streaming to agents.');
    }

    // ── Step 2: Create AudioContext AFTER permissions (Eddy³ pattern) ──
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx) audioCtx = new AudioCtxClass({ sampleRate: 24000 });
    // Silent buffer unlock
    const unlockBuf = audioCtx.createBuffer(1, 1, 22050);
    const unlockSrc = audioCtx.createBufferSource();
    unlockSrc.buffer = unlockBuf;
    unlockSrc.connect(audioCtx.destination);
    unlockSrc.start(0);
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    console.log('[AUDIO] AudioContext created & unlocked. state:', audioCtx.state);
    updateAudioDebug();

    // ── Pre-create Lyria music context (needs user gesture on iOS) ──
    if (!songCtx) {
      songCtx = new AudioCtxClass({ sampleRate: 48000 });
      songGain = songCtx.createGain();
      songGain.gain.value = 0.65;
      songGain.connect(songCtx.destination);
      // Silent buffer to unlock
      const silSong = songCtx.createBuffer(1, 1, 48000);
      const silSrc = songCtx.createBufferSource();
      silSrc.buffer = silSong; silSrc.connect(songCtx.destination); silSrc.start();
      if (songCtx.state === 'suspended') await songCtx.resume();
      console.log('[AUDIO] Lyria songCtx pre-created. state:', songCtx.state);
    }

    // Flush any queued PCM chunks
    while (pcmQueue.length > 0) schedulePCM(pcmQueue.shift());

    if (isIOS) {
      document.body.classList.add('camera-mode');
      video.srcObject = stream;
      stream.getVideoTracks()[0].onended = stopCapture;
      status('live');
      setTimeout(() => go('scan'), 800);
      startVision();

      // ── Step 3: Start periodic AudioContext health check (iOS suspends randomly) ──
      startAudioHealthCheck();
    } else {
      // Non-iOS: try screen share first, then camera fallback
      let gotStream = false;

      // Try screen share (Mac/desktop)
      try {
        console.log('[ScreenShare] Requesting display capture...');
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 5, max: 10 } },
          audio: false
        });
        gotStream = true;
      } catch (e) {
        console.warn('[ScreenShare] Denied or failed:', e.message);
      }

      // Fallback: camera (iPad detected as Mac, or user denied screen share)
      if (!gotStream) {
        try {
          console.log('[Camera] Trying camera fallback...');
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 5, max: 10 }
            },
            audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
          });
          startMicCapture(stream);
          gotStream = true;
          console.log('[Camera] ✔ Camera mode active');
        } catch (e2) {
          console.warn('[Camera] Failed too:', e2.message);
          console.log('[AudioOnly] 🎤 No video — switching to audio-only bidirectional mode');
        }
      }

      // ── AUDIO-ONLY MODE: no video stream, but mic + bidirectional audio ──
      if (!gotStream) {
        // Get mic for bidirectional audio
        try {
          const micOnly = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
          });
          startMicCapture(micOnly);
          console.log('[AudioOnly] ✔ Mic captured — bidirectional audio active');
        } catch (e) {
          console.warn('[AudioOnly] ✖ No mic either:', e.message, '— audio playback only');
        }

        status('live');
        setTimeout(() => go('scan'), 800);
        startAudioHealthCheck();

        // ── BRAKE MODE: still register ended handler (no prefetch — no video) ──
        if (MUSIC_MODE === 'brake' && musicEl) {
          console.log('[Brake] ♪ Audio-only — waiting for music to end');
          musicEl.addEventListener('ended', () => {
            console.log('[Brake] ♪ BREAK hit! (audio-only)');
            logEvent('♪ BREAK', 'vision');
            if (_brakeBuffering) {
              _brakeBuffering = false;
              for (const ev of _brakeBuffer) { glow(ev.agent); playPCM(ev.data); }
              _brakeBuffer = [];
              musicDucked = true;
            } else if (_greetDone) {
              console.log('[Brake] Greet done + music done → sending show_me (audio-only)');
              send({ event: 'show_me' });
            } else {
              console.log('[Brake] Music ended but greet not done yet — waiting');
            }
            // No startVision() — no video stream to capture frames from
          }, { once: true });
        } else {
          // No brake — send show_me immediately after greet
          if (_greetDone) send({ event: 'show_me' });
        }
        // Skip the video-stream section below
      } else {
        // ── GOT VIDEO STREAM — normal path ──

        // Mic for screen share mode (camera mode already has mic from above)
        if (!stream.getAudioTracks().length) {
          try {
            const micOnly = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
            });
            startMicCapture(micOnly);
          } catch (e) { console.warn('[Mic] No mic:', e.message); }
        }

        // Show stream in video element
        document.body.classList.add('camera-mode');
        video.srcObject = stream;
        video.style.display = '';
        stream.getVideoTracks()[0].onended = () => {
          console.log('[Stream] User stopped');
          stopCapture();
        };

        status('live');
        setTimeout(() => go('scan'), 800);
        startAudioHealthCheck();
        console.log('[Stream] ✔ Live — agents see your screen/camera');

        // ── BRAKE MODE on desktop: prefetch + brake ended handler ──
        if (MUSIC_MODE === 'brake' && musicEl) {
          console.log('[Brake] ♪ Desktop — prefetching vision in background');
          logEvent('♪ prefetching vision…', 'system');
          // Prefetch first frame during music
          setTimeout(() => sendPrefetch(), 500);
          musicEl.addEventListener('ended', () => {
            console.log('[Brake] ♪ BREAK hit! (desktop)');
            logEvent('♪ BREAK', 'vision');
            if (_brakeBuffering) {
              _brakeBuffering = false;
              console.log(`[Brake] Flushing ${_brakeBuffer.length} buffered audio chunks`);
              for (const ev of _brakeBuffer) {
                glow(ev.agent); playPCM(ev.data);
              }
              _brakeBuffer = [];
              musicDucked = true;
            } else if (_greetDone) {
              console.log('[Brake] Greet done + music done → sending show_me');
              send({ event: 'show_me' });
            } else {
              console.log('[Brake] Music ended but greet not done yet — waiting');
            }
            // Start regular vision ticks now that music ended
            startVision();
          }, { once: true });
        } else {
          // No brake mode — start vision ticks immediately
          startVision();
        }
      }
    }
  } catch (e) { console.warn('[Capture]', e.message); }
}

// ── Scene Advance (between acts — live camera stays as-is) ───
let waitingForAdvance = false;

function advanceScene() {
  if (!waitingForAdvance) return;
  waitingForAdvance = false;
  hideAdvancePrompt();
  send({ event: 'advance_scene' });
  console.log('[Live] Scene advanced — camera stays live');
}

function showAdvancePrompt() {
  let el = document.getElementById('advance-prompt');
  if (!el) {
    el = document.createElement('div');
    el.id = 'advance-prompt';
    el.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:999;background:rgba(255,255,255,0.12);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.2);color:#fff;padding:12px 28px;border-radius:24px;font:600 15px/1.4 system-ui;cursor:pointer;animation:pulse-soft 2s infinite;';
    el.textContent = 'TAP TO CONTINUE ▸';
    el.addEventListener('click', advanceScene);
    el.addEventListener('touchend', e => { e.preventDefault(); advanceScene(); });
    document.body.appendChild(el);
  }
  el.style.display = 'block';
}

function hideAdvancePrompt() {
  const el = document.getElementById('advance-prompt');
  if (el) el.style.display = 'none';
}

function stopCapture() {
  clearInterval(visionTimer);
  stopMicCapture();
  if (stream && stream !== 'video-mode') stream.getTracks().forEach(t => t.stop());
  if (VIDEO_MODE) { video.pause(); video.src = ''; }
  stream = null; video.srcObject = null;
  video.style.display = '';
  const scanFeed = document.getElementById('scan-feed');
  if (scanFeed) scanFeed.style.backgroundImage = '';
  document.body.classList.remove('camera-mode');
  go('void'); status('ready');
}

// ── Vision (for iPad camera mode) ───────────────────────────────
function startVision() {
  clearInterval(visionTimer);
  visionTimer = setInterval(sendFrame, interval);
}
// Prefetch: send one frame to /api/vision-prefetch during music — server caches result
async function sendPrefetch() {
  if ((!stream && !VIDEO_MODE) || video.readyState < 2) {
    // Video not ready yet — retry once after 1s
    setTimeout(() => sendPrefetch(), 1000);
    return;
  }
  offCanvas.width = video.videoWidth;
  offCanvas.height = video.videoHeight;
  offCanvas.getContext('2d').drawImage(video, 0, 0);
  const url = offCanvas.toDataURL('image/jpeg', 0.9);
  lastFrame = url;
  try {
    const r = await fetch('/api/vision-prefetch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: url.split(',')[1] })
    });
    const j = await r.json();
    console.log(`[Prefetch] ✔ ${j.issueCount} issues cached in ${j.latency}ms`);
    logEvent(`⚡ prefetch: ${j.issueCount} issues`, 'vision');
    // Pre-fire: send show_me NOW so Mini starts generating while music plays
    // Audio will be buffered until music ends
    if (MUSIC_MODE === 'brake' && musicEl && !musicEl.paused) {
      _brakeBuffering = true;
      console.log('[Prefetch] 🎯 Pre-firing show_me — Mini generates during music');
      logEvent('⚡ Mini pre-fired', 'system');
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'show_me' }));
      }
    }
  } catch (e) {
    console.warn('[Prefetch] ✖', e.message, '— will fall back to vision-tick');
  }
}
async function sendFrame() {
  // Only send vision frames in roast phase — not in void/greet
  if (_currentPhase === 'void') return;
  const roastImg = document.getElementById('roast-target-img');
  // In roast mode with static image — send image instead of video
  if (_currentPhase === 'roast' && roastImg && roastImg.style.display !== 'none') {
    offCanvas.width = roastImg.naturalWidth || 800;
    offCanvas.height = roastImg.naturalHeight || 600;
    offCanvas.getContext('2d').drawImage(roastImg, 0, 0, offCanvas.width, offCanvas.height);
  } else {
    if ((!stream && !VIDEO_MODE) || video.readyState < 2) return;
    offCanvas.width = video.videoWidth;
    offCanvas.height = video.videoHeight;
    offCanvas.getContext('2d').drawImage(video, 0, 0);
  }
  const url = offCanvas.toDataURL('image/jpeg', 0.9);
  lastFrame = url;
  try {
    await fetch('/api/vision-tick', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: url.split(',')[1] })
    });
  } catch { }
}

// ── Dispatch ────────────────────────────────────────────────────
function dispatch(ev) {
  switch (ev.event) {
    case 'init': onInit(ev); break;
    case 'phase_change': onPhase(ev.phase); logEvent(`→ ${ev.phase.toUpperCase()}`, 'system'); break;
    case 'agent_text':
      addText(ev.agent, ev.text);
      // No subtitle from agent_text — subtitles come from mini_transcript only
      // Debounced log
      if (!_logTextDebounce[ev.agent]) {
        _logTextDebounce[ev.agent] = true;
        logEvent(`✦ speaking`, ev.agent);
        setTimeout(() => { _logTextDebounce[ev.agent] = false; }, 3000);
      }
      break;
    case 'agent_turn_end': seal(ev.agent); fadeSubtitle(); break;
    case 'audio_chunk':
      // Log every 20th chunk to reduce console overhead
      audioChunkCount++;
      if (audioChunkCount % 20 === 1) console.log(`[Audio] 🔊 chunk #${audioChunkCount} from ${ev.agent} phase=${_currentPhase} ctxState=${audioCtx?.state || 'null'}`);
      // Brake buffering: hold audio while music still plays
      if (_brakeBuffering) {
        _brakeBuffer.push(ev);
        // Still track glow for visual feedback
        glow(ev.agent);
        break;
      }
      glow(ev.agent); playPCM(ev.data);
      // Duck/stop music on first ROAST audio (not greet — greet plays over music)
      if (ev.agent === 'mini' && musicEl && !musicDucked && _currentPhase === 'roast') {
        musicDucked = true;
        if (MUSIC_MODE === 'brake') {
          musicEl.pause();
          console.log('[Music] BRAKE — stopped');
        } else {
          musicEl.volume = 0.08;
          console.log('[Music] DUCK → 0.08');
        }
      }
      break;
    case 'mini_transcript':
      // Netflix subtitle from Mini's speech transcript — synced, not typing
      showSubtitle('mini', ev.text);
      break;
    case 'flush_audio': flushAudio(); logEvent('✂ cut', 'cut'); break;
    case 'tool_execution': tool(ev); logEvent(`${ev.tool_name || 'tool'}()`, ev.agent); break;
    case 'vision_result':
      onVisionResult(ev);
      _totalIssues += (ev.issues?.length || 0);
      logEvent(`${ev.latency || '?'}ms → ${ev.issues?.length || 0} issues (score:${ev.score})`, 'vision');
      break;
    case 'round_change': _totalRounds++; logEvent(`turn ${_totalRounds}`, 'system'); break;
    case 'mute': onMute(ev.agent); break;
    case 'unmute': onUnmute(ev.agent); break;
    case 'image_result': onImage(ev); logEvent('✔ redesign received', 'build'); break;
    case 'build_generating':
      onBuildStart();
      logEvent('Nano Banana generating…', 'build');
      // Pipeline: activate Banana node
      pipelineActivate('pipe-banana', 'pipe-line-1');
      // Jam dot → slides to Nano Banana icon
      jamSlideTo('pipe-banana');
      break;
    case 'nano_banana_failed': console.warn('[NanoBanana] Failed — waiting for HTML fallback'); logEvent('✖ NanoBanana failed', 'error'); break;
    case 'song_chunk': playSongChunk(ev.data); break;
    case 'song_complete': stopSongPlayback(); break;
    case 'credits_start':
      go('curtain');
      logEvent('▸ Credits', 'system');
      // Pipeline: activate Lyria node
      pipelineActivate('pipe-lyria', 'pipe-line-2');
      // Jam dot → slides to music/Lyria icon
      jamSlideTo('pipe-lyria');
      if (musicEl) { musicEl.pause(); musicEl.currentTime = 0; }
      // Play Code_is_Disease — static file, no Lyria streaming
      playCreditsMusic();
      // Populate credit metrics
      { const cmIssues = document.getElementById('cm-issues');
        const cmRounds = document.getElementById('cm-rounds');
        if (cmIssues) cmIssues.textContent = _totalIssues || '—';
        if (cmRounds) cmRounds.textContent = _totalRounds || '—';
      }
      break;
    case 'scene_complete': onSceneComplete(ev); logEvent(`✔ ${ev.visualState} done`, 'system'); break;
    case 'scene_advance': logEvent('▶ next scene', 'system'); break;
    case 'greet_done': onGreetDone(); break;
    case 'chapter': showChapter(ev.number, ev.title); logEvent(`Chapter ${ev.number}`, 'system'); break;
    case 'freeze_frame': break;  // disabled — camera stays live
    case 'resume_frame': break;
  }
}

function onGreetDone() {
  _greetDone = true;
  console.log('[Greet] ✔ Mini done');
  // If brake music already ended (or no music), send show_me now
  if (!musicEl || musicEl.paused || musicEl.ended) {
    console.log('[Greet] Music already done → sending show_me');
    send({ event: 'show_me' });
  }
  // Otherwise, brake ended handler will send show_me when music finishes
}

// ── Chapter title cards ─────────────────────────────────────────
function showChapter(number, title) {
  if (!chapterCard) return;
  if (chapterNumber) chapterNumber.textContent = `Chapter ${number}`;
  if (chapterTitle) chapterTitle.textContent = title;
  chapterCard.classList.add('visible');
  // Fade in 0.5s, hold 1.5s, fade out 0.5s
  setTimeout(() => {
    chapterCard.classList.remove('visible');
  }, 2500);
}

// ── Scene Navigation — manual chapter control ─────────────────────
const _chapterData = {
  volunteer: { number: 1, title: 'The Volunteer' },
  roast:     { number: 2, title: 'The Roast' },
  trial:     { number: 3, title: 'The Trial' },
  rebuild:   { number: 4, title: 'The Rebuild' },
  upgrade:   { number: 5, title: 'The Upgrade' },
};
const _phaseToScreen = { void: 'void', roast: 'scan', live: 'scan', build: 'rebuild', credits: 'curtain' };
let _sceneNavBusy = false;

function initSceneNav() {
  document.querySelectorAll('.scene-btn').forEach(btn => {
    btn.addEventListener('click', () => handleSceneNav(btn));
  });
}

// ── RESET — back to home, fresh Mini session ───────────────────
function goHome() {
  console.log('[HOME] 🏠 Resetting to home screen');
  // Stop all audio
  flushAudio();
  hideSubtitle();
  document.body.classList.remove('roast-mode');
  // Show home screen
  go('void');
  const btn = document.getElementById('btn-start');
  if (btn) btn.classList.remove('hidden');
  // Reset nav
  document.querySelectorAll('.scene-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.phase === 'void');
  });
  _currentPhase = 'void';
  // Tell server to reconnect Mini — fresh session
  send({ event: 'reset' });
}

// ── START — home screen button, launches Mini ──────────────────
async function startMini() {
  console.log('[START] 🚀 Starting Mini from home screen');
  const btn = document.getElementById('btn-start');
  if (btn) btn.classList.add('hidden');

  // Audio context needs user gesture to resume
  await ensureAudioForNav();

  // Play opening music (hey-brake)
  musicEl = musicBrake;
  musicEl.currentTime = 0;
  musicEl.volume = 1.0;
  musicDucked = false;
  musicEl.play().catch(e => console.warn('[Music] autoplay blocked:', e));

  // Start camera + mic feed
  await startCameraAndMicForNav();

  // Switch to scan screen to show camera feed
  go('scan');
  _currentPhase = 'void';

  // Chapter 1 card
  showChapter(1, 'The Volunteer');

  // Mark Lock-on as active in nav
  document.querySelectorAll('.scene-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.phase === 'void');
  });

  // Tell server phase void + send greet to trigger Mini
  send({ event: 'phase_change', phase: 'void' });
  send({ event: 'greet' });
}

// ── Double-click anywhere = "Go Live" (same as saying it into mic) ──
document.addEventListener('dblclick', () => {
  console.log('[DblClick] 🎬 Simulating "Go Live"');
  send({ event: 'go_live_manual' });
});

async function handleSceneNav(btn) {
  if (_sceneNavBusy) return;
  _sceneNavBusy = true;

  try {
  const phase = btn.dataset.phase;
  const chapter = btn.dataset.chapter;

  // ── HARD CUT — kill everything from previous scene ──
  cutAll();

  // Update active state
  document.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Show chapter card
  const ch = _chapterData[chapter];
  if (ch) {
    showChapter(ch.number, ch.title);
  }

  // Ensure AudioContext is created (user gesture required for iOS)
  await ensureAudioForNav();

  // Switch screen + tell server (skip chapter card delay when FX_MUTED)
  const doNav = () => {
    const screen = _phaseToScreen[phase] || 'void';
    go(screen);
    _currentPhase = phase;
    send({ event: 'phase_change', phase });

    // Lock-on = back to home with START button
    if (phase === 'void') {
      flushAudio();
      hideSubtitle();
      const startBtn = document.getElementById('btn-start');
      if (startBtn) startBtn.classList.remove('hidden');
      // NO reset — Mini stays connected, just go to title screen
      _sceneNavBusy = false;
      return;
    }

    startCameraAndMicForNav();

    // DISSECT: live camera stays visible with B&W filter — no static image overlay
    const roastImg = document.getElementById('roast-target-img');
    const roastColor = document.getElementById('roast-target-color');
    const scanFeed = document.getElementById('scan-feed');
    if (phase === 'roast') {
      // Static image hidden on screen — only sent to vision for coordinates
      if (roastImg) roastImg.style.display = 'none';
      if (roastColor) roastColor.style.display = 'none';
      // Live camera stays visible + B&W filter
      if (scanFeed) {
        scanFeed.style.opacity = '1';
        scanFeed.style.filter = 'grayscale(1) brightness(0.75)';
      }
    } else {
      if (roastImg) roastImg.style.display = 'none';
      if (roastColor) roastColor.style.display = 'none';
      if (scanFeed) {
        scanFeed.style.opacity = '1';
        scanFeed.style.filter = 'none';
      }
    }

    _sceneNavBusy = false;
    console.log(`[SceneNav] → ${chapter} (phase: ${phase}, screen: ${screen})`);
  };
  if (FX_MUTED) doNav();
  else setTimeout(doNav, 2500);

  } catch (e) {
    console.error('[SceneNav] Error:', e);
    _sceneNavBusy = false;
  }
}

/** Scene cut — kill music/visuals but KEEP MINI ALIVE. She's always on. */
function cutAll() {
  console.log('[CUT] ✂ Scene cut — music/visuals only (Mini stays live)');

  // ❌ DON'T flush Mini's audio — she keeps talking across scenes
  // ❌ DON'T send flush_audio to server — don't interrupt Mini

  // 1. Stop brake/playback music
  if (musicEl) {
    musicEl.pause();
    musicEl.currentTime = 0;
  }
  musicDucked = false;
  _brakeBuffer = [];
  _brakeBuffering = false;

  // 2. Stop credits music
  stopCreditsMusic();

  // 3. Stop Lyria streaming music
  stopSongPlayback();

  // 4. Stop lyrics sync
  stopLyricsSync();

  // 5. Stop vision ticks (will restart if needed in new scene)
  clearInterval(visionTimer);
  visionTimer = null;

  // 6. Stop roam animation
  stopRoam();

  // 7. Clear scan overlays + annotations
  clearScanOverlays();
  if (annoLayer) annoLayer.innerHTML = '';

  // 8. Hide subtitle
  hideSubtitle();

  // 9. Reset scan ring + patrol
  scanRing?.classList.remove('active', 'agent-mini', 'agent-jam');
  const sc = document.querySelector('.scan-capture');
  if (sc) sc.classList.remove('ring-active', 'agent-mini-active', 'agent-jam-active', 'roasting');
  stopColorRing();
  stopTargetPatrol();

  // 10. Reset build state
  nanoBananaReady = false;
  clearTimeout(buildTimer);

  // 11. Hide advance prompt if showing
  hideAdvancePrompt();
  waitingForAdvance = false;
}

async function ensureAudioForNav() {
  // Create AudioContext on user gesture (iOS requirement)
  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx) audioCtx = new AudioCtxClass({ sampleRate: 24000 });
  // Unlock with silent buffer
  const unlockBuf = audioCtx.createBuffer(1, 1, 22050);
  const unlockSrc = audioCtx.createBufferSource();
  unlockSrc.buffer = unlockBuf; unlockSrc.connect(audioCtx.destination); unlockSrc.start(0);
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  // Flush any queued PCM
  while (pcmQueue.length > 0) schedulePCM(pcmQueue.shift());
  startAudioHealthCheck();
}

async function startCameraAndMicForNav() {
  // ── 1. Mic (don't double-start) ──
  if (!micStream) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
      });
      startMicCapture(mic);
      console.log('[SceneNav] 🎤 Mic captured');
    } catch (e) { console.warn('[SceneNav] No mic:', e.message); }
  }

  // ── 2. Video (don't double-start) ──
  if (!stream || !stream.getVideoTracks || !stream.getVideoTracks().length || stream.getVideoTracks()[0].readyState === 'ended') {
    let gotVideo = false;
    // Desktop (non-iOS): try screen share first
    if (!isIOS) {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 5, max: 10 } },
          audio: false
        });
        gotVideo = true;
        console.log('[SceneNav] 🖥 Screen share captured');
      } catch (e) {
        console.warn('[SceneNav] Screen share denied:', e.message);
      }
    }
    // Fallback (or iOS): camera
    if (!gotVideo) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 5, max: 10 }
          },
          audio: false
        });
        gotVideo = true;
        console.log('[SceneNav] 📹 Camera captured');
      } catch (e) {
        console.warn('[SceneNav] No camera:', e.message, '— audio-only mode');
      }
    }
    if (gotVideo && stream) {
      document.body.classList.add('camera-mode');
      video.srcObject = stream;
      video.style.display = '';
      stream.getVideoTracks()[0].onended = stopCapture;
    }
  }

  // ── 3. AudioContext (ensure unlocked) ──
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC({ sampleRate: 24000 });
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf; src.connect(audioCtx.destination); src.start(0);
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  // ── 4. Start vision ticks (send frames to server) ──
  if (stream && stream.getVideoTracks().length) {
    startVision();
    console.log('[SceneNav] 👁 Vision ticks started');
  }
}

// Initialize nav on load
initSceneNav();

function onInit({ agents: a, interval: i }) {
  interval = i || 1000;
  dot('mini', a?.mini === 'connected');
  console.log(`[Init] Mini: ${a?.mini || 'unknown'} | phase: ${_currentPhase}`);
}

// ── Phase changes from server ────────────────────────────────────
function onPhase(phase) {
  _currentPhase = phase;
  // Update scan data readout
  if (scanStatus) {
    const labels = { roast: 'ROASTING', build: 'BUILDING', credits: 'COMPLETE' };
    scanStatus.textContent = labels[phase] || 'SCANNING';
  }

  if (phase === 'roast') {
    if (currentScreen !== 'scan') go('scan');
    // B&W mode — color only inside scan ring (Chapter 2 only)
    document.body.classList.add('roast-mode');
    // Declutter: fade out HUD chrome, keep only agents + overlays
    document.getElementById('screen-scan')?.classList.add('roasting');
    // Activate scan ring immediately — always on in roast
    scanRing?.classList.add('active', 'agent-mini');
    const sc = document.querySelector('.scan-capture');
    if (sc) sc.classList.add('ring-active');
    startColorRing();
    // Start deterministic patrol through known target positions
    startTargetPatrol();
  } else {
    document.body.classList.remove('roast-mode');
    stopTargetPatrol();
  }
  if (phase === 'build') {
    clearInterval(visionTimer);
    stopRoam();
    clearScanOverlays();
    hideSubtitle();
    const sc = document.querySelector('.scan-capture');
    if (sc) sc.classList.remove('ring-active');
    scanRing?.classList.remove('active', 'agent-mini', 'agent-jam');
    stopColorRing();
    document.getElementById('screen-scan')?.classList.remove('roasting');
    // Go to rebuild screen and play video
    go('rebuild');
    playRebuildVideo();
  }
  if (phase === 'credits') {
    go('curtain');
    // Play credits song
    if (musicEl) { musicEl.pause(); musicEl.currentTime = 0; }
    const creditsSong = new Audio('Code_is_Disease.mp3');
    creditsSong.volume = 1.0;
    creditsSong.play().catch(e => console.warn('[Credits] song blocked:', e));
    // Start Netflix-style credits roll
    const roll = document.getElementById('credits-roll');
    if (roll) {
      roll.classList.add('active');
      // Reset animation
      const inner = roll.querySelector('.credits-roll-inner');
      if (inner) {
        inner.style.animation = 'none';
        inner.offsetHeight; // force reflow
        inner.style.animation = 'credits-scroll 25s linear forwards';
      }
    }
  }
}

// ── Agent status dots (void screen) ─────────────────────────────
function dot(agent, on) {
  $(`dot-${agent}`)?.classList.toggle('off', !on);
}
setInterval(async () => {
  try {
    const h = await fetch('/health').then(r => r.json());
    dot('mini', h.agents?.mini === 'connected');
    dot('jam', h.agents?.jam === 'connected');
    dot('defendant', h.agents?.defendant === 'connected');
  } catch { }
}, 10000);

// ── Mute / Unmute ────────────────────────────────────────────────
const mutedAgents = new Set();

function onMute(agent) {
  mutedAgents.add(agent);
  clearGlow(agent);
}

function onUnmute(agent) {
  mutedAgents.delete(agent);
}

// ── Single Ring Movement — follows active agent ────
let issuePoints = [];
let roamIdx = 0;
let roamTimer = null;

function scanTo(x, y) {
  clearTimeout(focusTimer);
  x = Math.max(25, Math.min(65, x));
  y = Math.max(20, Math.min(70, y));
  if (scanRing) {
    scanRing.style.left = `${x}%`;
    scanRing.style.top = `${y}%`;
  }
  if (scanMini) {
    scanMini.style.left = `calc(${x}% - 120px)`;
    scanMini.style.top = `${y}%`;
  }
  if (scanJam) {
    scanJam.style.left = `calc(${x}% + 120px)`;
    scanJam.style.top = `${y}%`;
  }
  // Move the B&W overlay hole to follow the scan ring
  const sc = document.querySelector('.scan-capture');
  if (sc) {
    sc.style.setProperty('--ring-x', `${x}%`);
    sc.style.setProperty('--ring-y', `${y}%`);
  }
  // Move color reveal clip-path on the full-color image copy
  // Convert scan-capture % coords to image-relative % coords
  const roastColor = document.getElementById('roast-target-color');
  if (roastColor && _currentPhase === 'roast') {
    const scEl = document.querySelector('.scan-capture');
    const imgEl = document.getElementById('roast-target-img');
    if (scEl && imgEl) {
      const scR = scEl.getBoundingClientRect();
      const imR = imgEl.getBoundingClientRect();
      const absX = (x / 100) * scR.width;
      const absY = (y / 100) * scR.height;
      const imgX = ((absX - (imR.left - scR.left)) / imR.width) * 100;
      const imgY = ((absY - (imR.top - scR.top)) / imR.height) * 100;
      roastColor.style.clipPath = `circle(110px at ${imgX}% ${imgY}%)`;
    }
  }
  focusTimer = setTimeout(scanReset, 8000);
}

function scanReset() {
  clearTimeout(focusTimer);
  // Don't reset to center if patrol is running — patrol controls position
  if (!_patrolTimer) scanTo(50, 50);
}

// ── Target Patrol — scripted scan matching Mini's roast order ──
const PATROL_SCRIPT = ['dead_space', 'cta', 'buttons', 'search', 'sidebar'];
const PATROL_DWELL = 8000; // 8s per target — matches Mini's topic pace
let _patrolIdx = 0;
let _patrolTimer = null;
let _patrolOverride = false; // true when annotate_ui overrides position

function startTargetPatrol() {
  stopTargetPatrol();
  _patrolIdx = 0;
  _patrolOverride = false;
  _patrolStep();
  _patrolTimer = setInterval(() => {
    if (_patrolOverride) { _patrolOverride = false; return; }
    _patrolIdx++;
    if (_patrolIdx >= PATROL_SCRIPT.length) _patrolIdx = 0; // loop
    _patrolStep();
  }, PATROL_DWELL);
}

function _patrolStep() {
  const key = PATROL_SCRIPT[_patrolIdx % PATROL_SCRIPT.length];
  const pos = TARGET_POS[key];
  if (pos) {
    scanTo(pos.x, pos.y);
    scanRing?.classList.add('active', 'agent-mini');
    const sc = document.querySelector('.scan-capture');
    if (sc) sc.classList.add('ring-active');
  }
}

function stopTargetPatrol() {
  if (_patrolTimer) { clearInterval(_patrolTimer); _patrolTimer = null; }
  _patrolOverride = false;
}

// Auto-roam: agents explore issue points independently
function startRoam(issues) {
  issuePoints = (issues || [])
    .filter(i => i.x != null && i.y != null)
    .map(i => ({ x: i.x, y: i.y }));
  if (issuePoints.length < 3) {
    issuePoints.push({ x: 30, y: 30 }, { x: 70, y: 50 }, { x: 50, y: 75 }, { x: 25, y: 60 }, { x: 65, y: 25 });
  }
  roamIdx = 0;
  clearInterval(roamTimer);
  roamTimer = setInterval(() => {
    if (issuePoints.length === 0) return;
    const p = issuePoints[roamIdx % issuePoints.length];
    // Add slight randomness for natural movement
    const jx = p.x + (Math.random() - 0.5) * 10;
    const jy = p.y + (Math.random() - 0.5) * 10;
    scanTo(Math.max(10, Math.min(90, jx)), Math.max(10, Math.min(90, jy)));
    roamIdx++;
  }, 3500);
}

function stopRoam() {
  clearInterval(roamTimer);
  roamTimer = null;
}

// ── Orchestrated Scan Overlays — cinematic HUD pins ──────────────
const SEV_COLOR = { 5:'#ef4444', 4:'#f97316', 3:'#eab308', 2:'#60a5fa', 1:'#94a3b8' };
let _overlaySettleTimer = null;

function onVisionResult(ev) {
  const issues = ev.issues || [];
  startRoam(issues);
  renderScanOverlays(issues, ev.score, ev.worst);
  updateScanHUD(ev);
}

function updateScanHUD(ev) {
  const scoreEl = $('scan-score');
  const issuesEl = $('scan-issues');
  const latencyEl = $('scan-latency');
  const contrastEl = $('scan-contrast');
  const hierarchyEl = $('scan-hierarchy');
  const resEl = $('scan-resolution');

  if (scoreEl && ev.score != null) {
    scoreEl.textContent = `${ev.score}/10`;
    const c = ev.score <= 3 ? 'rgba(239,68,68,0.7)' : ev.score <= 6 ? 'rgba(234,179,8,0.6)' : 'rgba(34,197,94,0.6)';
    scoreEl.style.color = c;
  }
  if (issuesEl) issuesEl.textContent = `${(ev.issues || []).length} FOUND`;
  if (latencyEl && ev.latency) latencyEl.textContent = `${ev.latency}ms`;

  // Derive contrast/hierarchy ratings from issues
  const issueText = JSON.stringify(ev.issues || []).toLowerCase();
  if (contrastEl) {
    const hasContrast = /contrast|color|dark|light|readab/.test(issueText);
    contrastEl.textContent = hasContrast ? 'POOR' : 'OK';
    contrastEl.style.color = hasContrast ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)';
  }
  if (hierarchyEl) {
    const hasHierarchy = /hierarch|layout|flow|priority|clutter/.test(issueText);
    hierarchyEl.textContent = hasHierarchy ? 'WEAK' : 'CLEAR';
    hierarchyEl.style.color = hasHierarchy ? 'rgba(234,179,8,0.5)' : 'rgba(34,197,94,0.5)';
  }
  if (resEl) resEl.textContent = '2360×1640';
}

function renderScanOverlays(issues, score, worst) {
  clearScanOverlays();
  // Cinematic mode: no score pills, no worst tags, no issue pins — keep it clean
  return;

  // ── Issue pins — small dots with line+label ──
  issues.forEach((issue, i) => {
    const pin = document.createElement('div');
    pin.className = 'scan-ov scan-pin';
    const c = SEV_COLOR[issue.severity] || '#eab308';
    const d = 0.3 + i * 0.12;

    pin.style.cssText = `position:absolute;left:${issue.x}%;top:${issue.y}%;z-index:15;
      transform:translate(-50%,-50%);pointer-events:none;
      animation:scanPinDrop 0.4s ease ${d}s both;`;

    // Small dot (8px)
    const dot = document.createElement('div');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;
      background:${c};color:${c};
      box-shadow:0 0 8px ${c}60;
      animation:scanPinIdle 2.5s ease infinite ${d}s;`;

    // Connecting line + label (to the right of dot)
    const arm = document.createElement('div');
    arm.style.cssText = `position:absolute;left:12px;top:50%;transform:translateY(-50%);
      display:flex;align-items:center;gap:0;
      animation:scanLineReveal 0.3s ease ${d + 0.3}s both;overflow:hidden;`;

    const line = document.createElement('div');
    line.style.cssText = `width:16px;height:1px;background:${c}80;flex-shrink:0;`;

    const lbl = document.createElement('div');
    lbl.style.cssText = `white-space:nowrap;
      background:rgba(0,0,0,0.6);border:1px solid ${c}40;color:${c};
      font:600 8px/1.2 'Space Mono',monospace;padding:2px 5px;border-radius:3px;
      backdrop-filter:blur(6px);`;
    lbl.textContent = issue.label;

    arm.appendChild(line);
    arm.appendChild(lbl);
    pin.appendChild(dot);
    pin.appendChild(arm);
    sc.appendChild(pin);
  });

  // Auto-settle: fade pins to 35% after 3s so they don't fight the agent rings
  clearTimeout(_overlaySettleTimer);
  _overlaySettleTimer = setTimeout(() => {
    document.querySelectorAll('.scan-pin').forEach(el => {
      el.style.animation = 'scanFadeSettle 1s ease forwards';
    });
  }, 3000);
}

function clearScanOverlays() {
  clearTimeout(_overlaySettleTimer);
  document.querySelectorAll('.scan-ov').forEach(el => el.remove());
}


// ── Netflix Subtitles ─────────────────────────────────────────
let _subtitleLine = '';
let _subtitleSentence = '';
function showSubtitle(agent, text) {
  const bar = document.getElementById('subtitle-bar');
  const txt = document.getElementById('subtitle-text');
  if (!bar || !txt) return;

  _subtitleSentence += text;
  const trimmed = _subtitleSentence.trim();

  // Split on sentence boundaries — show last 2 sentences, max ~140 chars
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  let display = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = sentences.slice(i).join(' ');
    if (candidate.length <= 140) display = candidate;
    else break;
  }
  if (!display) display = sentences[sentences.length - 1] || trimmed;
  // Trim to last 140 chars if still too long
  if (display.length > 140) display = '…' + display.slice(-139);

  txt.textContent = display;
  bar.classList.add('visible');
  clearTimeout(_subtitleTimer);
  _subtitleTimer = setTimeout(() => {
    bar.classList.remove('visible');
    _subtitleSentence = '';
  }, 12000);
}
function hideSubtitle() {
  const bar = document.getElementById('subtitle-bar');
  if (bar) bar.classList.remove('visible');
  clearTimeout(_subtitleTimer);
  _subtitleSentence = '';
}
// Gentle fade — keep subtitle visible 2s after turn ends, then fade
function fadeSubtitle() {
  clearTimeout(_subtitleTimer);
  _subtitleTimer = setTimeout(() => {
    const bar = document.getElementById('subtitle-bar');
    if (bar) bar.classList.remove('visible');
    _subtitleSentence = '';
  }, 6000);
}

// ── Log — single rotating line (drummer rule: silence > noise) ───
let _logTextDebounce = {};
let _logHideTimer = null;

function logEvent(text, type = 'system') {
  console.log(`[LOG:${type}] ${text}`);
  if (!orchLogBody) return;

  // Color class
  const cls = { vision:'vision', mini:'mini', jam:'jam', cut:'cut', error:'cut', build:'build' }[type] || 'phase';

  // Elapsed time since music started
  const elapsed = window._musicStartTime
    ? ((performance.now() - window._musicStartTime) / 1000).toFixed(1)
    : '0.0';
  const tag = { vision:'Vision', mini:'Mini', jam:'Jam', cut:'Cut', error:'Err', build:'Build', system:'Sys' }[type] || 'Sys';

  // Replace content — single line, not append
  orchLogBody.innerHTML = `<div class="orch-log-line ${cls}"><span class="log-ts">${elapsed}s</span> <span class="log-tag">[${tag}]</span> ${text}</div>`;

  // Terminal hidden — log only to console
}

// ── Speaker transition whoosh ───────────────────────────────────
let lastSpeaker = null;

function playWhoosh(agent) {
  if (FX_MUTED) return;
  if (agent === lastSpeaker) return; // same speaker, no whoosh
  lastSpeaker = agent;
  const ctx = ensureAudioCtx();
  if (!ctx || ctx.state !== 'running') return;
  try {
    const freqs = { mini: 520, jam: 380, defendant: 440 };
    const freq = freqs[agent] || 440;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.7, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq, ctx.currentTime + 0.08);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.3, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  } catch(e) { /* silent fail */ }
}

// ── Transcript with Gemini sparkles ─────────────────────────────
const live = { mini: null, jam: null, defendant: null };
const buf = { mini: '', jam: '', defendant: '' };
const debateLog = [];  // full debate transcript for download
const sparkColors = { mini: '#C084FC', jam: '#FBBF24', defendant: '#E2E8F0' };

function addText(agent, chunk) {
  buf[agent] = (buf[agent] || '') + chunk;
  if (!live[agent]) {
    const line = document.createElement('div');
    line.className = `t-line ${agent} streaming`;
    line.appendChild(sparkleSVG(sparkColors[agent] || '#fff'));
    const name = document.createElement('span');
    name.className = 't-name'; name.textContent = agent.toUpperCase();
    line.appendChild(name);
    const text = document.createElement('span');
    text.className = 't-text';
    line.appendChild(text);
    transcript.appendChild(line);
    live[agent] = { line, text };
    while (transcript.children.length > 8) transcript.children[0].remove();
  }
  const raw = buf[agent].replace(/\*\*[^*]+\*\*/g, '').replace(/\s+/g, ' ').trim();
  live[agent].text.textContent = raw.length > 140 ? raw.slice(0, 140) + '…' : raw;
  glow(agent);
}

function seal(agent) {
  live[agent]?.line.classList.remove('streaming');
  const text = (buf[agent] || '').replace(/\*\*[^*]+\*\*/g, '').replace(/\s+/g, ' ').trim();
  if (text) debateLog.push({ agent: agent.toUpperCase(), text, time: new Date().toISOString() });
  live[agent] = null; buf[agent] = '';
  clearGlow(agent);
}

// ── Glow + Speaking ─────────────────────────────────────────────
const agentStyles = {
  mini:      { color: 'rgba(168,85,247,0.5)', glow: 'rgba(168,85,247,0.25)', glowFar: 'rgba(168,85,247,0.08)' },
  jam:       { color: 'rgba(245,158,11,0.5)',  glow: 'rgba(245,158,11,0.25)', glowFar: 'rgba(245,158,11,0.08)' },
  defendant: { color: 'rgba(226,232,240,0.5)', glow: 'rgba(226,232,240,0.2)', glowFar: 'rgba(226,232,240,0.06)' },
};

function glow(agent) {
  if (FX_MUTED || mutedAgents.has(agent)) return;
  // Scan ring only in roast mode (DISSECT scene)
  if (_currentPhase !== 'roast') return;
  clearTimeout(glowTimer);
  // No edge glows — silence > noise
  // Ring color = active agent
  const s = agentStyles[agent];
  if (s && scanRing) {
    scanRing.style.setProperty('--agent-color', s.color);
    scanRing.style.setProperty('--agent-glow', s.glow);
    scanRing.style.setProperty('--agent-glow-far', s.glowFar);
  }
  // Show ring + color hole when agent speaks
  scanRing?.classList.add('active');
  scanRing?.classList.remove('agent-mini', 'agent-jam');
  scanRing?.classList.add(`agent-${agent}`);
  const sc = document.querySelector('.scan-capture');
  if (sc) {
    sc.classList.add('ring-active');
    sc.classList.remove('agent-mini-active', 'agent-jam-active');
  }
  // Whoosh on speaker transition
  playWhoosh(agent);
  speaking = agent;
  // Start color ring canvas
  startColorRing();
}

function clearGlow(agent) {
  if (speaking === agent) {
    glowTimer = setTimeout(() => {
      // In roast mode with patrol — don't hide ring, patrol keeps it alive
      if (_patrolTimer) { speaking = null; return; }
      // Hide ring — back to full B&W between speakers
      scanRing?.classList.remove('active', 'agent-mini', 'agent-jam');
      const sc = document.querySelector('.scan-capture');
      if (sc) sc.classList.remove('ring-active', 'agent-mini-active', 'agent-jam-active');
      speaking = null;
      stopColorRing();
    }, 1200);
  }
}

// ── Color Ring — clip-path on roast-target-color (no canvas needed) ──
const colorRingCanvas = $('color-ring-canvas'); // keep ref for cleanup
let _colorRingRAF = null;

function startColorRing() {
  // Color reveal is handled by CSS clip-path on roast-target-color via scanTo()
  // Show the color overlay when ring is active
  const roastColor = document.getElementById('roast-target-color');
  if (roastColor && _currentPhase === 'roast') {
    roastColor.style.display = 'block';
  }
}

function stopColorRing() {
  // Hide color overlay — back to full B&W
  const roastColor = document.getElementById('roast-target-color');
  if (roastColor) roastColor.style.clipPath = 'circle(0px at 50% 50%)';
}

// ── Mic Capture — bidirectional audio to agents ──────────────────
let micStream = null;
let micCtx = null;  // separate context at native rate for capture
let micProcessor = null;

function startMicCapture(existingStream) {
  // Use existing audio stream or request new one
  const audioTrack = existingStream?.getAudioTracks()[0];
  if (!audioTrack) { console.warn('[Mic] No audio track available'); return; }

  // Clone the track so we don't interfere with the original stream
  micStream = new MediaStream([audioTrack]);
  micCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = micCtx.createMediaStreamSource(micStream);

  // Boost mic gain 4x — echo cancellation + noise suppression kill volume
  const gainNode = micCtx.createGain();
  gainNode.gain.value = 4.0;
  source.connect(gainNode);

  // Small ScriptProcessor buffer (256) for minimum latency.
  // We accumulate downsampled samples and send exactly 640 (40ms @ 16kHz).
  const bufSize = 256;
  micProcessor = micCtx.createScriptProcessor(bufSize, 1, 1);

  const targetRate = 16000;
  const CHUNK_SAMPLES = 640; // 40ms @ 16kHz — optimal for Gemini Live API
  const ratio = micCtx.sampleRate / targetRate;
  let accumulator = new Int16Array(CHUNK_SAMPLES);
  let accIdx = 0;
  let _micSendCount = 0;

  micProcessor.onaudioprocess = (e) => {
    if (!ws || ws.readyState !== 1) return;
    const input = e.inputBuffer.getChannelData(0);
    // Downsample to 16kHz and accumulate
    const outLen = Math.floor(input.length / ratio);
    for (let i = 0; i < outLen; i++) {
      const idx = Math.floor(i * ratio);
      const s = Math.max(-1, Math.min(1, input[idx]));
      accumulator[accIdx++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

      // Send when we hit 640 samples (40ms chunk)
      if (accIdx >= CHUNK_SAMPLES) {
        const bytes = new Uint8Array(accumulator.buffer);
        let binary = '';
        for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
        send({ event: 'audio_input', data: btoa(binary) });
        _micSendCount++;
        // Log every 100 chunks (~4s) — include RMS energy to verify mic captures real audio
        if (_micSendCount % 100 === 1) {
          let sumSq = 0;
          for (let k = 0; k < CHUNK_SAMPLES; k++) sumSq += accumulator[k] * accumulator[k];
          const rms = Math.sqrt(sumSq / CHUNK_SAMPLES);
          console.log(`[Mic] 🎤 chunk #${_micSendCount} | RMS=${rms.toFixed(0)} | ${rms > 500 ? 'SPEECH' : rms > 50 ? 'quiet' : 'SILENCE'} | rate=${micCtx.sampleRate}→16k`);
        }
        accIdx = 0;
        accumulator = new Int16Array(CHUNK_SAMPLES);
      }
    }
  };

  gainNode.connect(micProcessor);
  micProcessor.connect(micCtx.destination); // required for ScriptProcessor to fire
  console.log(`[Mic] Capture: ${micCtx.sampleRate}Hz → 16kHz, ${CHUNK_SAMPLES} samples/chunk (${CHUNK_SAMPLES/16}ms), gain=4x`);
}

function stopMicCapture() {
  micProcessor?.disconnect();
  micCtx?.close().catch(() => {});
  micStream?.getTracks().forEach(t => t.stop());
  micProcessor = null; micCtx = null; micStream = null;
  console.log('[Mic] Capture stopped');
}

// ── Audio — PCM16-LE gapless (iOS-safe) ─────────────────────────
// LAZY: create AudioContext only inside a user gesture (iOS requirement)
let audioCtx = null;
let nextStart = 0;
let pcmQueue = [];
let resuming = false;
let activeSources = [];  // track scheduled BufferSourceNodes for flush
let gainNode = null;     // volume boost

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 3.0;  // 3x volume boost
    gainNode.connect(audioCtx.destination);
    console.log('[Audio] created AudioContext + gain=3.0, state=' + audioCtx.state);
  }
  if (audioCtx.state === 'suspended' && !resuming) {
    resuming = true;
    audioCtx.resume().then(() => {
      // Play silent buffer to truly unlock iOS audio
      try {
        const sil = audioCtx.createBuffer(1, 1, 24000);
        const s = audioCtx.createBufferSource();
        s.buffer = sil; s.connect(audioCtx.destination); s.start();
      } catch(e) {}
      resuming = false;
      console.log('[Audio] unlocked, state=' + audioCtx.state + ', queued=' + pcmQueue.length);
      while (pcmQueue.length > 0) schedulePCM(pcmQueue.shift());
    });
  }
  return audioCtx;
}
// Attach to every gesture type iOS recognizes
['click','touchstart','touchend','pointerdown','keydown'].forEach(ev =>
  document.addEventListener(ev, ensureAudioCtx, { once: false })
);

// ── Audio health check — iOS randomly suspends AudioContext ──────
let audioHealthTimer = null;
let audioChunkCount = 0;

function startAudioHealthCheck() {
  clearInterval(audioHealthTimer);
  audioHealthTimer = setInterval(async () => {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      console.warn('[AudioHealth] Context suspended — resuming...');
      try {
        await audioCtx.resume();
        // Re-play silent buffer to keep it alive
        const sil = audioCtx.createBuffer(1, 1, 22050);
        const s = audioCtx.createBufferSource();
        s.buffer = sil; s.connect(audioCtx.destination); s.start();
        console.log('[AudioHealth] Resumed. state:', audioCtx.state);
        // Flush queued chunks
        while (pcmQueue.length > 0) schedulePCM(pcmQueue.shift());
      } catch(e) { console.error('[AudioHealth] Resume failed:', e); }
    }
    updateAudioDebug();
  }, 2000);
}

// ── Visible debug badge (DISABLED — cinematic mode) ─────────────
function updateAudioDebug() {
  return; // Clean cinema: no debug overlay
  let badge = document.getElementById('audio-debug');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'audio-debug';
    badge.style.cssText = 'position:fixed;top:4px;left:4px;z-index:9999;font:10px/1.3 monospace;color:#0f0;background:rgba(0,0,0,0.7);padding:3px 6px;border-radius:4px;pointer-events:none;';
    document.body.appendChild(badge);
  }
  const state = audioCtx ? audioCtx.state : 'null';
  badge.textContent = `🔊 ${state} | q:${pcmQueue.length} | ♪${audioChunkCount}`;
  badge.style.color = state === 'running' ? '#0f0' : state === 'suspended' ? '#f80' : '#f00';
}

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
  // Eddy³ pattern: clamp to currentTime, no offset
  nextStart = Math.max(nextStart, ctx.currentTime);
  const abuf = ctx.createBuffer(1, f32.length, 24000);
  abuf.getChannelData(0).set(f32);
  const src = ctx.createBufferSource();
  src.buffer = abuf;
  src.connect(gainNode || ctx.destination);
  src.start(nextStart);
  nextStart += abuf.duration;
  // Track for flush
  activeSources.push(src);
  src.onended = () => { activeSources = activeSources.filter(s => s !== src); };
}

/** Flush all queued + scheduled audio — instant silence */
function flushAudio() {
  pcmQueue.length = 0;
  for (const src of activeSources) {
    try { src.stop(); } catch(e) {}
  }
  activeSources = [];
  nextStart = 0;
  console.log('[Audio] 🔇 FLUSHED');
  updateAudioDebug();
}

function playPCM(b64) {
  if (!b64) return;
  const ctx = ensureAudioCtx();
  const f32 = decodePCM(b64);
  if (!ctx || ctx.state !== 'running') {
    pcmQueue.push(f32);
    updateAudioDebug();
    return;
  }
  schedulePCM(f32);
  updateAudioDebug();
}

// ── Lyria Credits Music (48kHz stereo PCM16) ────────────────────
let songCtx = null;
let songNextTime = 0;
let songGain = null;

function playSongChunk(b64) {
  if (!b64) return;
  if (!songCtx) {
    // Fallback: create if not pre-created (non-iOS, or startCapture not called)
    songCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    songGain = songCtx.createGain();
    songGain.gain.value = 0.65;
    songGain.connect(songCtx.destination);
  }
  if (songNextTime === 0) songNextTime = songCtx.currentTime + 0.05; // first chunk buffer
  if (songCtx.state === 'suspended') songCtx.resume();

  // Decode base64 → Int16 stereo → Float32 stereo
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer);
  const numSamples = i16.length / 2; // stereo = 2 channels
  const buf = songCtx.createBuffer(2, numSamples, 48000);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  for (let i = 0; i < numSamples; i++) {
    L[i] = i16[i * 2] / 32768;
    R[i] = i16[i * 2 + 1] / 32768;
  }

  const src = songCtx.createBufferSource();
  src.buffer = buf;
  src.connect(songGain);

  const now = songCtx.currentTime;
  const startAt = Math.max(now + 0.01, songNextTime);
  src.start(startAt);
  songNextTime = startAt + buf.duration;
}

function stopSongPlayback() {
  if (songGain && songCtx) {
    songGain.gain.linearRampToValueAtTime(0, songCtx.currentTime + 2);
  }
  songNextTime = 0;
  setTimeout(() => {
    if (songCtx) { songCtx.close().catch(() => {}); songCtx = null; songGain = null; }
  }, 3000);
}

// ── Credits Video — Code_is_Disease (20s video with audio) ────
const creditsVideo = document.getElementById('credits-video');
let creditsAudio = null; // kept for stopCreditsMusic() compat

function playCreditsVideo() {
  if (!creditsVideo) return;
  creditsVideo.src = 'Code_is_Disease.mp4';
  creditsVideo.volume = 0.85;
  creditsVideo.currentTime = 0;
  creditsVideo.play().catch(e => console.warn('[Credits] Video play failed:', e.message));
  console.log('[Credits] 🎬 Code_is_Disease video playing');
}

function playCreditsMusic() {
  // Play song (audio only — no visuals, lyrics overlay instead)
  playCreditsVideo();
  // Lyrics sync uses existing LYRICS system from top of file
}

function stopCreditsMusic() {
  if (creditsVideo) {
    creditsVideo.pause();
    creditsVideo.currentTime = 0;
    creditsVideo.src = '';
  }
  if (creditsAudio) {
    creditsAudio.pause();
    creditsAudio.currentTime = 0;
    creditsAudio = null;
  }
  stopLyricsSync();
}

// ── Annotations + Scan Movement ─────────────────────────────────
// Targets: loose zones in center of frame. Camera moves (dolly) so no pixel precision.
// Ring just needs to look like it's scanning different areas of the iPad.
const TARGET_POS = {
  dead_space: { x: 58, y: 45, size: 120 },  // right side — empty space
  cta:        { x: 42, y: 30, size: 100 },  // upper area — "Where should we start?"
  sidebar:    { x: 32, y: 25, size: 80  },  // left side — hamburger
  buttons:    { x: 43, y: 40, size: 100 },  // center — suggestion chips
  search:     { x: 48, y: 62, size: 90  },  // bottom center — "Ask Gemini"
  logo:       { x: 35, y: 25, size: 70  },  // top-left area — Gemini text
};

function tool({ tool_name, args, callId }) {
  if (tool_name === 'annotate_ui') annotate(args, callId);
  if (tool_name === 'render_new_ui') rebuildHTML(args, callId);
}

function annotate(a, id) {
  // FX_MUTED: still ack tool call but skip visuals
  if (FX_MUTED) { ack(id, 'annotate_ui'); return; }

  if (a.target === 'clear' || a.action === 'clear') {
    annoLayer.innerHTML = '';
    scanReset();
    ack(id, 'annotate_ui');
    return;
  }

  const pos = TARGET_POS[a.target];
  if (!pos) { ack(id, 'annotate_ui'); return; }

  // Clear previous annotation — only one at a time for clarity
  annoLayer.innerHTML = '';

  // Draw red circle sized per element
  const el = document.createElement('div');
  el.className = 'anno-circle';
  el.style.left = pos.x + '%';
  el.style.top = pos.y + '%';
  const sz = pos.size || 80;
  el.style.width = sz + 'px';
  el.style.height = sz + 'px';
  if (a.label) {
    const lbl = document.createElement('span');
    lbl.className = 'anno-label';
    lbl.textContent = a.label;
    el.appendChild(lbl);
  }
  annoLayer.appendChild(el);

  // Move scan ring there too — override patrol so it stays here
  _patrolOverride = true;
  scanTo(pos.x, pos.y);

  // Auto-fade after 6s
  setTimeout(() => { if (el.parentNode) el.remove(); }, 6000);

  ack(id, 'annotate_ui');
}

function rebuildHTML({ html_code }, id) {
  ack(id, 'render_new_ui');
  clearTimeout(buildTimer);
  // If Nano Banana image already arrived, don't overwrite with HTML fallback
  if (nanoBananaReady) {
    console.log('[Rebuild] Nano Banana image already showing — skipping HTML fallback');
    return;
  }
  preview.srcdoc = html_code || '';
  setTimeout(() => go('rebuild'), 1500);
}

function ack(callId, name) {
  send({ event: 'tool_completed', callId, toolName: name, status: 'ok' });
}

// ── Rebuild Video → Slider Flow ─────────────────────────────────
function playRebuildVideo() {
  const vid = document.getElementById('rebuild-video');
  const cmp = $('rebuild-compare');
  if (!vid) return;
  vid.classList.remove('done');
  vid.style.display = 'block';
  if (cmp) cmp.style.display = 'none';  // fully hide slider while video plays
  vid.currentTime = 0;
  vid.play().catch(e => console.warn('[RebuildVideo] autoplay blocked:', e));
  badge.textContent = 'REBUILDING';
  badge.classList.add('on');
  // When video ends → show slider
  vid.onended = () => {
    console.log('[RebuildVideo] ended → revealing slider');
    vid.style.display = 'none';
    if (cmp) {
      cmp.style.display = '';
      cmp.style.setProperty('--slider-pos', '100%');
      cmp.style.opacity = '1';
      cmp.style.pointerEvents = 'auto';
      badge.textContent = 'REBUILT';
      setTimeout(() => sliderReveal(), 400);
    }
  };
}

// ── Image Result (Nano Banana) ──────────────────────────────────
let buildTimer = null;
function onBuildStart() {
  badge.textContent = 'BUILDING';
  badge.classList.add('on');
}

function onImage({ mimeType, data }) {
  clearTimeout(buildTimer);
  nanoBananaReady = true;
  console.log(`[NanoBanana] 🍌 Image received (${mimeType})`);
  if (genImg) {
    genImg.src = `data:${mimeType || 'image/png'};base64,${data}`;
    genImg.style.display = 'block';
    preview.style.display = 'none';
  }
  badge.textContent = 'REBUILT';
  rebuildProg?.classList.remove('active');
}

// ── Before/After Slider ────────────────────────────────────────
function sliderReveal() {
  const cmp = $('rebuild-compare');
  if (!cmp) return;
  let pos = 100;
  const revealTarget = 0;   // sweep left to reveal full new design
  const restTarget = 50;    // then settle at center
  let phase = 'reveal';
  const step = () => {
    if (phase === 'reveal') {
      pos -= 1.5;
      if (pos <= revealTarget) { pos = revealTarget; phase = 'pause'; setTimeout(() => { phase = 'return'; requestAnimationFrame(step); }, 1500); }
      cmp.style.setProperty('--slider-pos', `${pos}%`);
      if (phase === 'reveal') requestAnimationFrame(step);
    } else if (phase === 'return') {
      pos += 0.8;
      if (pos >= restTarget) pos = restTarget;
      cmp.style.setProperty('--slider-pos', `${pos}%`);
      if (pos < restTarget) requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

// Draggable slider handle
(function initCompareSlider() {
  const cmp = document.getElementById('rebuild-compare');
  const handle = document.getElementById('compare-handle');
  if (!cmp || !handle) return;

  let dragging = false;

  function setPos(clientX) {
    const rect = cmp.getBoundingClientRect();
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(0, Math.min(100, pct));
    cmp.style.setProperty('--slider-pos', `${pct}%`);
  }

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setPos(e.clientX);
  });

  handle.addEventListener('pointerup', () => { dragging = false; });
  handle.addEventListener('pointercancel', () => { dragging = false; });

  // Also allow tapping anywhere on the compare area to move slider
  cmp.addEventListener('pointerdown', (e) => {
    if (e.target === handle || handle.contains(e.target)) return;
    setPos(e.clientX);
  });
})();

// ── Scene Complete (between acts) ─────────────────────────────
function onSceneComplete(ev) {
  console.log(`[Scene] ✔ Act complete: ${ev.visualState}`);
  waitingForAdvance = true;
  if (VIDEO_MODE) {
    // Auto-advance after 3s pause (cinematic breath between scenes)
    console.log('[Scene] Auto-advance in 3s (VIDEO_MODE)');
    setTimeout(() => advanceScene(), 3000);
  } else {
    showAdvancePrompt();
  }
}

// ── Rounds ──────────────────────────────────────────────────────
function onRound(r) { badge.textContent = `R${r}/2`; badge.classList.add('on'); }
