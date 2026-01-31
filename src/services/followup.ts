import { sendWhatsAppMessage } from './whatsapp.js';
import { config } from '../config.js';

// Follow-up messages
const FOLLOWUP_MESSAGES = {
  day1: `Hi! 👋

Just checking in - are you still interested in finding a property?

Our agent is ready to help you. Reply "yes" if you'd like us to call you.`,

  day3: `Hello again! 🏠

We noticed you were looking for a property. Do you have any questions I can help with?

Feel free to ask about:
- Property prices
- Neighborhoods  
- Financing options`,

  day7: `Hi! 🌟

We have new properties that might match your requirements. Would you like our agent to share some options with you?

Reply "yes" to get updates.`
};

interface FollowupLead {
  phone: string;
  name: string;
  leadCapturedAt: Date;
  followupsSent: number;
}

// Check which leads need follow-up
export async function getLeadsNeedingFollowup(sql: any): Promise<FollowupLead[]> {
  if (!sql) return [];

  try {
    const result = await sql`
      SELECT 
        phone,
        data->>'name' as name,
        created_at as lead_captured_at,
        COALESCE((data->>'followupsSent')::int, 0) as followups_sent
      FROM user_states
      WHERE lead_captured = true
      AND created_at > NOW() - INTERVAL '14 days'
      ORDER BY created_at ASC
    `;

    return result.map((row: any) => ({
      phone: row.phone,
      name: row.name || 'Customer',
      leadCapturedAt: new Date(row.lead_captured_at),
      followupsSent: row.followups_sent || 0
    }));
  } catch (error) {
    console.error('❌ Error getting followup leads:', error);
    return [];
  }
}

// Determine which message to send based on time elapsed
export function getFollowupMessage(lead: FollowupLead): { message: string; followupNumber: number } | null {
  const now = new Date();
  const hoursSinceLead = (now.getTime() - lead.leadCapturedAt.getTime()) / (1000 * 60 * 60);

  // Day 1 (24 hours)
  if (hoursSinceLead >= 24 && hoursSinceLead < 72 && lead.followupsSent === 0) {
    return { message: FOLLOWUP_MESSAGES.day1, followupNumber: 1 };
  }

  // Day 3 (72 hours)
  if (hoursSinceLead >= 72 && hoursSinceLead < 168 && lead.followupsSent === 1) {
    return { message: FOLLOWUP_MESSAGES.day3, followupNumber: 2 };
  }

  // Day 7 (168 hours)
  if (hoursSinceLead >= 168 && lead.followupsSent === 2) {
    return { message: FOLLOWUP_MESSAGES.day7, followupNumber: 3 };
  }

  return null;
}

// Send follow-up and update database
export async function sendFollowup(sql: any, lead: FollowupLead, message: string, followupNumber: number): Promise<boolean> {
  try {
    // Send message
    const sent = await sendWhatsAppMessage(lead.phone, message);
    
    if (sent) {
      // Update followups count in database
      await sql`
        UPDATE user_states 
        SET data = jsonb_set(
          COALESCE(data, '{}'::jsonb),
          '{followupsSent}',
          ${followupNumber}::text::jsonb
        )
        WHERE phone = ${lead.phone}
      `;

      console.log(`✅ Followup ${followupNumber} sent to ${lead.name} (${lead.phone})`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Error sending followup to ${lead.phone}:`, error);
    return false;
  }
}

// Main function to process all follow-ups
export async function processFollowups(sql: any): Promise<number> {
  const leads = await getLeadsNeedingFollowup(sql);
  let sent = 0;

  for (const lead of leads) {
    const followup = getFollowupMessage(lead);
    
    if (followup) {
      const success = await sendFollowup(sql, lead, followup.message, followup.followupNumber);
      if (success) sent++;
      
      // Small delay between messages to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  if (sent > 0) {
    console.log(`📤 Sent ${sent} follow-up messages`);
  }

  return sent;
}
