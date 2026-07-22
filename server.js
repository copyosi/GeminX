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
