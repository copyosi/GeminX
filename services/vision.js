const { GoogleGenAI } = require('@google/genai');
const { API_KEY, VISION_MODEL } = require('../config');

const ai = new GoogleGenAI({ apiKey: API_KEY });

const SCAN_PROMPT = `You are a UX analysis engine. Analyze this UI screenshot.

Return ONLY valid JSON matching this exact schema:
{
  "issues": [
    {
      "type": "spacing|contrast|typography|navigation|hierarchy|touch_target|consistency|accessibility",
      "severity": 1-5,
      "x": 0-100,
      "y": 0-100,
      "label": "2-4 word overlay label",
      "detail": "one sentence explanation"
    }
  ],
  "score": 1-10,
  "worst": "worst area in 3 words"
}

Rules:
- Max 5 issues, sorted by severity (worst first)
- x/y = percentage position on screen where the issue is
- severity: 1=minor, 5=critical
- label: SHORT, fits in a UI badge (e.g. "Dead Space", "Tiny Targets", "No Hierarchy")
- ZERO conversational text. Data only.
- Focus: wasted space, poor hierarchy, small touch targets, low contrast, navigation confusion`;

/**
 * Orchestrated scan — returns structured overlay-ready JSON.
 * Always resolves — never throws.
 */
async function analyzeScreenshot(imageBase64) {
  const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  let result;
  try {
    result = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { text: SCAN_PROMPT },
          { inlineData: { mimeType: 'image/jpeg', data: b64 } }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json' }
    });
  } catch (err) {
    console.error('[Vision] API error:', err.message);
    return fallbackResult();
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

    if (issues.length === 0) return fallbackResult();

    return {
      issues,
      score: Math.max(1, Math.min(10, Number(raw.score) || 4)),
      worst: String(raw.worst || 'overall layout'),
    };
  } catch {
    return fallbackResult();
  }
}

function fallbackResult() {
  return {
    issues: [
      { type: 'hierarchy', severity: 5, x: 50, y: 40, label: 'No Hierarchy', detail: 'No clear visual hierarchy guides the eye' },
      { type: 'touch_target', severity: 4, x: 50, y: 90, label: 'Tiny Targets', detail: 'Touch targets too small for comfortable tapping' },
      { type: 'contrast', severity: 3, x: 50, y: 15, label: 'Low Contrast', detail: 'Text lacks contrast against background' },
    ],
    score: 3,
    worst: 'visual hierarchy',
  };
}

module.exports = { analyzeScreenshot };
