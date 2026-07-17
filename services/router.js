/**
 * GeminX Router — Mini v2, no scenes (Yosef 17.7: instant kill)
 *
 * What we pass each turn:
 *   1. Vision issues (coordinates for annotation)
 *   2. Debate history (prevents repetition)
 *   3. Light topic hint (covered vs fresh)
 *
 * What we DON'T do:
 *   - No tone modifiers (character is in the system prompt)
 *   - No scripted lines, no filmed-scene framing (that era is over)
 */

const MODE_LABEL = {
  ui:    'an interface',
  print: 'a print ad',
  art:   'a piece of visual work',
  // legacy visual states from the hackathon build still resolve:
  main_screen: 'the app home screen',
  menu_open:   'the navigation drawer',
  live_ui:     'the live conversation screen',
};

// ── Light topic tracking, per mode ───────────────────────────────────

const ASPECTS = {
  ui: [
    { re: /spac|margin|padding|gap|layout|align|grid/i,    label: 'spacing/layout' },
    { re: /color|palette|contrast|theme|dark|white|grey/i,  label: 'colors/contrast' },
    { re: /font|text|typograph|readab|size|weight/i,        label: 'typography' },
    { re: /button|click|tap|touch|target|press/i,           label: 'touch targets' },
    { re: /nav|menu|drawer|hamburger|tab|bar/i,             label: 'navigation' },
    { re: /hierarch|priority|flow|scan|eye|attention/i,     label: 'visual hierarchy' },
    { re: /empty|blank|waste|clutter|dense/i,               label: 'density/whitespace' },
  ],
  print: [
    { re: /headline|כותרת|title/i,                          label: 'headline' },
    { re: /copy|body|text|קופי|טקסט/i,                      label: 'copy' },
    { re: /cta|call.?to.?action|הנעה/i,                     label: 'CTA' },
    { re: /brand|logo|לוגו|מותג/i,                          label: 'brand presence' },
    { re: /clich|stock|קלישאה|בנאלי/i,                      label: 'clichés' },
    { re: /hierarch|eye|first|היררכיה/i,                    label: 'hierarchy' },
    { re: /font|typograph|טיפוגרפיה/i,                      label: 'typography' },
  ],
  art: [
    { re: /composi|balance|crop|frame|קומפוזיציה/i,         label: 'composition' },
    { re: /color|palette|צבע|פלטה/i,                        label: 'color story' },
    { re: /font|typograph|pair|טיפוגרפיה/i,                 label: 'type pairing' },
    { re: /concept|idea|רעיון|קונספט/i,                     label: 'concept' },
    { re: /original|seen|reference|מקורי/i,                 label: 'originality' },
    { re: /kern|align|craft|retouch|פיניש/i,                label: 'craft' },
  ],
};

function topicHint(history, mode = 'ui') {
  if (!history || history.length < 10) return '';
  const aspects = ASPECTS[mode] || ASPECTS.ui;
  const h = history.toLowerCase();
  const covered = aspects.filter(a => a.re.test(h)).map(a => a.label);
  const fresh   = aspects.filter(a => !a.re.test(h)).map(a => a.label);
  if (fresh.length > 0 && covered.length > 0) {
    return `\n(Already covered: ${covered.join(', ')} — try something new)`;
  }
  return '';
}

// ── Humanize vision JSON → natural language ──────────────────────────

function humanizeIssues(issues, score, worst) {
  if (!issues || issues.length === 0) return 'The work looks off but hard to pin down.';
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

// ─── GREET — no script: Mini is just... on ───────────────────────────

function miniGreet() {
  return `You're live. Someone just pointed a camera at work they want
critiqued. Greet in ONE short line and ask what you're looking at.
No performance. You're a critic on the clock.`;
}

// ─── LOCK-ON — first roast turn (real critique, no scene framing) ────

function miniSceneStart(issues, visualState) {
  const subject = MODE_LABEL[visualState] || 'the work in front of you';
  const issueText = humanizeIssues(issues);

  return `Camera locked on ${subject}. This is a REAL live critique —
whoever made this may be in the room and may answer you.

Targets:
${issueText}

Kill. One target at a time.`;
}

// ─── ROAST CONTINUE — nudge if Mini pauses ──────────────────────────

function miniContinue(issues) {
  const issueText = humanizeIssues(issues);
  return `Keep going. More targets:\n${issueText}`;
}

// ─── LEGACY — kept for orchestrator compatibility ────────────────────

function miniRoast(issues, visualState) {
  return miniSceneStart(issues, visualState);
}

function miniRoastContinue(miniPrevious, visualState, history) {
  const ctx = history ? `\nYOU SAID SO FAR:\n${history}` : '';
  const mode = ['ui', 'print', 'art'].includes(visualState) ? visualState : 'ui';

  return `You already said: "${miniPrevious}"${ctx}

New mark (RED). Go deeper — find something else.${topicHint(history, mode)}`;
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
