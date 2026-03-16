module.exports = [{
  functionDeclarations: [
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
