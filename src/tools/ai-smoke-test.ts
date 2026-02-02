import 'dotenv/config';

const rawBaseUrl =
  process.env.BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.API_URL ||
  `http://localhost:${process.env.PORT || '3000'}`;
const baseUrl = rawBaseUrl.startsWith('http') ? rawBaseUrl : `http://${rawBaseUrl}`;

async function request(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(`Failed to reach ${baseUrl}. Ensure the API is running and BASE_URL is set.`);
  }

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return data;
}

function maskToken(token: string) {
  if (token.length <= 12) return '***';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

async function ensureHealthy() {
  await request('/health', { method: 'GET', headers: {} });
}

async function registerClient() {
  const ts = Date.now();
  const email = `ai-smoke-${ts}@example.com`;
  const phone = `+1555555${String(ts).slice(-4)}`;

  const payload = {
    name: 'AI Smoke Client',
    industry: 'other',
    email,
    phone,
    agentPhones: ['+15555550124']
  };

  const data = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  return {
    token: data.token as string,
    clientId: data.clientId as string
  };
}

async function main() {
  console.log('🔎 Checking API health...');
  await ensureHealthy();

  console.log('🧪 Registering test client...');
  const { token, clientId } = await registerClient();
  console.log(`✅ Client registered: ${clientId}`);
  console.log(`🔐 Token: ${maskToken(token)}`);

  const authHeader = { Authorization: `Bearer ${token}` };

  console.log('➡️  GET /knowledge');
  const knowledge = await request(`/api/clients/${clientId}/knowledge`, {
    method: 'GET',
    headers: authHeader
  });
  console.log(knowledge);

  console.log('➡️  PUT /knowledge');
  const updated = await request(`/api/clients/${clientId}/knowledge`, {
    method: 'PUT',
    headers: authHeader,
    body: JSON.stringify({
      knowledgeBase: [
        {
          category: 'pricing',
          question: 'What is your price?',
          answer: 'Prices start from 100'
        }
      ]
    })
  });
  console.log(updated);

  console.log('➡️  POST /ai/chat');
  const chat = await request(`/api/clients/${clientId}/ai/chat`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      message: 'What is your price?',
      customerContext: { name: 'Fahad' },
      conversationHistory: []
    })
  });
  console.log(chat);

  console.log('➡️  POST /ai/score-lead');
  const score = await request(`/api/clients/${clientId}/ai/score-lead`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      leadData: { budget: '200k', askedAboutPrice: true, messageCount: 6 }
    })
  });
  console.log(score);

  console.log('➡️  POST /ai/feedback');
  const feedback = await request(`/api/clients/${clientId}/ai/feedback`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      aiResponse: 'Prices start from 100',
      rating: 5,
      comment: 'Great'
    })
  });
  console.log(feedback);

  console.log('✅ AI smoke test completed');
}

main().catch(error => {
  console.error('❌ AI smoke test failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
