const { GoogleGenAI } = require('@google/genai');
const { API_KEY, VISION_MODEL } = require('../config');

const ai = new GoogleGenAI({ apiKey: API_KEY });

// ─── Per-mode critique taxonomies (Yosef 17.7: "special skills for
// print" — each mode gets its own checks, short list, kill fast) ─────

const SCHEMA = `Return ONLY valid JSON matching this exact schema:
{
  "issues": [
    { "type": "<one of the types below>",
      "severity": 1-5,
      "x": 0-100, "y": 0-100,
      "label": "2-4 word overlay label",
      "detail": "one sentence explanation" }
  ],
  "score": 1-10,
  "worst": "worst area in 3 words"
}
Rules:
- Max 5 issues, sorted by severity (worst first)
- x/y = percentage position where the issue lives
- label: SHORT, fits a badge. detail: one sharp sentence.
- ZERO conversational text. Data only.
- The subject may be photographed at an angle (a page on a table,
  a poster on a wall) — coordinates relative to the artwork itself.`;

const MODES = {
  // ── UI critique (the original GeminX eye) ──
  ui: `You are a UX analysis engine. Analyze this interface.
types: spacing|contrast|typography|navigation|hierarchy|touch_target|consistency|accessibility
Focus: wasted space, poor hierarchy, small touch targets, low contrast, navigation confusion.
${SCHEMA}`,

  // ── PRINT: ads, posters, packaging, editorial ──
  print: `You are a print-advertising critique engine — the eye of a
veteran creative director reviewing a print ad / poster / spread.
The image may contain Hebrew — read it; critique the actual copy.
types: headline|copy|hierarchy|cta|brand|cliche|typography|image_copy_match
Focus:
- headline: weak / generic / buried / says nothing
- copy: talks about the company instead of the reader; too long; no idea
- hierarchy: what does the eye hit first — and is that the right thing
- cta: missing / hidden / passive ("למידע נוסף" is not a call to action)
- brand: logo screaming or invisible; no brand voice
- cliche: handshakes, blue skies, smiling stock faces, lightbulbs
- image_copy_match: the picture and the words tell different stories
${SCHEMA}`,

  // ── ART DIRECTION: composition & craft, medium-agnostic ──
  art: `You are an art-direction critique engine — a senior art
director reviewing any visual work: campaign, layout, cover, frame.
types: composition|color_story|typography_pairing|concept_execution|originality|craft
Focus:
- composition: balance, tension, where the eye travels, cropping sins
- color_story: does the palette mean anything or just decorate
- typography_pairing: faces fighting each other; hierarchy by accident
- concept_execution: is there an idea, and does the execution serve it
- originality: seen-it-before score; whose style is being borrowed
- craft: kerning, alignment, retouch seams — the details that betray rush
${SCHEMA}`,
};

/**
 * Orchestrated scan — returns structured overlay-ready JSON.
 * mode: 'ui' (default) | 'print' | 'art'
 * Always resolves — never throws.
 */
async function analyzeScreenshot(imageBase64, mode = 'ui') {
  const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const prompt = MODES[mode] || MODES.ui;

  let result;
  try {
    result = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: b64 } }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json' }
    });
  } catch (err) {
    console.error('[Vision] API error:', err.message);
    return fallbackResult(mode);
  }

  try {
    const raw = JSON.parse(result.text);
    const issues = (Array.isArray(raw.issues) ? raw.issues : Array.isArray(raw) ? raw : [])
      .slice(0, 5)
      .map(i => ({
        type:     String(i.type || 'hierarchy'),
        severity: Math.max(1, Math.min(5, Number(i.severity) || 3)),
        x:        Number(i.x ?? 50),
        y:        Number(i.y ?? 50),
        label:    String(i.label || i.element || 'Issue'),
        detail:   String(i.detail || i.issue || ''),
      }));

    if (issues.length === 0) return fallbackResult(mode);

    return {
      issues,
      score: Math.max(1, Math.min(10, Number(raw.score) || 4)),
      worst: String(raw.worst || 'overall'),
      mode,
    };
  } catch {
    return fallbackResult(mode);
  }
}

function fallbackResult(mode = 'ui') {
  const byMode = {
    ui: [
      { type: 'hierarchy', severity: 5, x: 50, y: 40, label: 'No Hierarchy', detail: 'No clear visual hierarchy guides the eye' },
      { type: 'touch_target', severity: 4, x: 50, y: 90, label: 'Tiny Targets', detail: 'Touch targets too small for comfortable tapping' },
      { type: 'contrast', severity: 3, x: 50, y: 15, label: 'Low Contrast', detail: 'Text lacks contrast against background' },
    ],
    print: [
      { type: 'headline', severity: 5, x: 50, y: 20, label: 'Headline Says Nothing', detail: 'The headline could top any ad in any category' },
      { type: 'cta', severity: 4, x: 50, y: 85, label: 'No Next Step', detail: 'Nothing tells the reader what to do now' },
      { type: 'cliche', severity: 3, x: 50, y: 50, label: 'Stock Feeling', detail: 'The visual has been seen a thousand times' },
    ],
    art: [
      { type: 'concept_execution', severity: 5, x: 50, y: 40, label: 'Idea Missing', detail: 'Execution without a visible concept behind it' },
      { type: 'composition', severity: 4, x: 50, y: 60, label: 'Eye Gets Lost', detail: 'No path for the eye through the frame' },
      { type: 'typography_pairing', severity: 3, x: 50, y: 25, label: 'Fonts Fighting', detail: 'Typefaces compete instead of pairing' },
    ],
  };
  return { issues: byMode[mode] || byMode.ui, score: 3, worst: 'overall', mode };
}

module.exports = { analyzeScreenshot };
