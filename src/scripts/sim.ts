// ============================================================
// LOCAL CHAT SIMULATOR
//
// Type messages in your terminal; the bot replies in your terminal.
// No WhatsApp, no Meta, no phone numbers.
//
// Usage:
//   SIM_MODE=1 tsx src/scripts/sim.ts <clientId>
//
// Or via npm:
//   npm run sim -- <clientId>
// ============================================================

import 'dotenv/config';

// IMPORTANT: ensure SIM_MODE is set before we import the whatsapp
// module so its top-level SIM_ENABLED flag reads correctly.
if (!process.env.SIM_MODE) process.env.SIM_MODE = '1';

import readline from 'node:readline';
import { initDatabase, getClientById } from '../services/database.js';
import { handleIncomingMessage } from '../conversation.js';
import { drainSimMessages, type SimMessage } from '../services/whatsapp.js';

const FAKE_PHONE = process.env.SIM_PHONE || '9665XXXXXXXX_TEST';

function formatReply(msg: SimMessage, index: number): string {
  const lines: string[] = [];
  const prefix = index === 0 ? '🤖 ' : '   ';

  if (msg.imageUrl) {
    lines.push(`${prefix}[🖼️  image: ${msg.imageUrl}]`);
  }

  if (msg.body) {
    const bodyLines = msg.body.split('\n');
    for (let i = 0; i < bodyLines.length; i++) {
      lines.push((i === 0 && !msg.imageUrl ? prefix : '   ') + bodyLines[i]);
    }
  }

  if (msg.buttons && msg.buttons.length > 0) {
    lines.push('   ' + '─'.repeat(30));
    if (msg.type === 'list') {
      msg.buttons.forEach((b, i) => {
        lines.push(`   ${i + 1}. ${b.title}${b.description ? ` — ${b.description}` : ''}  (id: ${b.id})`);
      });
    } else {
      msg.buttons.forEach(b => {
        lines.push(`   [${b.title}]  (id: ${b.id})`);
      });
    }
  }

  return lines.join('\n');
}

async function main() {
  const clientId = process.argv[2];
  if (!clientId) {
    console.error('Usage: SIM_MODE=1 tsx src/scripts/sim.ts <clientId>');
    console.error('');
    console.error('Find client IDs with: npm run client list');
    process.exit(1);
  }

  await initDatabase();
  const client = await getClientById(clientId);
  if (!client) {
    console.error(`❌ Client not found: ${clientId}`);
    process.exit(1);
  }

  console.log('');
  console.log(`💬 Chat simulator — ${client.name}`);
  console.log(`   Client ID: ${client.id}`);
  console.log(`   Customer phone (fake): ${FAKE_PHONE}`);
  console.log(`   Industry: ${client.industry || '-'}`);
  console.log(`   Shopify: ${client.settings?.shopify_domain || client.settings?.shopify?.domain || '—'}`);
  console.log('');
  console.log('Commands: /quit to exit, /reset to clear conversation state, /btn <id> to tap a button');
  console.log('Tip: send any message to start. The bot handles language selection, consent, and flow.');
  console.log('─'.repeat(60));
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '👤 you > ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();

    if (!text) {
      rl.prompt();
      return;
    }

    if (text === '/quit' || text === '/exit') {
      rl.close();
      return;
    }

    if (text === '/reset') {
      const { getConversation, saveConversation } = await import('../services/database.js');
      const conv = await getConversation(client.id, FAKE_PHONE);
      if (conv) {
        conv.messages = [];
        conv.state = 'welcome';
        conv.step = 0;
        conv.data = { whatsappPhone: FAKE_PHONE };
        await saveConversation(conv);
      }
      console.log('↻  Conversation state reset.');
      console.log('');
      rl.prompt();
      return;
    }

    // Allow typing a button id with `/btn id` shorthand for readability
    let messageToSend = text;
    if (text.startsWith('/btn ')) {
      messageToSend = text.slice(5).trim();
    }

    try {
      await handleIncomingMessage(
        client.phone_number_id,
        FAKE_PHONE,
        messageToSend,
        client.access_token || 'SIM_TOKEN'
      );

      const replies = drainSimMessages();
      if (replies.length === 0) {
        console.log('🤖 (bot sent nothing — this is expected in certain states)');
      } else {
        replies.forEach((r, i) => {
          console.log(formatReply(r, i));
          if (i < replies.length - 1) console.log('');
        });
      }
      console.log('');
    } catch (err) {
      console.error('💥 Error:', err);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n👋 Bye.');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('❌ Simulator crashed:', err);
  process.exit(1);
});
