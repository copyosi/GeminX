const { GoogleGenAI } = require('@google/genai');
const { API_KEY } = require('../config');

/**
 * Lyria RealTime — Generate cinematic credits music.
 * Streams PCM16 48kHz stereo audio chunks via callback.
 * Returns session handle for stop/cleanup.
 */
async function startCreditMusic(onChunk, onDone) {
  const client = new GoogleGenAI({ apiKey: API_KEY, apiVersion: 'v1alpha' });
  let chunkCount = 0;
  let closed = false;

  const session = await client.live.music.connect({
    model: 'models/lyria-realtime-exp',
    callbacks: {
      onmessage: (msg) => {
        if (closed) return;
        if (msg.serverContent?.audioChunks) {
          for (const chunk of msg.serverContent.audioChunks) {
            chunkCount++;
            onChunk(chunk.data); // base64 PCM16 48kHz stereo
          }
        }
      },
      onerror: (err) => {
        console.error('[Lyria] ✖ Error:', err?.message || err);
        if (!closed) { closed = true; onDone?.(); }
      },
      onclose: () => {
        console.log(`[Lyria] Stream closed (${chunkCount} chunks sent)`);
        if (!closed) { closed = true; onDone?.(); }
      },
    },
  });

  await session.setWeightedPrompts({
    weightedPrompts: [
      { text: 'Dark cinematic orchestral with electronic elements, dramatic and epic, credits music for a tech demo', weight: 1.0 },
    ],
  });

  console.log('[Lyria] ✔ Connected — playing credits music');
  await session.play();

  // Auto-stop after 20 seconds (credits are ~15s)
  const stopTimer = setTimeout(() => {
    console.log('[Lyria] Auto-stop after 20s');
    cleanup();
  }, 20000);

  function cleanup() {
    if (closed) return;
    closed = true;
    clearTimeout(stopTimer);
    try { session.close?.(); } catch {}
    onDone?.();
  }

  return { stop: cleanup };
}

module.exports = { startCreditMusic };
