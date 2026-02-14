#!/usr/bin/env tsx
import postgres from 'postgres';
import 'dotenv/config';

// ============================================================
// FEATURE MANAGEMENT CLI
// Manage client features from command line
// 
// Usage:
//   npm run features list
//   npm run features show <client-id>
//   npm run features enable <client-id> <feature>
//   npm run features disable <client-id> <feature>
//   npm run features set-tier <client-id> <basic|pro|business>
// ============================================================

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

const FEATURES = {
  ai_fallback: 'AI Fallback - Answer off-topic questions',
  lead_scoring: 'Lead Scoring - Auto hot/warm/cold',
  handover_detection: 'Handover Detection - Detect transfer requests',
  appointment_setting: 'Appointment Setting - Auto-book + reminders'
};

const TIERS = {
  basic: {
    ai_fallback: false,
    lead_scoring: false,
    handover_detection: false,
    appointment_setting: false
  },
  pro: {
    ai_fallback: true,
    lead_scoring: true,
    handover_detection: false,
    appointment_setting: false
  },
  business: {
    ai_fallback: true,
    lead_scoring: true,
    handover_detection: true,
    appointment_setting: true
  }
};

async function listClients() {
  const clients = await sql`
    SELECT id, name, industry, features, active 
    FROM clients 
    ORDER BY created_at DESC
  `;
  
  console.log('\n📋 All Clients:\n');
  console.log('─'.repeat(80));
  
  for (const client of clients) {
    const features = client.features || {};
    const enabledFeatures = Object.entries(features)
      .filter(([_, v]) => v)
      .map(([k]) => k)
      .join(', ') || 'none';
    
    console.log(`ID: ${client.id}`);
    console.log(`Name: ${client.name}`);
    console.log(`Industry: ${client.industry}`);
    console.log(`Active: ${client.active ? '✅' : '❌'}`);
    console.log(`Features: ${enabledFeatures}`);
    console.log('─'.repeat(80));
  }
}

async function showClient(clientId: string) {
  const [client] = await sql`
    SELECT * FROM clients WHERE id = ${clientId}
  `;
  
  if (!client) {
    console.error(`❌ Client not found: ${clientId}`);
    return;
  }
  
  console.log('\n📋 Client Details:\n');
  console.log(`ID: ${client.id}`);
  console.log(`Name: ${client.name}`);
  console.log(`Industry: ${client.industry}`);
  console.log(`Active: ${client.active ? '✅' : '❌'}`);
  console.log(`Phone Number ID: ${client.phone_number_id || 'not set'}`);
  console.log(`Agent Phones: ${(client.agent_phones || []).join(', ') || 'none'}`);
  
  console.log('\n🎯 Features:');
  const features = client.features || {};
  for (const [key, description] of Object.entries(FEATURES)) {
    const enabled = features[key] ? '✅' : '❌';
    console.log(`  ${enabled} ${key}: ${description}`);
  }
  
  console.log('\n⚙️ Settings:');
  console.log(JSON.stringify(client.settings || {}, null, 2));
  
  console.log('\n📚 Knowledge Base:');
  const kb = client.knowledge_base || [];
  if (kb.length === 0) {
    console.log('  (empty)');
  } else {
    for (const item of kb) {
      console.log(`  - ${item.category}: ${item.question}`);
    }
  }
}

async function enableFeature(clientId: string, feature: string) {
  if (!Object.keys(FEATURES).includes(feature)) {
    console.error(`❌ Invalid feature: ${feature}`);
    console.log(`Valid features: ${Object.keys(FEATURES).join(', ')}`);
    return;
  }
  
  const [client] = await sql`
    SELECT features FROM clients WHERE id = ${clientId}
  `;
  
  if (!client) {
    console.error(`❌ Client not found: ${clientId}`);
    return;
  }
  
  const features = { ...client.features, [feature]: true };
  
  await sql`
    UPDATE clients 
    SET features = ${JSON.stringify(features)}::jsonb
    WHERE id = ${clientId}
  `;
  
  console.log(`✅ Enabled ${feature} for ${clientId}`);
}

async function disableFeature(clientId: string, feature: string) {
  if (!Object.keys(FEATURES).includes(feature)) {
    console.error(`❌ Invalid feature: ${feature}`);
    console.log(`Valid features: ${Object.keys(FEATURES).join(', ')}`);
    return;
  }
  
  const [client] = await sql`
    SELECT features FROM clients WHERE id = ${clientId}
  `;
  
  if (!client) {
    console.error(`❌ Client not found: ${clientId}`);
    return;
  }
  
  const features = { ...client.features, [feature]: false };
  
  await sql`
    UPDATE clients 
    SET features = ${JSON.stringify(features)}::jsonb
    WHERE id = ${clientId}
  `;
  
  console.log(`✅ Disabled ${feature} for ${clientId}`);
}

async function setTier(clientId: string, tier: string) {
  if (!Object.keys(TIERS).includes(tier)) {
    console.error(`❌ Invalid tier: ${tier}`);
    console.log(`Valid tiers: ${Object.keys(TIERS).join(', ')}`);
    return;
  }
  
  const [client] = await sql`
    SELECT id FROM clients WHERE id = ${clientId}
  `;
  
  if (!client) {
    console.error(`❌ Client not found: ${clientId}`);
    return;
  }
  
  const features = TIERS[tier as keyof typeof TIERS];
  
  await sql`
    UPDATE clients 
    SET features = ${JSON.stringify(features)}::jsonb
    WHERE id = ${clientId}
  `;
  
  const enabledFeatures = Object.entries(features)
    .filter(([_, v]) => v)
    .map(([k]) => k)
    .join(', ') || 'none';
  
  console.log(`✅ Set ${clientId} to ${tier.toUpperCase()} tier`);
  console.log(`   Enabled features: ${enabledFeatures}`);
}

async function addKnowledge(clientId: string, category: string, question: string, answer: string) {
  const [client] = await sql`
    SELECT knowledge_base FROM clients WHERE id = ${clientId}
  `;
  
  if (!client) {
    console.error(`❌ Client not found: ${clientId}`);
    return;
  }
  
  const kb = [...(client.knowledge_base || []), { category, question, answer }];
  
  await sql`
    UPDATE clients 
    SET knowledge_base = ${JSON.stringify(kb)}::jsonb
    WHERE id = ${clientId}
  `;
  
  console.log(`✅ Added knowledge item to ${clientId}`);
}

async function main() {
  const [, , command, ...args] = process.argv;
  
  try {
    switch (command) {
      case 'list':
        await listClients();
        break;
        
      case 'show':
        if (!args[0]) {
          console.error('Usage: npm run features show <client-id>');
          break;
        }
        await showClient(args[0]);
        break;
        
      case 'enable':
        if (!args[0] || !args[1]) {
          console.error('Usage: npm run features enable <client-id> <feature>');
          console.log(`Features: ${Object.keys(FEATURES).join(', ')}`);
          break;
        }
        await enableFeature(args[0], args[1]);
        break;
        
      case 'disable':
        if (!args[0] || !args[1]) {
          console.error('Usage: npm run features disable <client-id> <feature>');
          console.log(`Features: ${Object.keys(FEATURES).join(', ')}`);
          break;
        }
        await disableFeature(args[0], args[1]);
        break;
        
      case 'set-tier':
        if (!args[0] || !args[1]) {
          console.error('Usage: npm run features set-tier <client-id> <basic|pro|business>');
          break;
        }
        await setTier(args[0], args[1]);
        break;
        
      case 'add-knowledge':
        if (!args[0] || !args[1] || !args[2] || !args[3]) {
          console.error('Usage: npm run features add-knowledge <client-id> <category> <question> <answer>');
          break;
        }
        await addKnowledge(args[0], args[1], args[2], args[3]);
        break;
        
      default:
        console.log(`
📋 Feature Management CLI

Commands:
  list                              List all clients and their features
  show <client-id>                  Show detailed client info
  enable <client-id> <feature>      Enable a feature
  disable <client-id> <feature>     Disable a feature
  set-tier <client-id> <tier>       Set all features for a tier
  add-knowledge <client-id> <cat> <q> <a>  Add knowledge base item

Features: ${Object.keys(FEATURES).join(', ')}
Tiers: basic, pro, business

Examples:
  npm run features list
  npm run features show anonymous
  npm run features enable anonymous ai_fallback
  npm run features set-tier anonymous pro
  npm run features add-knowledge anonymous pricing "كم الأسعار؟" "تبدأ من 300 ألف"
        `);
    }
  } finally {
    await sql.end();
  }
}

main().catch(console.error);
