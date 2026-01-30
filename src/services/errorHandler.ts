// Centralized error handling

export function logError(context: string, error: any, meta?: Record<string, any>) {
  console.error(`❌ [${context}]`, {
    message: error?.message || error,
    stack: error?.stack?.split('\n')[1]?.trim(),
    ...meta,
    timestamp: new Date().toISOString()
  });
}

export async function safeExecute<T>(
  fn: () => Promise<T>,
  fallback: T,
  context: string,
  meta?: Record<string, any>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logError(context, error, meta);
    return fallback;
  }
}

export function sanitizeInput(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .substring(0, 4000) // WhatsApp limit
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // Remove control chars
}
