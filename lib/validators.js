export const USERNAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;
export const DOMAIN_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;
export const IPV6_RE = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
export const URL_RE = /^https?:\/\/.+/i;
export const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
export const BTC_RE = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/;
export const ETH_RE = /^0x[a-fA-F0-9]{40}$/;

export function requireField(value, name) {
  const trimmed = value?.toString().trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

export function cleanDomain(input) {
  let domain = requireField(input, 'domain');
  domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!DOMAIN_RE.test(domain)) throw new Error('Invalid domain format');
  return domain.toLowerCase();
}

export function cleanUsername(input) {
  const username = requireField(input, 'username').replace(/^@/, '');
  if (!USERNAME_RE.test(username)) throw new Error('Invalid username format');
  return username;
}

export function cleanEmail(input) {
  const email = requireField(input, 'email').toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('Invalid email format');
  return email;
}

export function cleanUrl(input) {
  const url = requireField(input, 'url');
  if (!URL_RE.test(url)) throw new Error('Invalid URL format');
  return url;
}

export function cleanIp(input) {
  const ip = requireField(input, 'ip');
  if (!IPV4_RE.test(ip) && !IPV6_RE.test(ip)) throw new Error('Invalid IP address');
  return ip;
}