// ============================================================
// REVENUE REPORT CLI
// Run: npx tsx src/scripts/revenue.ts [clientId]
// Shows revenue, conversion funnel, and usage stats.
// ============================================================

import { initDatabase } from '../services/database.js';
import { getRevenueByClient, getConversionFunnel, getUsageSummary } from '../services/analytics.js';

async function main() {
  await initDatabase();

  const clientId = process.argv[2]; // optional

  console.log('\n📊 Revenue Report');
  console.log('═'.repeat(60));

  // Revenue
  const revenue = await getRevenueByClient(clientId);
  if (revenue.length === 0) {
    console.log('\nNo payment data yet. Revenue will show up after the first verified order.');
  } else {
    console.log('\n💰 Revenue by Client (last 3 months):\n');
    for (const r of revenue) {
      console.log(`  ${r.client_name} — ${r.period}`);
      console.log(`    Revenue: ${r.total_revenue.toFixed(3)} ${r.currency}`);
      console.log(`    Orders: ${r.order_count} | Customers: ${r.unique_customers}`);
      console.log('');
    }
  }

  // Conversion funnel (only if specific client)
  if (clientId) {
    console.log('📈 Conversion Funnel:\n');
    const funnel = await getConversionFunnel(clientId);
    for (const f of funnel) {
      console.log(`  ${f.period}`);
      console.log(`    Messages → Checkouts → Payments`);
      console.log(`    ${f.messages_in} → ${f.checkouts_created} → ${f.payments_verified} (${f.conversion_rate}%)`);
      console.log('');
    }
  }

  // Usage summary
  console.log('📋 Usage Summary:\n');
  const usage = await getUsageSummary(clientId);
  for (const u of usage) {
    console.log(`  ${u.client_name} — ${u.period}`);
    console.log(`    Messages: ${u.messages_in} | AI calls: ${u.ai_calls} | Escalations: ${u.escalations}`);
    console.log(`    Checkouts: ${u.checkouts} | Payments: ${u.payments}`);
    console.log('');
  }

  console.log('═'.repeat(60));
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
