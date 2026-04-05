import 'dotenv/config';
import postgres from 'postgres';
import axios from 'axios';
import * as readline from 'readline';

// Database connection
const sql = postgres(process.env.DATABASE_URL!);

// Readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function generateVerifyToken(): string {
  return 'verify_' + Math.random().toString(36).substring(2, 15);
}

function generateClientId(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 15);
  return 'client_' + clean + '_' + Date.now().toString(36);
}

// Validate phone format (Saudi)
function validatePhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '');
  return /^966[0-9]{9}$/.test(cleaned);
}

// Test WhatsApp token
async function testWhatsAppToken(phoneNumberId: string, accessToken: string): Promise<boolean> {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${phoneNumberId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.status === 200;
  } catch {
    return false;
  }
}

// ==================== COMMANDS ====================

async function addClient() {
  console.log('\n┌────────────────────────────────────┐');
  console.log('│         ADD NEW CLIENT             │');
  console.log('└────────────────────────────────────┘\n');

  // Basic info
  const name = await prompt('Business name (Arabic): ');
  if (!name) { console.log('❌ Business name required'); return; }
  
  const nameEn = await prompt('Business name (English, for ID): ');
  
  // Industry
  console.log('\nIndustries: real_estate, clinic, car_dealership, driving_school, home_services, generic, shopify');
  const industry = await prompt('Industry: ');
  if (!['real_estate', 'clinic', 'car_dealership', 'driving_school', 'home_services', 'generic', 'shopify'].includes(industry)) {
    console.log('❌ Invalid industry'); return;
  }

  // Meta credentials
  console.log('\n── Meta Credentials ──');
  const phoneNumberId = await prompt('Phone Number ID: ');
  if (!phoneNumberId) { console.log('❌ Phone Number ID required'); return; }
  
  const accessToken = await prompt('Access Token: ');
  if (!accessToken) { console.log('❌ Access Token required'); return; }

  // Validate token
  console.log('\n⏳ Validating WhatsApp credentials...');
  const tokenValid = await testWhatsAppToken(phoneNumberId, accessToken);
  if (!tokenValid) {
    console.log('❌ Invalid credentials. Check Phone Number ID and Access Token.');
    const proceed = await prompt('Continue anyway? (yes/no): ');
    if (proceed !== 'yes') return;
  } else {
    console.log('✅ WhatsApp credentials valid');
  }

  // Agent phone
  console.log('\n── Notifications ──');
  const agentPhones = await prompt('Agent phone (966XXXXXXXXX): ');
  if (!validatePhone(agentPhones)) {
    console.log('⚠️  Phone format should be 966XXXXXXXXX');
    const proceed = await prompt('Continue anyway? (yes/no): ');
    if (proceed !== 'yes') return;
  }

  // Custom questions or defaults
  console.log('\n── Questions ──');
  const useDefaults = await prompt('Use default questions for ' + industry + '? (yes/no): ');
  
  let questions;
  if (useDefaults === 'yes') {
    questions = getDefaultQuestions(industry);
  } else {
    questions = await collectCustomQuestions();
  }

  // Shopify credentials (if applicable)
  let shopifySettings: Record<string, unknown> = {};
  if (industry === 'shopify') {
    console.log('\n── Shopify Credentials ──');
    const shopifyDomain = await prompt('Shopify store domain (e.g. my-store.myshopify.com): ');
    if (!shopifyDomain) { console.log('❌ Shopify domain required'); return; }
    const storefrontToken = await prompt('Storefront Access Token: ');
    if (!storefrontToken) { console.log('❌ Storefront Access Token required'); return; }
    shopifySettings = {
      domain: shopifyDomain.trim(),
      storefrontToken: storefrontToken.trim(),
      currency: 'SAR',
      notifyOnOrder: true
    };
  }

  // Generate IDs
  const clientId = generateClientId(nameEn || name);
  const verifyToken = generateVerifyToken();

  // Settings (matches your DB schema)
  const settings: Record<string, unknown> = {
    welcome_message: `مرحباً بك في ${name}! 👋\n\nكيف نقدر نخدمك اليوم؟`,
    thank_you_message: 'شكراً لك! ✅\n\nتم استلام طلبك وسيتواصل معك أحد ممثلينا قريباً.',
    agent_name: 'الوكيل',
    ...(industry === 'shopify' && Object.keys(shopifySettings).length > 0 ? { shopify: shopifySettings } : {})
  };

  // Summary
  console.log('\n┌────────────────────────────────────┐');
  console.log('│            REVIEW                  │');
  console.log('└────────────────────────────────────┘');
  console.log(`ID:           ${clientId}`);
  console.log(`Business:     ${name}`);
  console.log(`Industry:     ${industry}`);
  console.log(`Phone ID:     ${phoneNumberId}`);
  console.log(`Agent:        ${agentPhones}`);
  console.log(`Verify Token: ${verifyToken}`);
  console.log(`\nQuestions:`);
  questions.forEach((q: any, i: number) => {
    console.log(`  ${i + 1}. ${q.text} → [${q.options.join(', ')}]`);
  });

  const confirm = await prompt('\n✅ Save client? (yes/no): ');
  if (confirm !== 'yes') { console.log('Cancelled.'); return; }

      // Insert
  try {
    await sql`
      INSERT INTO clients (
        id, name, industry, phone_number_id, access_token,
        verify_token, agent_phones, questions, settings, messages, active, created_at
      ) VALUES (
        ${clientId}, ${name}, ${industry}, ${phoneNumberId}, ${accessToken},
        ${verifyToken}, ${[agentPhones]}, ${JSON.stringify(questions)}, ${JSON.stringify(settings)},
        ${JSON.stringify({})}, true, NOW()
      )
    `;

    console.log('\n┌────────────────────────────────────┐');
    console.log('│       ✅ CLIENT ADDED              │');
    console.log('└────────────────────────────────────┘');
    console.log(`\nClient ID: ${clientId}`);
    console.log(`\n📋 Give client these webhook settings:`);
    console.log(`   URL:   https://whatsapp-ai-saas.onrender.com/webhook/whatsapp`);
    console.log(`   Token: ${verifyToken}`);
    console.log(`\n📱 Client configures in: Meta → WhatsApp → Configuration → Webhook`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
  }
}

async function collectCustomQuestions(): Promise<any[]> {
  const questions = [];
  console.log('\nEnter 3 questions (Arabic):');
  
  for (let i = 1; i <= 3; i++) {
    console.log(`\n── Question ${i} ──`);
    const text = await prompt('Question text: ');
    const optionsRaw = await prompt('Options (comma separated): ');
    const options = optionsRaw.split(',').map(o => o.trim()).filter(o => o);
    
    if (options.length < 2) {
      console.log('⚠️  Need at least 2 options');
      i--;
      continue;
    }
    
    questions.push({ id: `q${i}`, text, options });
  }
  
  return questions;
}

async function listClients() {
  console.log('\n┌────────────────────────────────────┐');
  console.log('│           ALL CLIENTS              │');
  console.log('└────────────────────────────────────┘\n');

  const clients = await sql`
    SELECT id, name, industry, active, created_at 
    FROM clients 
    ORDER BY created_at DESC
  `;

  if (clients.length === 0) {
    console.log('No clients found.');
    return;
  }

  clients.forEach((c: any) => {
    const status = c.active ? '🟢' : '🔴';
    const date = c.created_at ? new Date(c.created_at).toLocaleDateString() : 'N/A';
    console.log(`${status} ${c.id}`);
    console.log(`   ${c.name || 'Unnamed'} | ${c.industry || 'N/A'} | ${date}\n`);
  });
}

async function viewClient(clientId: string) {
  const clients = await sql`SELECT * FROM clients WHERE id = ${clientId}`;
  
  if (clients.length === 0) {
    console.log('❌ Client not found');
    return;
  }

  const c = clients[0];
  const settings = typeof c.settings === 'string' ? JSON.parse(c.settings) : c.settings;
  const questions = typeof c.questions === 'string' ? JSON.parse(c.questions) : c.questions;

  console.log('\n┌────────────────────────────────────┐');
  console.log('│          CLIENT DETAILS            │');
  console.log('└────────────────────────────────────┘');
  console.log(`ID:            ${c.id}`);
  console.log(`Business:      ${c.name}`);
  console.log(`Industry:      ${c.industry}`);
  console.log(`Active:        ${c.active ? '✅ Yes' : '❌ No'}`);
  console.log(`Phone ID:      ${c.phone_number_id}`);
  console.log(`Agent:         ${c.agent_phones}`);
  console.log(`Verify Token:  ${c.verify_token}`);
  console.log(`Token Preview: ${c.access_token?.substring(0, 20)}...`);
  
  if (questions && Array.isArray(questions)) {
    console.log(`\nQuestions:`);
    questions.forEach((q: any, i: number) => {
      console.log(`  ${i + 1}. ${q.text} → [${q.options?.join(', ') || 'N/A'}]`);
    });
  }
}

async function testClient(clientId: string) {
  const clients = await sql`SELECT * FROM clients WHERE id = ${clientId}`;
  
  if (clients.length === 0) {
    console.log('❌ Client not found');
    return;
  }

  const c = clients[0];
  console.log(`\n⏳ Testing ${c.name}...`);

  // Test WhatsApp credentials
  const tokenValid = await testWhatsAppToken(c.phone_number_id, c.access_token);
  console.log(`WhatsApp Token: ${tokenValid ? '✅ Valid' : '❌ Invalid or expired'}`);

  // Test database connection
  console.log(`Database:       ✅ Connected`);

  console.log(`\nWebhook URL:    https://whatsapp-ai-saas.onrender.com/webhook/whatsapp`);
  console.log(`Verify Token:   ${c.verify_token}`);
}

async function deactivateClient(clientId: string) {
  const confirm = await prompt(`Deactivate ${clientId}? (yes/no): `);
  if (confirm !== 'yes') return;

  await sql`UPDATE clients SET active = false WHERE id = ${clientId}`;
  console.log(`✅ ${clientId} deactivated`);
}

async function activateClient(clientId: string) {
  await sql`UPDATE clients SET active = true WHERE id = ${clientId}`;
  console.log(`✅ ${clientId} activated`);
}

async function editClient(clientId: string) {
  const clients = await sql`SELECT * FROM clients WHERE id = ${clientId}`;
  
  if (clients.length === 0) {
    console.log('❌ Client not found');
    return;
  }

  const c = clients[0];
  console.log(`\nEditing: ${c.name}`);
  console.log('Leave blank to keep current value.\n');

  const agentPhones = await prompt(`Agent phone [${c.agent_phones}]: `);
  const accessToken = await prompt(`Access Token [****]: `);

  if (agentPhones) {
    await sql`UPDATE clients SET agent_phones = ${[agentPhones]} WHERE id = ${clientId}`;
  }
  if (accessToken) {
    await sql`UPDATE clients SET access_token = ${accessToken} WHERE id = ${clientId}`;
  }

  if (agentPhones || accessToken) {
    console.log('✅ Client updated');
  } else {
    console.log('No changes.');
  }
}

function getDefaultQuestions(industry: string): any[] {
  const defaults: Record<string, any[]> = {
    real_estate: [
      { id: 'q1', text: 'كيف نقدر نساعدك؟', options: ['أبي أشتري', 'أبي أبيع', 'أبي أستأجر', 'استفسار عام'] },
      { id: 'q2', text: 'وش نوع العقار؟', options: ['شقة', 'فيلا', 'أرض', 'دوبلكس'] },
      { id: 'q3', text: 'وش الميزانية؟', options: ['أقل من 500 ألف', '500 ألف - مليون', 'مليون - 2 مليون', 'أكثر من 2 مليون'] },
      { id: 'q4', text: 'وين المنطقة؟', options: ['الدمام', 'الخبر', 'الظهران', 'القطيف', 'الجبيل', 'الأحساء', 'منطقة ثانية'] },
      { id: 'q5', text: 'وش الوقت المفضل؟', options: ['الحين', 'خلال شهر', 'أتصفح بس'] }
    ],
    clinic: [
      { id: 'q1', text: 'أي خدمة تحتاج؟', options: ['أسنان', 'جلدية', 'عيون', 'عظام', 'أطفال', 'طب عام', 'تجميل', 'خدمة ثانية'] },
      { id: 'q2', text: 'وش نوع الزيارة؟', options: ['كشف جديد', 'متابعة', 'نتائج تحاليل', 'استفسار عن الأسعار'] },
      { id: 'q3', text: 'هل عندك تأمين؟', options: ['عندي تأمين', 'بدون تأمين / نقدي', 'أبي أعرف التأمينات المقبولة'] },
      { id: 'q4', text: 'وش الوقت المفضل؟', options: ['صباحي (8-12)', 'بعد الظهر (12-4)', 'مسائي (4-9)', 'أقرب موعد متاح'] }
    ],
    car_dealership: [
      { id: 'q1', text: 'وش الخدمة المطلوبة؟', options: ['شراء', 'بيع', 'تقييم'] },
      { id: 'q2', text: 'جديدة ولا مستعملة؟', options: ['جديدة', 'مستعملة'] },
      { id: 'q3', text: 'وش الميزانية؟', options: ['أقل من 50 ألف', '50-100 ألف', 'أكثر من 100 ألف'] },
      { id: 'q4', text: 'أي نوع تفضل؟', options: ['سيدان', 'جيب', 'بيك أب', 'موتور'] }
    ],
    driving_school: [
      { id: 'q1', text: 'وش نوع الرخصة؟', options: ['رخصة جديدة', 'تجديد', 'دولية'] },
      { id: 'q2', text: 'خاص ولا عام؟', options: ['خاص', 'عام'] },
      { id: 'q3', text: 'وش الوقت المفضل؟', options: ['صباحي', 'مسائي', 'عطلة نهاية الأسبوع'] },
      { id: 'q4', text: 'أي فرع؟', options: ['الدمام', 'الخبر', 'الظهران', 'القطيف'] }
    ],
    home_services: [
      { id: 'q1', text: 'أي خدمة تحتاج؟', options: ['تنظيف', 'صيانة', 'تركيب'] },
      { id: 'q2', text: 'متى تحتاج الخدمة؟', options: ['الحين', 'خلال يومين', 'هذا الأسبوع'] },
      { id: 'q3', text: 'وين المنطقة؟', options: ['الدمام', 'الخبر', 'الظهران', 'القطيف'] },
      { id: 'q4', text: 'تفاصيل إضافية؟', options: ['أحتاج تفاصيل', 'أتصفح بس', 'أبي عرض سعر'] }
    ],
    generic: [
      { id: 'q1', text: 'كيف نقدر نساعدك؟', options: ['أبي أعرف عن الخدمات', 'أبي أعرف الأسعار', 'أبي أحجز موعد', 'أبي أتكلم مع شخص'] },
      { id: 'q2', text: 'كيف سمعت عنا؟', options: ['سناب شات / انستقرام', 'توصية من صديق', 'بحث قوقل', 'إعلان'] },
      { id: 'q3', text: 'وش الاستعجال؟', options: ['أحتاجها الحين', 'خلال هالأسبوع', 'أتصفح بس'] }
    ],
    shopify: [
      { id: 'q1', text: 'كيف نقدر نساعدك؟', options: ['تصفح المنتجات', 'البحث عن منتج', 'متابعة طلب', 'تكلم مع موظف'] }
    ]
  };
  return defaults[industry] || defaults.generic;
}

function showHelp() {
  console.log(`
┌────────────────────────────────────┐
│      CLIENT MANAGEMENT CLI         │
└────────────────────────────────────┘

Commands:
  add                 Add new client
  list                List all clients
  view <id>           View client details
  edit <id>           Edit client
  test <id>           Test client connection
  activate <id>       Activate client
  deactivate <id>     Deactivate client
  help                Show this help

Examples:
  npm run client add
  npm run client list
  npm run client view client_test_123
  npm run client test client_test_123
`);
}

// Main
async function main() {
  const [,, command, arg] = process.argv;

  try {
    switch (command) {
      case 'add':
        await addClient();
        break;
      case 'list':
        await listClients();
        break;
      case 'view':
        if (!arg) { console.log('Usage: npm run client view <id>'); break; }
        await viewClient(arg);
        break;
      case 'edit':
        if (!arg) { console.log('Usage: npm run client edit <id>'); break; }
        await editClient(arg);
        break;
      case 'test':
        if (!arg) { console.log('Usage: npm run client test <id>'); break; }
        await testClient(arg);
        break;
      case 'activate':
        if (!arg) { console.log('Usage: npm run client activate <id>'); break; }
        await activateClient(arg);
        break;
      case 'deactivate':
        if (!arg) { console.log('Usage: npm run client deactivate <id>'); break; }
        await deactivateClient(arg);
        break;
      default:
        showHelp();
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }

  rl.close();
  await sql.end();
}

main();
