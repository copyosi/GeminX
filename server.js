require('dotenv').config();
const express      = require('express');
const http         = require('http');
const https        = require('https');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const { PORT, API_KEY } = require('./config');
const Orchestrator = require('./services/orchestrator');

if (!API_KEY) {
  console.error('❌  GEMINI_API_KEY is not set');
  process.exit(1);
}

const app  = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

// ─── HTTPS when certs exist (double-click make-cert.command once) ─────────
// Same pattern as iAYA: camera + mic from an iPad on the LAN require a
// secure context, so local runs get a self-signed cert instead of Cloud Run.
const CERT_KEY = path.join(__dirname, 'certs', 'server.key');
const CERT_CRT = path.join(__dirname, 'certs', 'server.crt');
const useTls   = fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT);
const server   = useTls
  ? https.createServer({ key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT) }, app)
  : http.createServer(app);

const orchestrator = new Orchestrator(server);

// ─── Routes ───────────────────────────────────────────────────────────────
app.post('/api/vision-tick',     (req, res) => orchestrator.handleVisionTick(req, res));
app.post('/api/vision-prefetch', (req, res) => orchestrator.handleVisionPrefetch(req, res));
app.post('/api/doc-critique',    (req, res) => orchestrator.handleDocCritique(req, res));
app.post('/api/phase',           (req, res) => orchestrator.handlePhaseChange(req, res));
app.get('/health',               (_,  res) => res.json(orchestrator.health()));
app.post('/api/clear-history',   (_,  res) => { require('./services/history').clear(); res.json({ status: 'cleared' }); });

// ─── Control Room (Yosef 22.7) — her prompts, his signature, a lab ────────
// Everything she is sent lives behind this endpoint — no copies, the real
// constants. The prompt law in UI form: the voice is edited HERE by Yosef,
// and nowhere else.
const prompts = require('./config/prompts');
const routerP = require('./services/router');
const { LabChat } = require('./services/lab');

app.get('/api/control/prompts', (_, res) => {
  const signed = fs.existsSync(prompts.VOICE_FILE);
  res.json({
    voice: {
      signed,
      source: signed ? 'config/voice.he.txt (חתום ע"י יוסף)' : 'FALLBACK (לא חתום — זמני)',
      text: signed ? fs.readFileSync(prompts.VOICE_FILE, 'utf8') : prompts.FALLBACK,
    },
    mechanics: prompts.MECHANICS,
    nudges: [
      { id: 'greet_nudge', title: 'פתיחה — סריקה חיה (בלי עבודה על השולחן)', when: 'לחיצה על Scan', text: Orchestrator.GREET_NUDGE, source: 'services/orchestrator.js' },
      { id: 'greet_with_work', title: 'פתיחה — עבודה שהועלתה (העין כבר נבחרה)', when: 'העלאת קובץ', text: Orchestrator.GREET_WITH_WORK('«סוג העבודה»'), source: 'services/orchestrator.js' },
      { id: 'scene_start', title: 'נעילה על מטרות — תחילת הקטילה', when: 'תוצאות וויז\'ן מוכנות', text: routerP.miniSceneStart([{ label: '«תווית»', detail: '«פירוט»', quote: '«ציטוט מהעבודה»', severity: 4, x: 50, y: 30 }], 'print'), source: 'services/router.js' },
      { id: 'continue', title: 'המשך — עוד מטרות', when: 'סימון וויז\'ן נוסף', text: routerP.miniContinue([{ label: '«תווית»', detail: '«פירוט»', severity: 3 }]), source: 'services/router.js' },
      { id: 'rescan', title: 'עבודה חדשה באותו סשן', when: 'העלאה נוספת תוך כדי', text: Orchestrator.RESCAN_NUDGE('«N»'), source: 'services/orchestrator.js' },
      { id: 'resume', title: 'חידוש אחרי נפילת חיבור', when: 'ה-Live API נופל וחוזר', text: Orchestrator.RESUME_NUDGE('\n\nהמטרות שעל השולחן:\n«המטרות»'), source: 'services/orchestrator.js' },
      { id: 'close', title: 'סגירה — הרידיזיין נבנה', when: 'לחיצה על Rebuild', text: routerP.miniClose(), source: 'services/router.js' },
    ],
    note: 'בנוסף מוזרק לפרומפט המערכת בלוק זיכרון (services/history.js) — תקציר תורות מסשנים קודמים.',
  });
});

app.post('/api/control/voice', (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'קול ריק לא נחתם' });
  fs.writeFileSync(prompts.VOICE_FILE, text + '\n');
  // Live agent picks it up on next (re)connect — no restart needed.
  const full = text + prompts.MECHANICS;
  orchestrator.agents.mini.systemPrompt = full;
  console.log(`[Control] ✍️ Voice signed by Yosef (${text.length} chars) → voice.he.txt + live agent`);
  res.json({ status: 'signed', chars: text.length });
});

// Lab chat — one session per channel, conversation continues until reset.
const lab = { birth: null, stage: null };
app.post('/api/control/chat', async (req, res) => {
  const { message, channel = 'birth', reset = false } = req.body || {};
  if (!['birth', 'stage'].includes(channel)) return res.status(400).json({ error: 'ערוץ לא מוכר' });
  if (reset) { lab[channel]?.close(); lab[channel] = null; }
  if (!message) return res.json({ status: reset ? 'reset' : 'noop' });
  try {
    if (!lab[channel]) {
      const signed = fs.existsSync(prompts.VOICE_FILE);
      const stagePrompt = (signed ? fs.readFileSync(prompts.VOICE_FILE, 'utf8').trim() : prompts.FALLBACK) + prompts.MECHANICS;
      lab[channel] = new LabChat(channel === 'birth' ? null : stagePrompt);
    }
    const reply = await lab[channel].send(String(message));
    res.json({ reply });
  } catch (e) {
    lab[channel]?.close(); lab[channel] = null;
    console.error('[Lab] chat failed:', e.message);
    res.status(502).json({ error: `הסשן נפל: ${e.message}. שלח שוב — ייפתח סשן חדש.` });
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────
function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const i of ifaces || [])
      if (i.family === 'IPv4' && !i.internal) return i.address;
  return 'localhost';
}

server.listen(PORT, () => {
  const proto = useTls ? 'https' : 'http';
  console.log(`\n🔥 MiniX running on :${PORT} (${proto})`);
  console.log(`   Mini → Aoede (solo, bidirectional)`);
  console.log(`   On this machine:  ${proto}://localhost:${PORT}`);
  console.log(`   On the iPad:      ${proto}://${lanIp()}:${PORT}`);
  if (!useTls) console.log(`   ⚠ no certs/ found — camera+mic from the iPad need HTTPS.`);
  if (!useTls) console.log(`     Double-click make-cert.command once, then restart.\n`);
  else console.log('');
});
