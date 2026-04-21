// ============================================================
// CLIENT DATA EXPORT
//
// Produces a full export of a client's data for contract-
// termination handover (per contract Article 5).
//
// Output: ./exports/<clientId>-<date>/
//   ├── client.json          (config, minus secrets)
//   ├── conversations.json   (all conversations + messages)
//   ├── customers.csv        (unique customer phones + names)
//   ├── orders.csv           (all verified orders)
//   ├── events.csv           (full event log — source of analytics)
//   ├── leads.csv            (lead records)
//   └── summary.json         (aggregates — total orders, revenue, etc.)
//
// Usage:  tsx src/scripts/export-client.ts <clientId>
// ============================================================

import 'dotenv/config';
import { initDatabase, sql, getClientById } from '../services/database.js';
import fs from 'node:fs';
import path from 'node:path';

function toCsv(rows: any[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

async function main() {
  const clientId = process.argv[2];
  if (!clientId) {
    console.error('Usage: tsx src/scripts/export-client.ts <clientId>');
    process.exit(1);
  }

  await initDatabase();

  const client = await getClientById(clientId);
  if (!client) {
    console.error(`❌ Client not found: ${clientId}`);
    process.exit(1);
  }

  const date = new Date().toISOString().split('T')[0];
  const outDir = path.resolve(process.cwd(), 'exports', `${clientId}-${date}`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`📦 Exporting ${client.name} → ${outDir}`);

  // 1. Client config (strip secrets)
  const clientSafe = {
    id: client.id,
    name: client.name,
    industry: client.industry,
    phone_number_id: client.phone_number_id,
    agent_phones: client.agent_phones,
    features: client.features,
    settings: {
      ...client.settings,
      shopify_token: client.settings?.shopify_token ? '[REDACTED]' : undefined,
      shopify_admin_token: client.settings?.shopify_admin_token ? '[REDACTED]' : undefined,
    },
    questions: client.questions,
    knowledge_base: client.knowledge_base,
  };
  fs.writeFileSync(path.join(outDir, 'client.json'), JSON.stringify(clientSafe, null, 2));

  // 2. Conversations (all messages)
  const conversations = await sql`
    SELECT client_id, phone, messages, state, data, consent_given, consent_at, created_at, updated_at
    FROM conversations
    WHERE client_id = ${clientId}
    ORDER BY created_at DESC
  `;
  fs.writeFileSync(path.join(outDir, 'conversations.json'), JSON.stringify(conversations, null, 2));
  console.log(`  • ${conversations.length} conversations`);

  // 3. Customers — unique phones with first-seen name
  const customers = await sql`
    SELECT DISTINCT ON (phone)
      phone,
      COALESCE(data->>'name', '') AS name,
      created_at AS first_seen,
      updated_at AS last_seen
    FROM conversations
    WHERE client_id = ${clientId}
    ORDER BY phone, created_at ASC
  `;
  fs.writeFileSync(path.join(outDir, 'customers.csv'), toCsv(customers));
  console.log(`  • ${customers.length} customers`);

  // 4. Orders — from payment_verified events
  const orders = await sql`
    SELECT
      phone,
      data->>'orderNumber' AS order_number,
      data->>'total' AS total,
      data->>'currency' AS currency,
      created_at
    FROM events
    WHERE client_id = ${clientId}
      AND event_type = 'payment_verified'
    ORDER BY created_at DESC
  `;
  fs.writeFileSync(path.join(outDir, 'orders.csv'), toCsv(orders));
  console.log(`  • ${orders.length} orders`);

  // 5. Full event log
  const events = await sql`
    SELECT event_type, phone, data, created_at
    FROM events
    WHERE client_id = ${clientId}
    ORDER BY created_at DESC
  `;
  fs.writeFileSync(path.join(outDir, 'events.csv'), toCsv(events));
  console.log(`  • ${events.length} events`);

  // 6. Leads
  const leads = await sql`
    SELECT phone, name, email, data, score, created_at
    FROM leads
    WHERE client_id = ${clientId}
    ORDER BY created_at DESC
  `;
  fs.writeFileSync(path.join(outDir, 'leads.csv'), toCsv(leads));
  console.log(`  • ${leads.length} leads`);

  // 7. Summary aggregates
  const totalRevenue = orders.reduce((sum: number, o: any) => sum + (parseFloat(o.total) || 0), 0);
  const summary = {
    client_id: client.id,
    client_name: client.name,
    export_date: new Date().toISOString(),
    totals: {
      conversations: conversations.length,
      unique_customers: customers.length,
      orders: orders.length,
      total_revenue: totalRevenue.toFixed(2),
      events: events.length,
      leads: leads.length,
    },
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\n✅ Export complete: ${outDir}`);
  console.log(`   Revenue: ${totalRevenue.toFixed(2)}`);
  console.log(`\nZip for handover:`);
  console.log(`   cd exports && zip -r ${clientId}-${date}.zip ${clientId}-${date}/`);

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Export failed:', err);
  process.exit(1);
});
