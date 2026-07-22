// MiniX v2 tools — scene-free. The old hackathon tools (annotate_ui with
// its hardcoded "Gemini's iPad home screen" targets, render_new_ui) are
// gone: their descriptions kept whispering UI-world context into MiniX
// on every print/art session, and annotate_ui's fixed positions produced
// meaningless marks on anything that isn't the old demo screen.
module.exports = [{
  functionDeclarations: [
    {
      name: 'annotate_at',
      description: 'Draw a red critique mark at an exact spot on whatever the camera sees (interface, print ad, poster). x/y are PERCENT of the frame, 0-100. Add a short roast label in Hebrew.',
      parameters: {
        type: 'OBJECT',
        properties: {
          x:     { type: 'NUMBER', description: 'Horizontal position, percent 0-100' },
          y:     { type: 'NUMBER', description: 'Vertical position, percent 0-100' },
          label: { type: 'STRING', description: 'Short roast label, max 5 words, in Hebrew' },
        },
        required: ['x', 'y', 'label']
      }
    },
    {
      name: 'start_rebuild',
      description: 'Start the Nano Banana redesign of the work being critiqued. Call this when the human asks you to fix/redesign it ("תקני", "תבני מחדש", "fix it") or when you finish the roast and offer a fix and they agree. Never call it uninvited mid-roast.',
      parameters: { type: 'OBJECT', properties: {}, required: [] }
    },
    {
      name: 'set_mode',
      description: 'Set which critique eye you are wearing. Call this once at the start, right after the human answers your opening question about what we are killing today (copywriting/print → print, interface/app → ui, art direction/concept/storyboard → art). Call again only if the subject changes.',
      parameters: {
        type: 'OBJECT',
        properties: {
          mode: { type: 'STRING', enum: ['ui', 'print', 'art'], description: 'The critique eye to wear' },
        },
        required: ['mode']
      }
    }
  ]
}];
