#!/usr/bin/env tsx
// ============================================================
// Quick script to update a client's name and enable AI mode
// Usage: DATABASE_URL="your_url" npx tsx src/scripts/enable-ai.ts
// ============================================================

import postgres from 'postgres';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ Set DATABASE_URL first');
    process.exit(1);
  }

  const sql = postgres(dbUrl, { ssl: 'require' });

  // 1. List all clients
  const clients = await sql`SELECT id, name, industry, phone_number_id, features FROM clients WHERE active = true`;
  
  if (clients.length === 0) {
    console.log('❌ No active clients found');
    await sql.end();
    return;
  }

  console.log('\n📋 Active clients:');
  clients.forEach((c, i) => {
    const features = typeof c.features === 'string' ? JSON.parse(c.features) : c.features || {};
    console.log(`  ${i + 1}. [${c.id}] ${c.name} (${c.industry}) — AI: ${features.ai_conversation ? '✅' : '❌'}`);
  });

  // Use readline for interactive input
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  const clientNum = await ask('\n🔢 Which client # to update? ');
  const idx = parseInt(clientNum) - 1;
  if (idx < 0 || idx >= clients.length) {
    console.log('❌ Invalid selection');
    rl.close();
    await sql.end();
    return;
  }

  const client = clients[idx];
  console.log(`\n✏️  Selected: ${client.name}`);

  // Ask for new name
  const newName = await ask(`📝 New name (enter to keep "${client.name}"): `);
  
  // Ask to enable AI
  const enableAI = await ask('🤖 Enable AI conversation? (y/n): ');

  rl.close();

  // Apply updates
  const updates: string[] = [];

  if (newName.trim()) {
    await sql`UPDATE clients SET name = ${newName.trim()} WHERE id = ${client.id}`;
    updates.push(`Name: "${client.name}" → "${newName.trim()}"`);
  }

  if (enableAI.toLowerCase() === 'y') {
    // Merge ai_conversation into existing features
    const currentFeatures = typeof client.features === 'string' 
      ? JSON.parse(client.features) 
      : client.features || {};
    
    const newFeatures = {
      ...currentFeatures,
      ai_conversation: true,
      ai_fallback: true,         // also enable AI fallback for post-completion chat
      handover_detection: true,   // enable handover detection
      lead_scoring: true          // enable lead scoring
    };

    await sql`UPDATE clients SET features = ${JSON.stringify(newFeatures)}::jsonb WHERE id = ${client.id}`;
    updates.push('AI conversation: ✅ enabled');
    updates.push('AI fallback: ✅ enabled');
    updates.push('Handover detection: ✅ enabled');
    updates.push('Lead scoring: ✅ enabled');
  }

  // Also reset any existing conversations so they start fresh with AI mode
  const resetConvos = await sql`DELETE FROM conversations WHERE client_id = ${client.id}`;
  updates.push(`Conversations reset: ${resetConvos.count} cleared`);

  console.log('\n✅ Done! Updates:');
  updates.forEach(u => console.log(`  • ${u}`));

  await sql.end();
}

main().catch(console.error);
