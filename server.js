require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { PORT, API_KEY } = require('./config');
const Orchestrator = require('./services/orchestrator');

if (!API_KEY) {
  console.error('❌  GEMINI_API_KEY is not set');
  process.exit(1);
}

const app  = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

const server       = http.createServer(app);
const orchestrator = new Orchestrator(server);

// ─── Routes ───────────────────────────────────────────────────────────────
app.post('/api/vision-tick',     (req, res) => orchestrator.handleVisionTick(req, res));
app.post('/api/vision-prefetch', (req, res) => orchestrator.handleVisionPrefetch(req, res));
app.post('/api/phase',           (req, res) => orchestrator.handlePhaseChange(req, res));
app.get('/health',               (_,  res) => res.json(orchestrator.health()));
app.post('/api/clear-history',   (_,  res) => { require('./services/history').clear(); res.json({ status: 'cleared' }); });

// ─── Boot ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🔥 MiniX running on :${PORT}`);
  console.log(`   Mini → Aoede (solo, bidirectional)`);
  console.log(`   Flow: VOID → ROAST → BUILD → CREDITS`);
  console.log(`   http://localhost:${PORT}\n`);
});
