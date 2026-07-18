/**
 * GeminiX History — conversation memory across reconnects
 *
 * Stores Mini's turns + user transcripts to a JSON file.
 * On reconnect, history is injected into Mini's system instruction
 * so she remembers what happened before.
 *
 * File: /tmp/geminix-history.json (survives Cloud Run instance, not deploys)
 */

const fs = require('fs');
const path = require('path');

const HISTORY_FILE = '/tmp/geminix-history.json';
const MAX_TURNS = 40;          // keep last 40 turns (~20 exchanges)
const MAX_CHARS = 4000;        // cap total history at 4000 chars for system instruction

let turns = [];

// ── Load from disk on startup ──────────────────────────────────────
function load() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      turns = Array.isArray(data) ? data.slice(-MAX_TURNS) : [];
      console.log(`[History] Loaded ${turns.length} turns from disk`);
    }
  } catch (e) {
    console.warn('[History] Failed to load:', e.message);
    turns = [];
  }
}

// ── Save to disk ───────────────────────────────────────────────────
function save() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(turns.slice(-MAX_TURNS), null, 0));
  } catch (e) {
    console.warn('[History] Failed to save:', e.message);
  }
}

// ── Add a turn ─────────────────────────────────────────────────────
function addTurn(role, text) {
  if (!text || !text.trim()) return;
  const trimmed = text.trim().slice(0, 500); // cap individual turn at 500 chars
  turns.push({ role, text: trimmed, ts: Date.now() });
  if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
  save();
}

// ── Get formatted history for system instruction ───────────────────
function getHistoryBlock() {
  if (turns.length === 0) return '';

  // Build history string, newest last, capped at MAX_CHARS
  let lines = turns.map(t => {
    const who = t.role === 'mini' ? 'את (מיניX)' : 'יוסף';
    return `${who}: "${t.text}"`;
  });

  // Trim from the start if too long
  let block = lines.join('\n');
  while (block.length > MAX_CHARS && lines.length > 2) {
    lines.shift();
    block = lines.join('\n');
  }

  return `\n\n### CONVERSATION HISTORY (what happened before this session)\n${block}\n\nContinue naturally from where you left off. Don't repeat yourself.`;
}

// ── Clear history ──────────────────────────────────────────────────
function clear() {
  turns = [];
  save();
  console.log('[History] Cleared');
}

// Load on require
load();

module.exports = { addTurn, getHistoryBlock, clear, load };
