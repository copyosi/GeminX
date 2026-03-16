/**
 * GeminiX Router — Mini solo prompts
 *
 * What we pass each turn:
 *   1. Vision issues (coordinates for annotate_ui)
 *   2. Debate history (prevents repetition)
 *   3. Light topic hint (covered vs fresh)
 *
 * What we DON'T do:
 *   - No tone modifiers (character is in the system prompt)
 *   - No sentence limits (prompt handles it)
 *   - No scripted lines (breaks immersion)
 */

const SCREEN_LABEL = {
  main_screen: 'the Gemini HOME screen',
  menu_open:   'the Gemini MENU / navigation drawer',
  live_ui:     'the Gemini LIVE conversation screen',
};

// ── Light topic tracking ─────────────────────────────────────────────

const UI_ASPECTS = [
  { re: /spac|margin|padding|gap|layout|align|grid/i,    label: 'spacing/layout' },
  { re: /color|palette|contrast|theme|dark|white|grey/i,  label: 'colors/contrast' },
  { re: /font|text|typograph|readab|size|weight/i,         label: 'typography' },
  { re: /button|click|tap|touch|target|press/i,            label: 'touch targets' },
  { re: /nav|menu|drawer|hamburger|tab|bar/i,              label: 'navigation' },
  { re: /icon|image|visual|graphic|illustr/i,              label: 'icons/visuals' },
  { re: /hierarch|priority|flow|scan|eye|attention/i,      label: 'visual hierarchy' },
  { re: /empty|blank|waste|space|clutter|dense/i,          label: 'density/whitespace' },
  { re: /consistent|system|pattern|reuse/i,                label: 'design consistency' },
  { re: /access|a11y|screen.?read|disab/i,                 label: 'accessibility' },
];

function topicHint(history) {
  if (!history || history.length < 10) return '';
  const h = history.toLowerCase();
  const covered = UI_ASPECTS.filter(a => a.re.test(h)).map(a => a.label);
  const fresh   = UI_ASPECTS.filter(a => !a.re.test(h)).map(a => a.label);
  if (fresh.length > 0 && covered.length > 0) {
    return `\n(Already covered: ${covered.join(', ')} — try something new)`;
  }
  return '';
}

// ── Humanize vision JSON → natural language ──────────────────────────

function humanizeIssues(issues, score, worst) {
  if (!issues || issues.length === 0) return 'The screen looks off but hard to pin down.';
  const lines = issues.map(i => {
    const pos = `(${i.x},${i.y})`;
    const sev = i.severity >= 4 ? 'major' : i.severity >= 3 ? 'notable' : 'minor';
    return `${sev}: ${i.label} — ${i.detail} ${pos}`;
  });
  let out = lines.join('\n');
  if (score != null) out += `\nOverall score: ${score}/10.`;
  if (worst) out += ` Worst area: ${worst}.`;
  return out;
}

// ─── GREET — Mini's opening dialogue with Yosef ─────────────────────

function miniGreet() {
  return `You just woke up. Yosef is here. Gemini volunteered to be roasted.
Say: "Hey Yosef." Wait for his response. Then say: "I heard Gemini volunteered."
Then: "Alright. You asked for it. Let's go."
Short. Confident. No rush.`;
}

// ─── SCENE START — Mini's first roast turn (filmed scene context) ────

function miniSceneStart(issues, visualState) {
  const screen = SCREEN_LABEL[visualState] || 'the current screen';
  const issueText = humanizeIssues(issues);

  return `This is a filmed scene of a funny live conversation between different AI models in a UX critique app. The lead actress is Mini, part of the GeminiX system. She's a sharp designer. She can hear the environment. ChatGPT and Grok refused to be roasted. Gemini volunteered. You're live with Gemini now. Roast his interface. He will defend. You will win.

You're looking at ${screen}. ${issueText}

Go.`;
}

// ─── ROAST CONTINUE — nudge if Mini pauses ──────────────────────────

function miniContinue(issues) {
  const issueText = humanizeIssues(issues);
  return `Keep going. More issues:\n${issueText}`;
}

// ─── LEGACY — kept for orchestrator compatibility ────────────────────

function miniRoast(issues, visualState) {
  return miniSceneStart(issues, visualState);
}

function miniRoastContinue(miniPrevious, visualState, history) {
  const ctx = history ? `\nYOU SAID SO FAR:\n${history}` : '';

  return `You already said: "${miniPrevious}"${ctx}

New mark (RED). Go deeper — find something else.${topicHint(history)}`;
}

// ─── CLOSE — Transition to BUILD ────────────────────────────────────

function miniClose() {
  return `Roast's over. Say: "Jam, hand this to Nano Banana." — that triggers the rebuild pipeline.`;
}

module.exports = {
  miniGreet,
  miniSceneStart, miniContinue,
  miniRoast, miniRoastContinue,
  miniClose,
  humanizeIssues,
};
