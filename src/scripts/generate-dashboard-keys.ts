// ============================================================
// Generate dashboard_key for all clients that don't have one.
// Run: npx tsx src/scripts/generate-dashboard-keys.ts
//
// Safe to run multiple times — clients with existing keys are skipped.
// ============================================================

import postgres from 'postgres';
import crypto from 'crypto';
import 'dotenv/config';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function main() {
  const clients = await sql`SELECT id, name, dashboard_key FROM clients WHERE active = true`;
  let generated = 0;

  for (const client of clients) {
    if (client.dashboard_key) {
      console.log(`  ${client.name}: already has key — skipped`);
      continue;
    }

    const key = crypto.randomBytes(16).toString('hex'); // 32-char hex string
    await sql`UPDATE clients SET dashboard_key = ${key} WHERE id = ${client.id}`;
    console.log(`  ${client.name}: ${key}`);
    generated++;
  }

  console.log(`\nDone. Generated ${generated} key(s) for ${clients.length} client(s).`);
  console.log('\nGive each client their dashboard URL:');
  console.log('  https://YOUR_PORTAL_URL/dashboard?key=THEIR_KEY');

  await sql.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
