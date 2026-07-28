import WebSocket from 'ws';
import { fetchJson } from '../http.js';
import { sleep, randomChoice, createSessionGuards } from './shared.js';

const BLOOKET = {
  join: 'https://api.blooket.com/api/firebase/join',
  verify: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=AIzaSyCA-cTOnX19f6LFnDVVsHXya3k6ByP_MnU',
  checkPin: (pin) => `https://api.blooket.com/api/firebase/id?id=${pin}`,
};

const SERVER_CODES = [
  1476, 2018, 2025, 2037, 1570, 2520, 2050, 522, 1402, 2034,
  1444, 1755, 1758, 1757, 1756, 1751, 1755,
];

const BLOOKS = [
  'Chick', 'Chicken', 'Cow', 'Goat', 'Horse', 'Pig', 'Sheep', 'Duck', 'Dog', 'Cat',
  'Rabbit', 'Goldfish', 'Hamster', 'Turtle', 'Kitten', 'Puppy', 'Bear', 'Moose', 'Fox',
];

function randomBlook() {
  return BLOOKS[Math.floor(Math.random() * BLOOKS.length)];
}

function authorizeMessage(token) {
  return JSON.stringify({ t: 'd', d: { r: 1, a: 'auth', b: { cred: token } } });
}

function joinMessage(pin, name, blook) {
  return JSON.stringify({
    t: 'd',
    d: { r: 2, a: 'p', b: { p: `/${pin}/c/${name}`, d: { b: blook } } },
  });
}

function answerMessage(pin, name, choice, reqId) {
  return JSON.stringify({
    t: 'd',
    d: { r: reqId, a: 'p', b: { p: `/${pin}/c/${name}`, d: { c: choice } } },
  });
}

async function findSocketUrl(serverCode) {
  return new Promise((resolve) => {
    const fallback = `wss://s-usc1c-nss-200.firebaseio.com/.ws?v=5&ns=blooket-${serverCode}`;
    const probe = new WebSocket(fallback);
    const timer = setTimeout(() => {
      probe.close();
      resolve(fallback);
    }, 4000);

    probe.on('message', (raw) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(raw.toString());
        if (data?.d?.t === 'r' && data?.d?.d) {
          resolve(`wss://${data.d.d}/.ws?v=5&ns=blooket-${serverCode}`);
        } else {
          resolve(fallback);
        }
      } catch {
        resolve(fallback);
      }
      probe.close();
    });

    probe.on('error', () => {
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}

async function getAuthToken(pin, name) {
  const alive = await fetchJson(BLOOKET.checkPin(pin));
  if (!alive.ok || !alive.body?.success) {
    throw new Error(alive.body?.msg || 'Game not found or not active');
  }

  const joinRes = await fetchJson(BLOOKET.join, {
    method: 'PUT',
    headers: { Referer: 'https://www.blooket.com/' },
    body: JSON.stringify({ id: pin, name }),
  });

  if (!joinRes.ok || !joinRes.body?.fbToken) {
    const msg = joinRes.body?.msg || 'Failed to join game';
    throw new Error(msg);
  }

  const verifyRes = await fetchJson(BLOOKET.verify, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true, token: joinRes.body.fbToken }),
  });

  if (!verifyRes.ok || !verifyRes.body?.idToken) {
    throw new Error('Failed to verify Blooket token');
  }

  return verifyRes.body.idToken;
}

function shouldAnswerFromPayload(data) {
  if (!data || typeof data !== 'object') return false;
  return data.q !== undefined
    || data.question !== undefined
    || data.questionText !== undefined
    || data.answers !== undefined
    || data.correct !== undefined;
}

function isGameEndMessage(msg, rawText) {
  const payload = msg?.d?.d?.b?.d;
  const path = msg?.d?.d?.b?.p;

  if (payload && typeof payload === 'object') {
    if (payload.stg === 'end' || payload.stg === 'final' || payload.ended === true) return true;
    if (payload.state === 'end' || payload.gameOver === true) return true;
    if (payload.winner !== undefined && payload.k === true) return true;
  }

  if (typeof path === 'string' && /\/end$|\/final$|\/state$/.test(path)) return true;
  if (/game.?end|ended|winner|final.?standings/i.test(rawText)) return true;

  return false;
}

export async function spawnBlooketBots({ pin, names, joinDelayMs = 200 }) {
  const tasks = names.map((name, index) => sleep(index * joinDelayMs).then(() => spawnSingleBlooketBot(pin, name)));
  return Promise.all(tasks);
}

function spawnSingleBlooketBot(pin, name) {
  return new Promise(async (resolve) => {
    const stats = {
      name,
      platform: 'blooket',
      joined: false,
      answers: 0,
      status: 'pending',
      error: null,
      endReason: null,
    };

    let ws = null;
    let reqId = 3;
    let lastAnswerAt = 0;

    const { finish: endSession, clearJoinTimeout } = createSessionGuards({
      onFinish: (status, error = null) => {
        stats.status = status;
        stats.error = error;
        stats.endReason = error || status;
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        resolve(stats);
      },
    });

    try {
      const token = await getAuthToken(pin, name);
      const socketUrl = await findSocketUrl(SERVER_CODES[Math.floor(Math.random() * SERVER_CODES.length)]);
      ws = new WebSocket(socketUrl);

      ws.on('open', () => {
        ws.send(authorizeMessage(token));
        ws.send(joinMessage(pin, name, randomBlook()));
        stats.joined = true;
        stats.status = 'joined';
        clearJoinTimeout();
      });

      ws.on('message', (raw) => {
        const rawText = raw.toString();
        try {
          const msg = JSON.parse(rawText);
          if (isGameEndMessage(msg, rawText)) {
            endSession('completed', 'Game ended');
            return;
          }

          const payload = msg?.d?.d?.b?.d;
          if (!shouldAnswerFromPayload(payload)) return;

          const now = Date.now();
          if (now - lastAnswerAt < 400) return;
          lastAnswerAt = now;

          const choice = randomChoice(4);
          ws.send(answerMessage(pin, name, choice, reqId++));
          stats.answers += 1;
        } catch {
          if (/game.?end|ended|winner/i.test(rawText)) {
            endSession('completed', 'Game ended');
          }
        }
      });

      ws.on('error', () => {
        endSession(stats.joined ? 'disconnected' : 'failed', 'WebSocket error');
      });

      ws.on('close', () => {
        if (!stats.joined) {
          endSession('failed', 'Connection closed before joining');
          return;
        }
        endSession('completed', 'Game session closed');
      });
    } catch (err) {
      endSession('failed', err.message);
    }
  });
}