export const MAX_BOTS = 200;
export const JOIN_TIMEOUT_MS = 2 * 60 * 1000;
export const MAX_SESSION_MS = 2 * 60 * 60 * 1000;

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildPlayerNames(prefix, count) {
  const base = prefix?.trim() || 'Bot';
  return Array.from({ length: count }, (_, i) => `${base}${count > 1 ? ` ${i + 1}` : ''}`);
}

export function randomChoice(max = 4) {
  return Math.floor(Math.random() * Math.max(1, max));
}

export function createSessionGuards({ onFinish, joinTimeoutMs = JOIN_TIMEOUT_MS, maxSessionMs = MAX_SESSION_MS }) {
  let finished = false;
  const timers = [];

  const finish = (...args) => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    onFinish(...args);
  };

  timers.push(setTimeout(() => finish('join_timeout', 'Timed out waiting to join the game'), joinTimeoutMs));
  timers.push(setTimeout(() => finish('session_cap', 'Safety session limit reached'), maxSessionMs));

  const clearJoinTimeout = () => {
    clearTimeout(timers[0]);
  };

  return { finish, clearJoinTimeout, isFinished: () => finished };
}