import { fetchJson } from '../http.js';
import { sleep, randomChoice, createSessionGuards } from './shared.js';

const FIREBASE_API_KEY = 'AIzaSyDDcFFaTA9eCguTDPkuKKk3470_-ok0XqQ';
const GRAPHQL_URL = 'https://graphql-api.lessonup.com/graphql';
const AUTH_REFRESH_URL = 'https://graphql-api.lessonup.com/auth/firebase/refresh-token';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/lessonup-firestore/databases/(default)/documents';
const POLL_MS = 1500;

const MUTATIONS = {
  join: `mutation JoinRealtimeAssignmentWithPincode($input: JoinRealtimeAssignmentWithPincodeInput!) {
    joinRealtimeAssignmentWithPincode(input: $input) {
      ... on JoinRealtimeClassicAssignmentResult { assignmentId isSoundEnabled __typename }
      ... on JoinRealtimeAssignmentResult {
        assignment { id playerSettings { isSoundEnabled } }
        __typename
      }
    }
  }`,
  setDisplayName: `mutation UpdateDisplayName($input: SetDisplayNameForRealtimeAssignmentInput!) {
    setDisplayNameForRealtimeAssignment(input: $input) { displayName }
  }`,
  studentPins: `query GetAssignmentStudentPins($assignmentId: ID!) {
    viewer {
      id
      assignment(id: $assignmentId) { id studentPins }
    }
  }`,
  quiz: `mutation SubmitQuizPinAnswer($input: AnswerQuizForRealtimeAssignmentInput!) {
    answerQuizForRealtimeAssignment(input: $input) { assignment { id } }
  }`,
  poll: `mutation SubmitPollPinAnswer($input: AnswerPollForRealtimeAssignmentInput!) {
    answerPollForRealtimeAssignment(input: $input) { assignment { id } }
  }`,
  openQuestion: `mutation SubmitOpenQuestionPinAnswer($input: AnswerOpenQuestionForRealtimeAssignmentInput!) {
    answerOpenQuestionForRealtimeAssignment(input: $input) { assignment { id } }
  }`,
};

function normalizePincode(pin) {
  return pin.replace(/[\s-]/g, '');
}

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(decodeFirestoreValue);
  }
  if ('mapValue' in value) {
    return decodeFirestoreFields(value.mapValue.fields || {});
  }
  return null;
}

function decodeFirestoreFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) {
    result[key] = decodeFirestoreValue(value);
  }
  return result;
}

async function createAuthSession() {
  const signup = await fetchJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );

  if (!signup.ok || !signup.body?.idToken) {
    throw new Error(signup.body?.error?.message || 'Failed to create LessonUp session');
  }

  const refresh = await fetchJson(AUTH_REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: signup.body.idToken }),
  });

  if (!refresh.ok || !refresh.body?.accessToken) {
    throw new Error(refresh.body?.message || 'Failed to refresh LessonUp access token');
  }

  const userId = decodeJwtPayload(refresh.body.accessToken).sub;
  return {
    accessToken: refresh.body.accessToken,
    idToken: signup.body.idToken,
    userId,
  };
}

async function lessonupGraphql(accessToken, query, variables) {
  const res = await fetchJson(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Origin: 'https://lessonup.app',
      Referer: 'https://lessonup.app/join',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(typeof res.body === 'string' ? res.body : 'LessonUp GraphQL request failed');
  }

  if (res.body?.errors?.length) {
    const code = res.body.errors[0]?.extensions?.code;
    const message = res.body.errors[0]?.message || 'LessonUp GraphQL error';
    const err = new Error(message);
    err.code = code;
    throw err;
  }

  return res.body?.data;
}

async function getFirestoreDoc(idToken, collection, docId) {
  const res = await fetchJson(`${FIRESTORE_BASE}/${collection}/${docId}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to read LessonUp ${collection}/${docId}`);
  }

  return decodeFirestoreFields(res.body?.fields);
}

function entryDocId(assignmentId, userId) {
  return `${assignmentId}-${userId}`;
}

function resolveAssignmentId(joinResult) {
  if (!joinResult) return null;
  if (joinResult.__typename === 'JoinRealtimeAssignmentResult') {
    return joinResult.assignment?.id || null;
  }
  return joinResult.assignmentId || null;
}

function getLivePinState(settings, entry) {
  const view = settings?.currentView;
  if (!view) return null;

  const pinId = view.foregroundPinId || view.pinId;
  if (!pinId) return null;

  const step = view.params?.[`${pinId}-screen`] || view.screen || null;
  const pinEntry = entry?.entries?.[pinId] || null;

  return { pinId, step, pinEntry };
}

function isGameEnded(settings, entry) {
  if (settings?.status === 'closed') return true;
  if (['kicked', 'left'].includes(entry?.status)) return true;
  if (settings?.type === 'realtime' && settings?.playerSettings?.allowNewPlayers === false && entry?.status === 'disconnected') {
    return true;
  }
  return false;
}

function shouldAnswer(step, pinEntry) {
  if (!step || !['input', 'question'].includes(step)) return false;
  if (pinEntry?.done) return false;
  if (pinEntry?.answer) return false;
  return true;
}

function pickAnswerId(answers = []) {
  if (!answers.length) return null;
  const pick = answers[randomChoice(answers.length)];
  return pick?._id || pick?.id || pick;
}

async function fetchStudentPins(accessToken, assignmentId) {
  const data = await lessonupGraphql(accessToken, MUTATIONS.studentPins, { assignmentId });
  const pins = data?.viewer?.assignment?.studentPins;
  return Array.isArray(pins) ? pins : [];
}

async function tryAnswer(accessToken, assignmentId, pin, answeredPins) {
  if (!pin || answeredPins.has(pin.id)) return false;

  const type = pin.type || pin.item?.type;
  const answers = pin.settings?.answers || pin.item?.settings?.answers || [];

  try {
    if (type === 'quiz' || type === 'QUIZ') {
      const answerId = pickAnswerId(answers);
      if (!answerId) return false;
      await lessonupGraphql(accessToken, MUTATIONS.quiz, {
        input: { pinId: pin.id, assignmentId, answerIds: [answerId] },
      });
      answeredPins.add(pin.id);
      return true;
    }

    if (type === 'poll' || type === 'POLL') {
      const answerId = pickAnswerId(answers);
      if (!answerId) return false;
      await lessonupGraphql(accessToken, MUTATIONS.poll, {
        input: { pinId: pin.id, assignmentId, answerId },
      });
      answeredPins.add(pin.id);
      return true;
    }

    if (type === 'openQuestion' || type === 'OPEN_QUESTION') {
      await lessonupGraphql(accessToken, MUTATIONS.openQuestion, {
        input: { pinId: pin.id, assignmentId, answer: `Bot ${randomChoice(999) + 1}` },
      });
      answeredPins.add(pin.id);
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export async function spawnLessonUpBots({ pin, names, joinDelayMs = 200 }) {
  const code = normalizePincode(pin);
  if (!/^\d{6}$/.test(code)) {
    throw new Error('LessonUp PIN must be 6 digits');
  }

  const tasks = names.map((name, index) => sleep(index * joinDelayMs).then(() => spawnSingleLessonUpBot(code, name)));
  return Promise.all(tasks);
}

function spawnSingleLessonUpBot(pincode, name) {
  return new Promise(async (resolve) => {
    const stats = {
      name,
      platform: 'lessonup',
      joined: false,
      answers: 0,
      status: 'pending',
      error: null,
      endReason: null,
    };

    let session = null;
    let assignmentId = null;
    const answeredPins = new Set();
    let pinsCache = [];
    let pinsFetchedAt = 0;

    const { finish: endSession, clearJoinTimeout } = createSessionGuards({
      onFinish: (status, error = null) => {
        stats.status = status;
        stats.error = error;
        stats.endReason = error || status;
        resolve(stats);
      },
    });

    try {
      session = await createAuthSession();

      const joinData = await lessonupGraphql(session.accessToken, MUTATIONS.join, {
        input: { pincode },
      });

      assignmentId = resolveAssignmentId(joinData?.joinRealtimeAssignmentWithPincode);
      if (!assignmentId) {
        throw new Error('Failed to join LessonUp game');
      }

      await lessonupGraphql(session.accessToken, MUTATIONS.setDisplayName, {
        input: { preferredDisplayName: name, assignmentId },
      });

      stats.joined = true;
      stats.status = 'joined';
      clearJoinTimeout();

      while (true) {
        const [settings, entry] = await Promise.all([
          getFirestoreDoc(session.idToken, 'assignmentSettings', assignmentId),
          getFirestoreDoc(session.idToken, 'entries', entryDocId(assignmentId, session.userId)),
        ]);

        if (!settings) {
          throw new Error('Lesson not found or no longer active');
        }

        if (isGameEnded(settings, entry)) {
          endSession('completed', 'Lesson ended');
          return;
        }

        if (Date.now() - pinsFetchedAt > 10000 || !pinsCache.length) {
          pinsCache = await fetchStudentPins(session.accessToken, assignmentId);
          pinsFetchedAt = Date.now();
        }

        const live = getLivePinState(settings, entry);
        if (live && shouldAnswer(live.step, live.pinEntry)) {
          const pin = pinsCache.find((p) => p.id === live.pinId || p._id === live.pinId);
          if (pin && await tryAnswer(session.accessToken, assignmentId, pin, answeredPins)) {
            stats.answers += 1;
          }
        }

        await sleep(POLL_MS);
      }
    } catch (err) {
      const message = err?.message || String(err);
      if (err?.code === 'NOT_FOUND' || /not found/i.test(message)) {
        endSession('failed', 'Game not found or PIN is invalid');
        return;
      }
      if (err?.code === 'ASSIGNMENT_JOIN_DISABLED' || /closed/i.test(message)) {
        endSession('failed', 'Lesson is closed for new participants');
        return;
      }
      endSession(stats.joined ? 'disconnected' : 'failed', message);
    }
  });
}