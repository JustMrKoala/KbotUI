import { requireField } from './lib/validators.js';
import { buildPlayerNames, clampNumber, MAX_BOTS } from './lib/quizBots/shared.js';
import { spawnKahootBots } from './lib/quizBots/kahoot.js';
import { spawnBlooketBots } from './lib/quizBots/blooket.js';
import { spawnGimkitBots } from './lib/quizBots/gimkit.js';
import { spawnLessonUpBots } from './lib/quizBots/lessonup.js';

const PLATFORMS = {
  kahoot: {
    label: 'Kahoot',
    joinUrl: (pin) => `https://kahoot.it/?pin=${pin}`,
    spawn: spawnKahootBots,
  },
  blooket: {
    label: 'Blooket',
    joinUrl: (pin) => `https://www.blooket.com/play/${pin}`,
    spawn: spawnBlooketBots,
  },
  gimkit: {
    label: 'Gimkit',
    joinUrl: (pin) => `https://www.gimkit.com/join/${pin}`,
    spawn: spawnGimkitBots,
  },
  lessonup: {
    label: 'LessonUp',
    joinUrl: () => 'https://lessonup.app/join',
    spawn: spawnLessonUpBots,
  },
};

function normalizePlatform(value) {
  const key = value?.toString().trim().toLowerCase();
  if (!PLATFORMS[key]) {
    throw new Error('Platform must be Kahoot, Blooket, Gimkit, or LessonUp');
  }
  return key;
}

export async function quizGameBot({ platform, gamePin, playerCount, namePrefix }) {
  const selected = normalizePlatform(platform);
  const pin = requireField(gamePin, 'gamePin').replace(/\s+/g, '');
  const count = clampNumber(playerCount, 1, MAX_BOTS, 5);
  const names = buildPlayerNames(namePrefix || 'Bot', count);
  const meta = PLATFORMS[selected];

  const players = await meta.spawn({ pin, names });

  const joined = players.filter((p) => p.joined).length;
  const failed = players.filter((p) => !p.joined).length;
  const completed = players.filter((p) => p.status === 'completed').length;
  const totalAnswers = players.reduce((sum, p) => sum + (p.answers || 0), 0);

  return {
    platform: meta.label,
    gamePin: pin,
    joinUrl: meta.joinUrl(pin),
    config: {
      playerCount: count,
      namePrefix: namePrefix?.trim() || 'Bot',
      runMode: 'until_game_end',
      answerMode: 'random',
      maxBots: MAX_BOTS,
    },
    summary: {
      attempted: players.length,
      joined,
      failed,
      completed,
      totalAnswers,
      successRate: players.length ? `${Math.round((joined / players.length) * 100)}%` : '0%',
    },
    players,
    note: joined
      ? `Spawned ${joined} bot(s) on ${meta.label}. Bots stay active until the game ends, then return results.`
      : 'No bots joined. Verify the game pin, that the host has started the lobby, and that the game is not locked.',
  };
}