const userMessageCount = new Map<string, { count: number; resetAt: number }>();
const MAX_MESSAGES_PER_MINUTE = 10;

export function checkRateLimit(phone: string): boolean {
  const now = Date.now();
  const userData = userMessageCount.get(phone);
  
  if (!userData || now > userData.resetAt) {
    userMessageCount.set(phone, { count: 1, resetAt: now + 60000 });
    return true;
  }
  
  if (userData.count >= MAX_MESSAGES_PER_MINUTE) {
    return false;
  }
  
  userData.count++;
  return true;
}

export function isConversationExpired(updatedAt: number, hoursLimit: number = 24): boolean {
  return Date.now() - updatedAt > hoursLimit * 60 * 60 * 1000;
}
