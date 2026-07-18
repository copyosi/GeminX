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
  ui:    'ממשק',
  print: 'מודעת פרינט',
  art:   'עבודה ויזואלית',
  // legacy visual states from the hackathon build still resolve:
  main_screen: 'מסך הבית של האפליקציה',
  menu_open:   'מגירת הניווט',
  live_ui:     'מסך השיחה החיה',
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
    return `\n(כבר כוסה: ${covered.join(', ')} — עברי למשהו חדש)`;
  }
  return '';
}

// ── Humanize vision JSON → natural language ──────────────────────────

function humanizeIssues(issues, score, worst) {
  if (!issues || issues.length === 0) return 'משהו בעבודה לא עובד אבל קשה לשים עליו אצבע.';
  const lines = issues.map(i => {
    const pos = `(${i.x},${i.y})`;
    const sev = i.severity >= 4 ? 'חמור' : i.severity >= 3 ? 'בולט' : 'קל';
    return `${sev}: ${i.label} — ${i.detail} ${pos}`;
  });
  let out = lines.join('\n');
  if (score != null) out += `\nציון כולל: ${score}/10.`;
  if (worst) out += ` האזור הגרוע: ${worst}.`;
  return out;
}

// ─── GREET — no script: MiniX is just... on ──────────────────────────

function miniGreet() {
  return `את בשידור. מישהו כיוון מצלמה על עבודה שהוא רוצה ביקורת עליה.
ברכי במשפט קצר אחד ושאלי על מה את מסתכלת. בעברית. בלי הצגה — את
מבקרת על השעון.`;
}

// ─── LOCK-ON — first roast turn (real critique, no scene framing) ────

function miniSceneStart(issues, visualState) {
  const subject = MODE_LABEL[visualState] || 'העבודה שמולך';
  const issueText = humanizeIssues(issues);

  return `המצלמה ננעלה על ${subject}. זו ביקורת חיה אמיתית — מי שיצר
את זה אולי בחדר ואולי יענה לך.

מטרות:
${issueText}

קטלי. בעברית בלבד. מטרה אחת בכל פעם — צטטי את מה שבאמת כתוב/נראה
בעבודה, לא כלליות.`;
}

// ─── ROAST CONTINUE — nudge if MiniX pauses ─────────────────────────

function miniContinue(issues) {
  const issueText = humanizeIssues(issues);
  return `המשיכי. עוד מטרות:\n${issueText}`;
}

// ─── LEGACY — kept for orchestrator compatibility ────────────────────

function miniRoast(issues, visualState) {
  return miniSceneStart(issues, visualState);
}

function miniRoastContinue(miniPrevious, visualState, history) {
  const ctx = history ? `\nמה שאמרת עד עכשיו:\n${history}` : '';
  const mode = ['ui', 'print', 'art'].includes(visualState) ? visualState : 'ui';

  return `כבר אמרת: "${miniPrevious}"${ctx}

סימון חדש (אדום). לכי עמוק יותר — מצאי משהו אחר.${topicHint(history, mode)}`;
}

// ─── CLOSE — Transition to BUILD ────────────────────────────────────

function miniClose() {
  return `הרוסט נגמר. משפט אחד בעברית: מה הדבר האחד שחייב להשתנות —
ושנאנו-בננה כבר עובדת על זה.`;
}

module.exports = {
  miniGreet,
  miniSceneStart, miniContinue,
  miniRoast, miniRoastContinue,
  miniClose,
  humanizeIssues,
};
