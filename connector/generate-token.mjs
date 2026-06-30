#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';

const connectorName = process.argv.slice(2).join(' ').trim();
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');

if (connectorName) {
  console.log(`Connector Name: ${connectorName}`);
  console.log('');
}

console.log('Connector Token (copy this now, shown once)');
console.log(token);
console.log('');
console.log('Token Hash (store this in Supabase store_pos_connectors.token_hash)');
console.log(tokenHash);
console.log('');
console.log(
  "Do not commit this token to git. Do not store the raw token anywhere except directly in the connector's local .env file on the store laptop."
);
