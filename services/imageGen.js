const { GoogleGenAI } = require('@google/genai');
const { API_KEY, IMAGE_MODEL } = require('../config');

const ai = new GoogleGenAI({ apiKey: API_KEY });

// ─── Per-mode redesign briefs ────────────────────────────────────────
// The old prompt was hardcoded for "mobile AI chat app" — on a print ad
// it produced nothing relevant (Yosef, 18.7: "אין עיצוב חדש מבננה").
// Each eye now hands Nano Banana the brief it actually needs.

const BRIEFS = {
  ui: `You are an elite UI/UX designer. Based on this critique of a mobile
app screen, generate a REDESIGNED version of the UI.

REQUIREMENTS:
- Dark theme (#0B0D10 background)
- Clean, modern, mobile-first design
- Fix ALL issues mentioned in the critique
- Keep the same general purpose as the original screen
- High contrast, clear hierarchy, proper touch targets`,

  print: `You are an elite advertising creative director and art director.
The attached image is a PRINT AD that was just critiqued live. Generate a
REDESIGNED version of the same ad.

REQUIREMENTS:
- Same brand, same product, same core message — this is a redesign, not
  a new campaign
- Fix ALL issues mentioned in the critique: headline, copy, hierarchy,
  CTA, clichés
- Keep all copy in its ORIGINAL LANGUAGE. Hebrew copy stays Hebrew,
  rendered correctly right-to-left
- One clear idea, one clear focal point, confident use of white space
- Print-ad format: full-page composition, production-ready feel`,

  art: `You are an elite art director. The attached image is a piece of
visual work (campaign visual, poster, layout, cover) that was just
critiqued live. Generate a CORRECTED version of the same work.

REQUIREMENTS:
- Same subject, same medium, same intent — fix the craft, don't replace
  the idea
- Fix ALL issues mentioned in the critique: composition, color story,
  typography pairing, concept execution
- Keep any text in its ORIGINAL LANGUAGE (Hebrew stays Hebrew, RTL)
- The eye should travel with intent; every color choice should mean
  something`,
};

const FALLBACK_CRITIQUE = {
  ui: 'Redesign this screen with better hierarchy, contrast and touch targets.',
  print: 'Redesign this ad: sharper headline, clear hierarchy, one focal point, a CTA that acts.',
  art: 'Correct this work: intentional composition, meaningful color, typography that pairs.',
};

/**
 * Nano Banana — Generate a redesigned image based on the live critique.
 * mode: 'ui' | 'print' | 'art' (defaults to 'ui').
 * Returns { mimeType, data } (base64) or null on failure.
 */
async function generateRedesign(critique, originalBase64, mode = 'ui') {
  const brief = BRIEFS[mode] || BRIEFS.ui;
  const critiqueText = (critique && critique.trim())
    ? critique.trim()
    : FALLBACK_CRITIQUE[mode] || FALLBACK_CRITIQUE.ui;

  const prompt = `${brief}

CRITIQUE (live, may be in Hebrew):
${critiqueText}`;

  try {
    const parts = [{ text: prompt }];
    // Include original as reference if available
    if (originalBase64) {
      const b64 = originalBase64.replace(/^data:image\/\w+;base64,/, '');
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
    }

    const result = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
    });

    // Extract image from response (SDK v2: candidates on result directly)
    const parts_out = result.candidates?.[0]?.content?.parts
                   ?? result.response?.candidates?.[0]?.content?.parts
                   ?? [];
    for (const part of parts_out) {
      if (part.inlineData) {
        console.log(`[NanoBanana] ✔ Generated image (${part.inlineData.mimeType}, mode: ${mode})`);
        return { mimeType: part.inlineData.mimeType, data: part.inlineData.data };
      }
    }
    console.warn('[NanoBanana] No image in response');
    return null;
  } catch (err) {
    console.error('[NanoBanana]', err.message);
    return null;
  }
}

module.exports = { generateRedesign };
