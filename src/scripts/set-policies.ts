// ============================================================
// SET CLIENT POLICIES
//
// Load a text/markdown file into client.settings.policies so the
// Shopify agent's AI can answer shipping / returns / hours / location
// questions from facts instead of deflecting to the owner.
//
// Usage:
//   npm run set-policies -- <clientId> <path/to/policies.md>
//
// The file contents are stored verbatim (UTF-8). Markdown is fine —
// Claude reads it natively. Run the command again to overwrite.
// ============================================================

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

async function main() {
  const [, , clientId, filePath] = process.argv;

  if (!clientId || !filePath) {
    console.error('Usage: npm run set-policies -- <clientId> <path/to/policies.md>');
    process.exit(1);
  }

  const text = readFileSync(filePath, 'utf-8').trim();
  if (!text) {
    console.error('❌ Policies file is empty.');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

  // jsonb_set preserves every other settings key (including encrypted
  // tokens). The SQL driver converts the JS string to a JSON value via
  // ::jsonb, so we stringify once.
  const rows = await sql`
    UPDATE clients
       SET settings = jsonb_set(settings, '{policies}', ${JSON.stringify(text)}::jsonb, true)
     WHERE id = ${clientId}
     RETURNING id, name
  `;

  if (rows.length === 0) {
    console.error(`❌ Client not found: ${clientId}`);
    await sql.end();
    process.exit(1);
  }

  console.log(`✅ Policies updated for ${rows[0]!.name} (${rows[0]!.id})`);
  console.log(`   ${text.length} characters stored.`);
  await sql.end();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
