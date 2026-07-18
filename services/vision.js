const { GoogleGenAI } = require('@google/genai');
const { API_KEY, VISION_MODEL } = require('../config');

const ai = new GoogleGenAI({ apiKey: API_KEY });

// ─── Document critique (copy decks / campaign PDFs / scripts) ────────
// Uploaded PDF goes to Gemini natively; DOCX is extracted to text first
// (mammoth). Issues carry verbatim QUOTES instead of x/y coordinates —
// there is no frame to point at, the words themselves are the target.

const DOC_PROMPT = `You are a senior copywriter and creative director
reviewing WRITTEN campaign material — a copy deck, a print campaign
PDF, a script (TV / radio / social). The material may be in Hebrew —
read it as a native. Critique the WRITING and the THINKING.

types: headline|promise|cliche|rhythm|reader_focus|structure|cta|idea
Focus:
- headline/opening: does the first line earn the next one
- promise: one sharp promise — or perfume
- cliche: dead phrases (generic superlatives, "one-stop", empty adjectives)
- rhythm: sentences all the same length, no punch, no breath
- reader_focus: talks about the company instead of the reader
- structure: builds to something — or wanders
- cta: what should the reader do, and is it worth doing
- idea: is there one, and does every line serve it

Return ONLY valid JSON:
{
  "issues": [
    { "type": "<one of the types above>",
      "severity": 1-5,
      "quote": "SHORT verbatim quote from the material",
      "label": "2-4 word Hebrew label",
      "detail": "one sharp Hebrew sentence" }
  ],
  "score": 1-10,
  "worst": "worst aspect in 3 Hebrew words"
}
Rules:
- Max 5 issues, sorted by severity (worst first)
- "quote" MUST be verbatim from the material — never invented
- "label" and "detail" in HEBREW
- ZERO conversational text. Data only.`;

/**
 * Critique a written document (campaign PDF / DOCX copy or script).
 * kind: 'pdf' | 'docx'. Always resolves — never throws.
 */
async function analyzeDocument(kind, base64) {
  let parts;
  try {
    if (kind === 'pdf') {
      parts = [
        { text: DOC_PROMPT },
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
      ];
    } else {
      const mammoth = require('mammoth');
      const buf = Buffer.from(base64, 'base64');
      const { value } = await mammoth.extractRawText({ buffer: buf });
      const text = (value || '').trim().slice(0, 20000);
      if (!text) return docFallback();
      parts = [{ text: `${DOC_PROMPT}\n\nTHE MATERIAL:\n${text}` }];
    }

    const result = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json' },
    });

    const raw = JSON.parse(result.text);
    const issues = (Array.isArray(raw.issues) ? raw.issues : [])
      .slice(0, 5)
      .map(i => ({
        type:     String(i.type || 'idea'),
        severity: Math.max(1, Math.min(5, Number(i.severity) || 3)),
        quote:    i.quote ? String(i.quote).slice(0, 200) : null,
        label:    String(i.label || 'בעיה'),
        detail:   String(i.detail || ''),
      }));
    if (issues.length === 0) return docFallback();
    return {
      issues,
      score: Math.max(1, Math.min(10, Number(raw.score) || 4)),
      worst: String(raw.worst || 'הכול'),
      mode: 'copy',
    };
  } catch (err) {
    console.error('[Vision:doc] error:', err.message);
    return docFallback();
  }
}

function docFallback() {
  return {
    issues: [
      { type: 'promise', severity: 5, quote: null, label: 'אין הבטחה אחת', detail: 'החומר מבטיח הכול — כלומר כלום' },
      { type: 'reader_focus', severity: 4, quote: null, label: 'מדבר על עצמו', detail: 'הקופי עסוק בחברה במקום בקורא' },
      { type: 'rhythm', severity: 3, quote: null, label: 'בלי פאנץ', detail: 'כל המשפטים באותו אורך — אין נשימה ואין מכה' },
    ],
    score: 3,
    worst: 'הכול',
    mode: 'copy',
  };
}

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
- "label" and "detail" MUST be written in HEBREW — the stage language.
  When critiquing copy, quote the actual words from the work.
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
      { type: 'hierarchy', severity: 5, x: 50, y: 40, label: 'אין היררכיה', detail: 'שום היררכיה ויזואלית לא מובילה את העין' },
      { type: 'touch_target', severity: 4, x: 50, y: 90, label: 'מטרות זעירות', detail: 'אזורי מגע קטנים מדי ללחיצה נוחה' },
      { type: 'contrast', severity: 3, x: 50, y: 15, label: 'קונטרסט חלש', detail: 'הטקסט נבלע ברקע' },
    ],
    print: [
      { type: 'headline', severity: 5, x: 50, y: 20, label: 'כותרת שלא אומרת כלום', detail: 'הכותרת יכולה לככב בכל מודעה בכל קטגוריה' },
      { type: 'cta', severity: 4, x: 50, y: 85, label: 'אין צעד הבא', detail: 'שום דבר לא אומר לקורא מה לעשות עכשיו' },
      { type: 'cliche', severity: 3, x: 50, y: 50, label: 'ריח של סטוק', detail: 'הוויזואל הזה נראה אלף פעמים' },
    ],
    art: [
      { type: 'concept_execution', severity: 5, x: 50, y: 40, label: 'אין רעיון', detail: 'ביצוע בלי קונספט נראה לעין מאחוריו' },
      { type: 'composition', severity: 4, x: 50, y: 60, label: 'העין הולכת לאיבוד', detail: 'אין מסלול לעין דרך הפריים' },
      { type: 'typography_pairing', severity: 3, x: 50, y: 25, label: 'פונטים רבים', detail: 'הגופנים מתחרים במקום להשלים' },
    ],
  };
  return { issues: byMode[mode] || byMode.ui, score: 3, worst: 'הכול', mode };
}

module.exports = { analyzeScreenshot, analyzeDocument };
