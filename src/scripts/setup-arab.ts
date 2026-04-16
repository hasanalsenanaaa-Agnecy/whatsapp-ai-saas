// Quick script to configure the test client for Shopify (ARAB store)
// Run: npx tsx src/scripts/setup-arab.ts

import postgres from 'postgres';
import 'dotenv/config';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function main() {
  // Update the existing test client for Shopify testing
  const result = await sql`
    UPDATE clients SET
      name = 'ARAB | عرب',
      industry = 'ecommerce',
      settings = ${JSON.stringify({
        shopify_domain: 'hsespd-dv.myshopify.com',
        currency: 'KWD',
        welcome_message: 'أهلاً وسهلاً في ARAB | عرب! 🛍️',
        thank_you_message: 'شكراً لتسوقك من ARAB | عرب! 🙏',
        assistant_labels: {
          best: 'هدية فاخرة',    // highest-priced = premium gift box
          cheap: 'استخدام يومي', // cheapest = daily use / personal
          type: 'كل المنتجات'   // browse all
        }
      })}::jsonb,
      features = ${JSON.stringify({
        ai_fallback: true,
        lead_scoring: true,
        handover_detection: true,
        appointment_setting: false,
        ai_conversation: false   // Shopify agent handles it, not the generic AI
      })}::jsonb,
      questions = '[]'::jsonb
    WHERE phone_number_id = '868668139674542'
    RETURNING id, name, industry, settings, features
  `;

  if (result.length === 0) {
    console.error('❌ No client found with that phone_number_id');
    process.exit(1);
  }

  console.log('✅ Client updated for Shopify testing:');
  console.log(JSON.stringify(result[0], null, 2));

  await sql.end();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
