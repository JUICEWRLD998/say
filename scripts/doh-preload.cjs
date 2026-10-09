// Resolve *.binance.com through Cloudflare DNS-over-HTTPS when the system resolver cannot (ISP DNS times out).
// Needs no admin rights. Use it for any Node program, for example the Agentic Wallet CLI:
//   NODE_OPTIONS="--require <abs path to this file>" baw auth signin
// Only hostnames ending in binance.com are touched. Everything else uses the normal resolver.
'use strict';
const dns = require('node:dns');
const https = require('node:https');

const original = dns.lookup;
const cache = new Map(); // host -> { ips, expires }

function doh(host) {
  const hit = cache.get(host);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.ips);
  return new Promise((resolve, reject) => {
    // 1.1.1.1 is an IP literal, so this request needs no DNS.
    const req = https.get(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`,
      { headers: { accept: 'application/dns-json' }, timeout: 10000 },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            const answers = (JSON.parse(body).Answer || []).filter((a) => a.type === 1);
            const ips = answers.map((a) => a.data);
            if (!ips.length) return reject(new Error(`DoH: no A record for ${host}`));
            const ttl = Math.max(30, Math.min(...answers.map((a) => a.TTL))) * 1000;
            cache.set(host, { ips, expires: Date.now() + ttl });
            resolve(ips);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('DoH timeout')));
    req.on('error', reject);
  });
}

dns.lookup = function lookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof options === 'number') options = { family: options };
  options = options || {};
  if (typeof hostname !== 'string' || !/(^|\.)binance\.com$/i.test(hostname)) {
    return original.call(dns, hostname, options, callback);
  }
  doh(hostname).then(
    (ips) => {
      if (options.all) callback(null, ips.map((address) => ({ address, family: 4 })));
      else callback(null, ips[Math.floor(Math.random() * ips.length)], 4);
    },
    // If DoH fails, fall back to the system resolver so the original error surfaces.
    () => original.call(dns, hostname, options, callback),
  );
};
