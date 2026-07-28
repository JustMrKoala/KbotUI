import { createRequire } from 'module';
import { sleep, randomChoice, createSessionGuards } from './shared.js';

const require = createRequire(import.meta.url);
const Kahoot = require('kahoot.js-latest');

export async function spawnKahootBots({ pin, names, joinDelayMs = 150 }) {
  const tasks = names.map((name, index) => sleep(index * joinDelayMs).then(() => spawnSingleKahootBot(pin, name)));
  return Promise.all(tasks);
}

function spawnSingleKahootBot(pin, name) {
  return new Promise((resolve) => {
    const client = new Kahoot();
    const stats = {
      name,
      platform: 'kahoot',
      joined: false,
      answers: 0,
      status: 'pending',
      error: null,
      endReason: null,
    };

    const { finish: endSession, clearJoinTimeout } = createSessionGuards({
      onFinish: (status, error = null) => {
        stats.status = status;
        stats.error = error;
        stats.endReason = error || status;
        try {
          client.leave();
        } catch {
          /* ignore */
        }
        resolve(stats);
      },
    });

    client.on('Joined', () => {
      stats.joined = true;
      stats.status = 'joined';
      clearJoinTimeout();
    });

    client.on('QuestionStart', (question) => {
      const choices = question.numberOfAnswers
        || question.choices?.length
        || question.quizQuestionAnswers?.[question.questionIndex]
        || 4;
      const pick = randomChoice(choices);
      const answerFn = typeof question.answer === 'function' ? question.answer.bind(question) : client.answer.bind(client);
      answerFn(pick)
        .then(() => {
          stats.answers += 1;
        })
        .catch(() => {});
    });

    client.on('QuizEnd', () => {
      endSession('completed', 'Quiz ended');
    });

    client.on('Disconnect', (reason) => {
      endSession(stats.joined ? 'disconnected' : 'failed', reason || 'Disconnected');
    });

    client.join(pin, name)
      .then(() => {})
      .catch((err) => {
        endSession('failed', err?.description || err?.message || String(err));
      });
  });
}