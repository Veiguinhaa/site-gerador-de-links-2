const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const upload = multer();

// ====== Proteção opcional por PIN ======
// Defina no Railway: Variables -> ACCESS_PIN=1234
const ACCESS_PIN = process.env.ACCESS_PIN || ''; // se vazio, não exige PIN

function pinGate(req, res, next) {
  if (!ACCESS_PIN) return next();

  // Aceita PIN via query (?pin=1234) ou header x-pin
  const pin = (req.query.pin || req.headers['x-pin'] || '').toString();
  if (pin !== ACCESS_PIN) {
    return res.status(401).send('Acesso negado. PIN inválido.');
  }
  next();
}

// ====== Rate limit (anti-abuso) ======
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 30, // 30 requests/min por IP
  standardHeaders: true,
  legacyHeaders: false
});

// Serve arquivos estáticos
app.use(express.static(path.join(__dirname)));
app.use(limiter);

// Página principal
app.get('/', pinGate, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Processar links
app.post('/processar', pinGate, upload.none(), (req, res) => {
  const links = req.body.links;
  if (!links) return res.status(400).send('Nenhum link enviado.');

  const child = spawn('node', ['extrair.js']);

  let out = '';
  let err = '';

  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (err += d.toString()));

  child.on('close', () => {
    if (err) {
      console.error('Erro no extrair.js:', err);
      return res.status(500).send('Erro ao processar os links.');
    }
    res.type('text/plain').send(out);
  });

  child.stdin.write(links);
  child.stdin.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
