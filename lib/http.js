const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 KoalaBotter/1.0',
  Accept: 'application/json, text/plain, */*',
};

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...DEFAULT_HEADERS, ...options.headers },
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { ok: response.ok, status: response.status, body, headers: response.headers };
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...DEFAULT_HEADERS, ...options.headers },
  });

  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text, headers: response.headers };
}

export function pickHeaders(headers, names) {
  const result = {};
  for (const name of names) {
    result[name] = headers.get(name) ?? null;
  }
  return result;
}