const { GoogleGenAI } = require('@google/genai');
const { API_KEY, IMAGE_MODEL } = require('../config');

const ai = new GoogleGenAI({ apiKey: API_KEY });

/**
 * Nano Banana — Generate a redesigned UI image based on the roast critique.
 * Returns { mimeType, data } (base64) or null on failure.
 */
async function generateRedesign(critique, originalBase64) {
  const prompt = `You are an elite UI/UX designer. Based on this critique of a mobile app screen, generate a REDESIGNED version of the UI.

CRITIQUE:
${critique}

REQUIREMENTS:
- Dark theme (#0B0D10 background)
- Clean, modern, mobile-first design
- Fix ALL issues mentioned in the critique
- Keep the same general purpose (chat/AI assistant app)
- Make it beautiful and functional
- High contrast, clear hierarchy, proper touch targets`;

  try {
    const parts = [{ text: prompt }];
    // Include original screenshot as reference if available
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
        console.log(`[NanoBanana] ✔ Generated image (${part.inlineData.mimeType})`);
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
