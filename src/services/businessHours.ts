const BUSINESS_HOURS = {
  start: 9,  // 9 AM
  end: 22,   // 10 PM
  timezone: 'Asia/Riyadh',
  daysOff: [5] // Friday (0=Sun, 5=Fri, 6=Sat)
};

export function isWithinBusinessHours(): boolean {
  const now = new Date().toLocaleString('en-US', { timeZone: BUSINESS_HOURS.timezone });
  const date = new Date(now);
  const hour = date.getHours();
  const day = date.getDay();
  
  if (BUSINESS_HOURS.daysOff.includes(day)) return false;
  return hour >= BUSINESS_HOURS.start && hour < BUSINESS_HOURS.end;
}

export function getOutOfHoursMessage(): string {
  return `شكراً لتواصلك! 🌙

نحن حالياً خارج ساعات العمل.
ساعات العمل: ٩ صباحاً - ١٠ مساءً (السبت - الخميس)

سنرد عليك في أقرب وقت ممكن!

---

Thank you for reaching out! 🌙

We're currently outside business hours.
Working hours: 9 AM - 10 PM (Sat - Thu)

We'll respond as soon as possible!`;
}
