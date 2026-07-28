import WebSocket from 'ws';
import * as cheerio from 'cheerio';
import StegCloak from 'stegcloak';
import { fetchJson, fetchText } from '../http.js';
import { encodeBlueboatJoin, encodeBlueboatAnswer } from './gimkitBlueboat.js';
import { sleep, randomChoice, createSessionGuards } from './shared.js';

const GIMKIT = {
  roomInfo: 'https://www.gimkit.com/api/matchmaker/find-info-from-code',
  join: 'https://www.gimkit.com/api/matchmaker/join',
  joinPage: 'https://www.gimkit.com/join',
};

async function getClientType() {
  const { ok, body } = await fetchText(GIMKIT.joinPage, {
    headers: { Referer: 'https://www.gimkit.com/' },
  });
  if (!ok) throw new Error('Failed to load Gimkit join page');

  const $ = cheerio.load(body);
  const jidMeta = $('meta[property="int:jid"]').attr('content');
  if (!jidMeta) throw new Error('Could not read Gimkit client token');

  const jid = jidMeta.split('').reverse().join('');
  return new StegCloak(true, false).hide(jid, 'BSKA', 'Gimkit Web Client V3.1');
}

async function getRoomInfo(pin) {
  const res = await fetchJson(GIMKIT.roomInfo, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.gimkit.com',
      Referer: 'https://www.gimkit.com/join',
    },
    body: JSON.stringify({ code: pin }),
  });

  if (!res.ok || !res.body?.roomId) {
    throw new Error(res.body?.message || res.body?.error || 'Game not found');
  }

  return res.body;
}

function isGameEndMessage(text) {
  return /GAME_END|GAME_OVER|COMPLETED_ASSIGNMENT|ASSIGNMENT_COMPLETE|ROOM_CLOSED|ROOM_ENDED|game.?end|session.?end/i.test(text);
}

function extractQuestionFromMessage(raw) {
  const text = typeof raw === 'string' ? raw : raw.toString();

  if (text.startsWith('4') || text.startsWith('42')) {
    const jsonStart = text.indexOf('[');
    if (jsonStart === -1) return null;
    try {
      const parsed = JSON.parse(text.slice(jsonStart));
      return findQuestionPayload(parsed);
    } catch {
      return null;
    }
  }

  if (text.includes('GAME_QUESTIONS') || text.includes('questionId')) {
    try {
      const jsonStart = text.indexOf('{');
      if (jsonStart >= 0) return JSON.parse(text.slice(jsonStart));
    } catch {
      return null;
    }
  }

  return null;
}

function findQuestionPayload(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findQuestionPayload(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    if (node._id && Array.isArray(node.answers) && node.answers.length) return node;
    if (node.questionId && Array.isArray(node.answers)) return node;
    for (const value of Object.values(node)) {
      const found = findQuestionPayload(value);
      if (found) return found;
    }
  }
  return null;
}

export async function spawnGimkitBots({ pin, names, joinDelayMs = 250 }) {
  const roomInfo = await getRoomInfo(pin);
  const clientType = await getClientType();
  const tasks = names.map((name, index) => sleep(index * joinDelayMs).then(() => spawnSingleGimkitBot({
    pin,
    name,
    roomInfo,
    clientType,
  })));
  return Promise.all(tasks);
}

function spawnSingleGimkitBot({ pin, name, roomInfo, clientType }) {
  return new Promise(async (resolve) => {
    const stats = {
      name,
      platform: 'gimkit',
      joined: false,
      answers: 0,
      status: 'pending',
      error: null,
      endReason: null,
    };

    let ws = null;
    let heartbeat = null;
    const answeredQuestions = new Set();

    const { finish: endSession, clearJoinTimeout } = createSessionGuards({
      onFinish: (status, error = null) => {
        stats.status = status;
        stats.error = error;
        stats.endReason = error || status;
        if (heartbeat) clearInterval(heartbeat);
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        resolve(stats);
      },
    });

    try {
      const joinRes = await fetchJson(GIMKIT.join, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://www.gimkit.com',
          Referer: 'https://www.gimkit.com/join',
        },
        body: JSON.stringify({
          clientType,
          name,
          roomId: roomInfo.roomId,
        }),
      });

      if (!joinRes.ok) {
        throw new Error(joinRes.body?.message || joinRes.body?.error || 'Failed to join Gimkit game');
      }

      const joinData = joinRes.body;
      const connection = await connectGimkitSocket(joinData, stats, clearJoinTimeout);
      ws = connection.ws;
      heartbeat = connection.heartbeat;

      ws.on('message', (raw) => {
        const text = raw.toString();
        if (text.includes('{"type":"FULL"')) {
          endSession('failed', 'Room is full');
          return;
        }

        if (!stats.joined && !text.includes('error')) {
          stats.joined = true;
          stats.status = 'joined';
          clearJoinTimeout();
        }

        if (isGameEndMessage(text)) {
          endSession('completed', 'Game ended');
          return;
        }

        const question = extractQuestionFromMessage(raw);
        if (!question) return;

        const questionId = question._id || question.questionId;
        const answers = question.answers || [];
        if (!questionId || !answers.length || answeredQuestions.has(questionId)) return;

        answeredQuestions.add(questionId);
        const pick = answers[randomChoice(answers.length)];
        const answerId = pick?._id || pick?.id || pick;
        if (!answerId || joinData.source !== 'original') return;

        try {
          ws.send(encodeBlueboatAnswer(joinData.roomId, questionId, answerId));
          stats.answers += 1;
        } catch {
          /* ignore send errors */
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

async function connectGimkitSocket(joinData, stats, clearJoinTimeout) {
  if (joinData.source === 'original') {
    const wsUrl = `wss${joinData.serverUrl.substr(5)}/blueboat/?id=&EIO=3&transport=websocket`;
    const ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Gimkit connection timeout')), 12000);
      ws.on('open', () => {
        clearTimeout(timer);
        ws.send(encodeBlueboatJoin(joinData.roomId, joinData.intentId));
        stats.joined = true;
        stats.status = 'joined';
        clearJoinTimeout();
        resolve();
      });
      ws.on('error', () => {
        clearTimeout(timer);
        reject(new Error('Gimkit WebSocket failed'));
      });
    });

    const heartbeatTimer = setInterval(() => {
      try {
        ws.send('2');
      } catch {
        /* ignore */
      }
    }, 25000);
    ws.on('close', () => clearInterval(heartbeatTimer));

    return { ws, heartbeat: heartbeatTimer };
  }

  const joinIdUrl = `${joinData.serverUrl}/matchmake/joinById/${joinData.roomId}`;
  const roomRes = await fetchJson(joinIdUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intentId: joinData.intentId }),
  });

  if (!roomRes.ok || !roomRes.body?.sessionId) {
    throw new Error('Failed to connect to Gimkit room');
  }

  const room = roomRes.body;
  const wsUrl = `wss${joinData.serverUrl.substr(5)}/${room.room.processId}/${room.room.roomId}?sessionId=${room.sessionId}`;
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Gimkit room connection timeout')), 12000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      if (data.toString().includes('{"type":"FULL"')) {
        reject(new Error('Room is full'));
        return;
      }
      stats.joined = true;
      stats.status = 'joined';
      clearJoinTimeout();
      resolve();
    });
    ws.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Gimkit room WebSocket failed'));
    });
  });

  return { ws, heartbeat: null };
}