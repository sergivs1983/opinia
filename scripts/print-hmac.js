#!/usr/bin/env node
const crypto = require('crypto');

const secret = process.env.INTERNAL_HMAC_SECRET;
if (!secret) {
  console.error('ERROR: INTERNAL_HMAC_SECRET is required');
  process.exit(2);
}

const pathname = process.argv[2];
if (!pathname || pathname[0] !== '/') {
  console.error('Usage: node scripts/print-hmac.js <pathname> [rawBody]');
  process.exit(2);
}

const rawBody = process.argv.length > 3 ? process.argv.slice(3).join(' ') : '';
const timestamp = Date.now().toString();
const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
const canonical = `${timestamp}.POST.${pathname}.${bodyHash}`;
const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

process.stdout.write(`${timestamp}\n${signature}\n`);
