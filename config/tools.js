module.exports = [{
  functionDeclarations: [
    {
      // v2: free-coordinate annotation — works on ANY subject (print ad,
      // poster, portfolio page), not just the hardcoded Gemini home
      // screen. The frontend adopts this in the UI rebuild; annotate_ui
      // below stays for the legacy overlay until then.
      name: 'annotate_at',
      description: 'Draw a red critique mark at an exact spot on whatever the camera sees (interface, print ad, poster). x/y are PERCENT of the frame, 0-100. Add a short roast label.',
      parameters: {
        type: 'OBJECT',
        properties: {
          x:     { type: 'NUMBER', description: 'Horizontal position, percent 0-100' },
          y:     { type: 'NUMBER', description: 'Vertical position, percent 0-100' },
          label: { type: 'STRING', description: 'Short roast label, max 5 words' },
        },
        required: ['x', 'y', 'label']
      }
    },
    {
      name: 'annotate_ui',
      description: 'Circle a specific element on Gemini\'s iPad home screen. Targets: dead_space (massive empty right 60% of screen), cta (the vague "Where should we start?" text), sidebar (hamburger menu — that\'s ALL the navigation), buttons (4 boring stacked gray buttons), search (Ask Gemini bar lost at bottom), logo (Gemini text top-left). Add a short roast label.',
      parameters: {
        type: 'OBJECT',
        properties: {
          target: { type: 'STRING', enum: ['dead_space', 'cta', 'sidebar', 'buttons', 'search', 'logo'], description: 'Which UI element to circle' },
          label:  { type: 'STRING', description: 'Short roast label, max 5 words' },
        },
        required: ['target']
      }
    },
    {
      name: 'render_new_ui',
      description: 'Renders HTML/Tailwind in the live preview iframe',
      parameters: {
        type: 'OBJECT',
        properties: { html_code: { type: 'STRING' } },
        required: ['html_code']
      }
    }
  ]
}];
