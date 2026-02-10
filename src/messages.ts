export interface Question {
  text: string;
  options: string[];
  field: string;
}

export interface ClientMessages {
  welcome: string;
  welcomeButtons?: { id: string; title: string }[];
  askName: string;
  questions: Question[];
  thankYou: string;
  invalidInput: string;
  agentNotification: string;
}

export const REAL_ESTATE_MESSAGES: ClientMessages = {
  welcome: `أهلاً وسهلاً! ��\n\nشكراً تواصلك مع {businessName}\n\nكيف أقدر أساعدك؟`,
  welcomeButtons: [
    { id: 'buy', title: 'أبي أشتري عقار' },
    { id: 'sell', title: 'أبي أبيع عقار' },
    { id: 'rent', title: 'أبي أستأجر' }
  ],
  askName: 'ممتاز! وش اسمك الكريم؟',
  questions: [
    { text: 'وش نوع العقار؟', options: ['شقة', 'فيلا', 'أرض', 'دوبلكس'], field: 'property_type' },
    { text: 'في أي مدينة؟', options: ['الدمام', 'الخبر', 'الظهران', 'القطيف'], field: 'city' },
    { text: 'كم ميزانيتك؟', options: ['أقل من 500 ألف', '500 ألف - مليون', 'مليون - 2 مليون', 'أكثر من 2 مليون'], field: 'budget' }
  ],
  thankYou: 'تمام يا {name}! ✅\n\nمعلوماتك وصلت. مستشارنا بيتواصل معك قريب إن شاء الله.',
  invalidInput: 'اختر من الخيارات المتاحة 👆',
  agentNotification: '🏠 *عميل جديد!*\n\n👤 {name}\n📱 {phone}\n\n📋 التفاصيل:\n{details}\n\n⏰ {time}'
};

export const CAR_DEALERSHIP_MESSAGES: ClientMessages = {
  welcome: `أهلاً وسهلاً! 👋\n\nشكراً تواصلك مع {businessName}\n\nكيف أقدر أساعدك؟`,
  welcomeButtons: [
    { id: 'buy', title: 'أبي أشتري سيارة' },
    { id: 'sell', title: 'أبي أبيع سيارتي' },
    { id: 'service', title: 'حجز صيانة' }
  ],
  askName: 'ممتاز! وش اسمك الكريم؟',
  questions: [
    { text: 'وش نوع السيارة؟', options: ['سيدان', 'جيب', 'بيك أب', 'رياضية'], field: 'car_type' },
    { text: 'كم ميزانيتك؟', options: ['أقل من 50 ألف', '50 - 100 ألف', '100 - 150 ألف', 'أكثر من 150 ألف'], field: 'budget' },
    { text: 'جديدة ولا مستعملة؟', options: ['جديدة', 'مستعملة'], field: 'condition' }
  ],
  thankYou: 'تمام يا {name}! ✅\n\nمعلوماتك وصلت. مستشارنا بيتواصل معك قريب إن شاء الله.',
  invalidInput: 'اختر من الخيارات المتاحة 👆',
  agentNotification: '🚗 *عميل جديد!*\n\n👤 {name}\n📱 {phone}\n\n📋 التفاصيل:\n{details}\n\n⏰ {time}'
};

export const GENERIC_MESSAGES: ClientMessages = {
  welcome: `أهلاً وسهلاً! 👋\n\nشكراً تواصلك مع {businessName}`,
  askName: 'وش اسمك الكريم؟',
  questions: [],
  thankYou: 'تمام يا {name}! ✅\n\nبنتواصل معك قريب.',
  invalidInput: 'اختر من الخيارات 👆',
  agentNotification: '🔔 *عميل جديد!*\n\n👤 {name}\n📱 {phone}\n\n📋 التفاصيل:\n{details}\n\n⏰ {time}'
};

export function getDefaultMessages(industry: string): ClientMessages {
  switch (industry) {
    case 'real_estate': return REAL_ESTATE_MESSAGES;
    case 'dealership':
    case 'car_dealership': return CAR_DEALERSHIP_MESSAGES;
    default: return GENERIC_MESSAGES;
  }
}

export function formatMessage(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  return result;
}
