require('dotenv').config();

function clamp(name, fallback, min, max) {
  const v = parseInt(process.env[name], 10);
  return Number.isNaN(v) ? fallback : Math.max(min, Math.min(max, v));
}

module.exports = {
  PORT:             clamp('PORT', 8080, 1, 65535),
  API_KEY:          process.env.GEMINI_API_KEY,
  VISION_MODEL:     'gemini-3-flash-preview',                 // Jam — UI screenshot analysis
  AUDIO_MODEL:      'models/gemini-2.5-flash-native-audio-preview-12-2025',  // Mini — bidirectional audio
  LIVE_API_BASE:    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
  IMAGE_MODEL:      'gemini-3.1-flash-image-preview',        // Nano Banana 2 — redesign image generation
  MUSIC_MODEL:      'models/lyria-realtime-exp',
  VISION_INTERVAL:  clamp('VISION_INTERVAL_MS', 1000, 500, 5000),
  TOOL_TIMEOUT_MS:  clamp('TOOL_TIMEOUT_MS', 8000, 3000, 30000),
};
