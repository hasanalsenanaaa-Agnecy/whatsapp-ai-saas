import { Queue, Worker } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = REDIS_URL.startsWith('redis') 
  ? { url: REDIS_URL }
  : undefined;

export const messageQueue = connection 
  ? new Queue('whatsapp-messages', { connection })
  : null;

export function initQueueWorker(processMessage: (data: any) => Promise<void>) {
  if (!connection) {
    console.warn('⚠️ Redis not configured - queue disabled');
    return null;
  }

  const worker = new Worker('whatsapp-messages', async (job) => {
    await processMessage(job.data);
  }, { connection, concurrency: 5 });

  worker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
  });

  console.log('✅ Message queue initialized');
  return worker;
}

export async function addToQueue(phone: string, message: string, clientId: string) {
  if (!messageQueue) return false;
  
  await messageQueue.add('process-message', { phone, message, clientId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });
  return true;
}
