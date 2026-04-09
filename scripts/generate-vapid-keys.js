#!/usr/bin/env node
// Generate VAPID keys for Web Push notifications.
// Run once: node scripts/generate-vapid-keys.js
// Then add the output to your .env file.

const webpush = require('web-push');
const vapidKeys = webpush.generateVAPIDKeys();

console.log('\nVAPID Keys generated. Add these to your .env file:\n');
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log(`VAPID_EMAIL=mailto:admin@thepact.pro`);
console.log('\nAlso add VAPID_PUBLIC_KEY to your frontend (it\'s safe to expose publicly).\n');
