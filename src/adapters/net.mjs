// Reading the schemas of other nodes for the adapters, which runs in a build
// with network access: only https, and only to a public address. The address
// is checked where the connection is made (the lookup of https.request), so a
// host name cannot resolve to one address when checked and another when used,
// and every redirect is a new request checked the same way (getter in index.mjs).
import { request } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';

const MAX_BYTES = 5 * 1024 * 1024;

/** The four numbers of an IPv4 address, or null. */
const v4 = (ip) => { const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip); return m ? m.slice(1).map(Number) : null; };

/** The eight 16-bit groups of an IPv6 address, whatever its notation (::, an IPv4 tail), or null. */
function hextets(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    s = `${s.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const left = head ? head.split(':') : [];
  const right = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const fill = s.includes('::') ? 8 - left.length - right.length : 0;
  const all = [...left, ...Array(Math.max(fill, 0)).fill('0'), ...right];
  if (all.length !== 8 || !all.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return null;
  return all.map((x) => parseInt(x, 16));
}

/** Whether an IP address is on the public internet: not loopback, private, link-local, shared, reserved or multicast. */
export function isPublicAddress(ip) {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = v4(ip);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (family === 6) {
    const h = hextets(ip);
    if (!h) return false;
    // An IPv4 address inside IPv6 (::ffff:a.b.c.d or ::ffff:7f00:1, and the old ::a.b.c.d): classify the IPv4 address.
    if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
      if (h[5] === 0 && h[6] === 0 && h[7] <= 1) return false; // :: and ::1
      return isPublicAddress(`${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`);
    }
    return !((h[0] & 0xfe00) === 0xfc00 // fc00::/7 unique local
      || (h[0] & 0xffc0) === 0xfe80 // fe80::/10 link-local
      || (h[0] & 0xffc0) === 0xfec0 // fec0::/10 site-local (old)
      || (h[0] & 0xff00) === 0xff00 // multicast
      || (h[0] === 0x64 && h[1] === 0xff9b) // NAT64, which reaches IPv4 addresses
      || (h[0] === 0x2001 && h[1] === 0x0db8)); // documentation
  }
  return false;
}

/**
 * dns.lookup that refuses a host with any non-public address, used by
 * https.request for the connection itself. Node asks for one address or, to
 * try several (autoSelectFamily), for all of them; both forms are answered.
 * `resolve` is dns.lookup; tests pass one of their own.
 */
const publicLookup = (resolve) => (host, options, callback) => {
  resolve(host, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || !addresses.length) return callback(Object.assign(new Error(`${host} resolves to ${bad?.address ?? 'nothing'}, not a public address`), { code: 'ENOTPUBLIC' }));
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

/**
 * A fetch for what the adapters read: https only, connected to a public address,
 * redirects returned as they are (the caller decides), at most 5 MB.
 * Returns { ok, status, headers, json }. `lookup`: dns.lookup, or a stand-in for tests.
 */
export function publicFetch(url, { signal, lookup = dnsLookup } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') { reject(new Error(`${url}: only https is read`)); return; }
    // An address written in the URL is connected to without a lookup: check it here.
    const literal = u.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal) && !isPublicAddress(literal)) { reject(new Error(`${url}: ${literal} is not a public address`)); return; }
    const req = request(u, { lookup: publicLookup(lookup), signal, headers: { accept: 'application/json, application/ld+json;q=0.9, */*;q=0.1' } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(new Error(`${url}: larger than ${MAX_BYTES} bytes`)); return; } chunks.push(c); });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const headers = new Headers(Object.entries(res.headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : String(v)]])));
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers, json: async () => JSON.parse(body) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
