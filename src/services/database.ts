import postgres from 'postgres';

let sql: ReturnType<typeof postgres>;

export async function initDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('❌ DATABASE_URL not set'); process.exit(1); }
  sql = postgres(dbUrl, { ssl: 'require' });
  console.log('✅ Database connected');
}

export async function getClientByPhoneNumberId(phoneNumberId: string) {
  try {
    const rows = await sql`SELECT * FROM clients WHERE phone_number_id = ${phoneNumberId} AND active = true LIMIT 1`;
    return rows[0] || null;
  } catch (error) { console.error('❌ DB error:', error); return null; }
}

export async function getConversation(clientId: string, phone: string) {
  try {
    const rows = await sql`SELECT * FROM conversations WHERE client_id = ${clientId} AND phone = ${phone} LIMIT 1`;
    if (!rows[0]) return null;
    return {
      clientId: rows[0].client_id, phone: rows[0].phone, messages: rows[0].messages || [],
      state: rows[0].state, step: rows[0].step || 0, data: rows[0].data || {},
      createdAt: rows[0].created_at, updatedAt: rows[0].updated_at
    };
  } catch (error) { console.error('❌ DB error:', error); return null; }
}

export async function saveConversation(conv: any) {
  try {
    await sql`
      INSERT INTO conversations (client_id, phone, messages, state, step, data, created_at, updated_at)
      VALUES (${conv.clientId}, ${conv.phone}, ${JSON.stringify(conv.messages)}, ${conv.state}, ${conv.step}, ${JSON.stringify(conv.data)}, ${conv.createdAt || new Date().toISOString()}, ${new Date().toISOString()})
      ON CONFLICT (client_id, phone) DO UPDATE SET messages = ${JSON.stringify(conv.messages)}, state = ${conv.state}, step = ${conv.step}, data = ${JSON.stringify(conv.data)}, updated_at = ${new Date().toISOString()}
    `;
    return true;
  } catch (error) { console.error('❌ DB error:', error); return false; }
}

export async function createLead(lead: { clientId: string; phone: string; name: string; email: string; data: Record<string, any>; score: string }) {
  try {
    const rows = await sql`
      INSERT INTO leads (client_id, phone, name, email, data, score, created_at)
      VALUES (${lead.clientId}, ${lead.phone}, ${lead.name}, ${lead.email || ''}, ${JSON.stringify(lead.data)}, ${lead.score || 'new'}, ${new Date().toISOString()})
      ON CONFLICT (client_id, phone) DO UPDATE SET name = ${lead.name}, data = ${JSON.stringify(lead.data)}, updated_at = ${new Date().toISOString()}
      RETURNING id
    `;
    return rows[0]?.id;
  } catch (error) { console.error('❌ DB error:', error); return null; }
}
