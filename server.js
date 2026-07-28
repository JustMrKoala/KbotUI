import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { quizGameBot } from './quizBots.js';
import { MAX_BOTS } from './lib/quizBots/shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/info', (_req, res) => {
  res.json({
    name: 'KoalaBotter',
    platforms: ['Kahoot', 'Blooket', 'Gimkit', 'LessonUp'],
    maxBots: MAX_BOTS,
    defaultBotCount: 5,
  });
});

app.post('/api/spawn', async (req, res) => {
  try {
    const { platform, gamePin, playerCount, namePrefix } = req.body ?? {};
    const result = await quizGameBot({ platform, gamePin, playerCount, namePrefix });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`\n  KoalaBotter`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  ─────────────────────────────\n`);
});