// ============================================================
// ONE-TIME MIGRATION: Encrypt existing plaintext Shopify tokens
// Run: npx tsx src/scripts/encrypt-tokens.ts
//
// Safe to run multiple times — already-encrypted values are
// detected and skipped via the "enc:" prefix.
// ============================================================

import postgres from 'postgres';
import 'dotenv/config';
import { encryptSettings, isEncrypted } from '../utils/crypto.js';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function main() {
  const clients = await sql`SELECT id, name, settings FROM clients WHERE active = true`;
  let updated = 0;

  for (const client of clients) {
    const settings = typeof client.settings === 'string'
      ? JSON.parse(client.settings)
      : client.settings || {};

    const encrypted = encryptSettings(settings);

    // Check if anything actually changed
    if (JSON.stringify(encrypted) === JSON.stringify(settings)) {
      console.log(`  ${client.name}: already encrypted or no secrets — skipped`);
      continue;
    }

    await sql`UPDATE clients SET settings = ${JSON.stringify(encrypted)}::jsonb WHERE id = ${client.id}`;
    console.log(`  ${client.name}: tokens encrypted`);
    updated++;
  }

  console.log(`\nDone. ${updated} client(s) updated.`);
  await sql.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
