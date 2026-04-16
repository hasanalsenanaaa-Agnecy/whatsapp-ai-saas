import { getPendingReminders, markReminderSent, getClientById } from '../services/database.js';
import { sendWhatsAppMessage } from '../services/whatsapp.js';
import { formatMessage, getDefaultMessages } from '../messages.js';

// ============================================================
// APPOINTMENT REMINDERS
// Called by Upstash QStash or direct HTTP request
// ============================================================

/**
 * Process pending appointment reminders
 * Should be called every 15 minutes via cron
 */
export async function processReminders(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}> {
  const result = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[]
  };

  try {
    const pendingReminders = await getPendingReminders();
    result.processed = pendingReminders.length;

    if (pendingReminders.length === 0) {
      console.log('📅 No pending reminders');
      return result;
    }

    console.log(`📅 Processing ${pendingReminders.length} reminders`);

    for (const appointment of pendingReminders) {
      try {
        // Get client info for access token
        const client = await getClientById(appointment.client_id);
        if (!client) {
          result.failed++;
          result.errors.push(`Client not found: ${appointment.client_id}`);
          continue;
        }

        // Get messages template
        const messages = getDefaultMessages(client.industry);

        // Format reminder message
        const reminderMsg = formatMessage(messages.appointmentReminder, {
          name: appointment.name || 'عزيزي العميل',
          appointmentTime: appointment.time_label || '',
          businessName: client.name
        });

        // Send reminder
        const sent = await sendWhatsAppMessage(
          appointment.phone,
          reminderMsg,
          client.access_token,
          client.phone_number_id
        );

        if (sent) {
          await markReminderSent(appointment.id);
          result.sent++;
          console.log(`✅ Reminder sent to ${appointment.phone}`);
        } else {
          result.failed++;
          result.errors.push(`Failed to send to ${appointment.phone}`);
        }

      } catch (error) {
        result.failed++;
        result.errors.push(`Error for ${appointment.phone}: ${error}`);
        console.error(`❌ Reminder error:`, error);
      }
    }

    return result;

  } catch (error) {
    console.error('❌ Process reminders error:', error);
    result.errors.push(`Process error: ${error}`);
    return result;
  }
}

/**
 * HTTP handler for cron endpoint
 * Add this route to your index.ts
 */
export async function handleReminderCron(request: any, reply: any): Promise<void> {
  // Verify bearer secret — set CRON_SECRET in env, configure QStash to send
  // Authorization: Bearer <CRON_SECRET> with every request.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers['authorization'] as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token !== cronSecret) {
      console.error('❌ Cron: invalid or missing CRON_SECRET');
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  }

  try {
    const result = await processReminders();
    
    reply.send({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ Cron error:', error);
    reply.status(500).send({
      success: false,
      error: String(error)
    });
  }
}
