// ============================================================
// GULF ARABIC + ENGLISH MESSAGES
// Short, concise, honest - Saudi dialect
// ============================================================

export interface ClientMessages {
  welcome: string;
  questions: {
    text: string;
    options: string[];
  }[];
  askContact: string;
  thankYou: string;
  invalidInput: string;
  handoverRequested: string;
  agentNotification: string;
  appointmentAsk: string;
  appointmentConfirm: string;
  aiGreeting: string;
  aiDontKnow: string;
  aiHandover: string;
}

// Default messages for Car Dealership (Gulf Arabic)
export const CAR_DEALERSHIP_MESSAGES: ClientMessages = {
  welcome: `أهلين وسهلين! 👋

شكراً تواصلك مع {businessName}

كيف أقدر أساعدك اليوم؟

1️⃣ أبي أشوف السيارات المتوفرة
2️⃣ أبي أبيع سيارتي
3️⃣ أبي أحجز موعد صيانة
4️⃣ استفسار عام`,

  questions: [
    {
      text: `تمام! وش نوع السيارة اللي تدور عليها؟

1️⃣ سيدان
2️⃣ جيب / SUV
3️⃣ بيك أب
4️⃣ رياضية
5️⃣ عائلية`,
      options: ['سيدان', 'جيب / SUV', 'بيك أب', 'رياضية', 'عائلية']
    },
    {
      text: `حلو! كم ميزانيتك تقريباً؟

1️⃣ أقل من 50 ألف
2️⃣ 50 - 100 ألف
3️⃣ 100 - 150 ألف
4️⃣ 150 - 200 ألف
5️⃣ أكثر من 200 ألف`,
      options: ['أقل من 50 ألف', '50 - 100 ألف', '100 - 150 ألف', '150 - 200 ألف', 'أكثر من 200 ألف']
    },
    {
      text: `جديدة ولا مستعملة؟

1️⃣ جديدة
2️⃣ مستعملة
3️⃣ الاثنين`,
      options: ['جديدة', 'مستعملة', 'الاثنين']
    }
  ],

  askContact: `ممتاز! 👍

عشان نخدمك أحسن، أرسل لي:

*اسمك، رقم جوالك*

مثال: محمد العلي، 0501234567`,

  thankYou: `تمام يا {name}! ✅

معلوماتك وصلت. مستشارنا بيتواصل معك خلال ساعة إن شاء الله.

تقدر تسألني أي سؤال عن السيارات وأنا هنا 🚗`,

  invalidInput: `عذراً، ما فهمت عليك 😅

رد برقم من الخيارات الموجودة`,

  handoverRequested: `تمام! 👍

طلبت التحدث مع مستشارنا.
بيتواصل معك خلال 5 دقائق إن شاء الله.`,

  agentNotification: `🔔 *عميل جديد!*

👤 {name}
�� {phone}
💬 واتساب: {whatsapp}

🚗 يدور على: {interest}
💰 الميزانية: {budget}
📋 التفاصيل: {details}

⏰ {time}

📌 *تواصل معه الحين!*`,

  appointmentAsk: `تبي تحجز موعد زيارة للمعرض؟

1️⃣ اليوم
2️⃣ بكرة
3️⃣ بعد بكرة
4️⃣ لا، شكراً`,

  appointmentConfirm: `تم حجز موعدك! ✅

📅 التاريخ: {date}
⏰ الوقت: {time}
📍 المكان: {location}

بنتواصل معك قبل الموعد للتأكيد.`,

  aiGreeting: `أهلاً! كيف أقدر أساعدك؟`,

  aiDontKnow: `صراحة ما عندي هالمعلومة الحين 😅

خليني أحول لك أحد المستشارين يفيدك أكثر.`,

  aiHandover: `فهمت! خليني أحول لك مستشار يساعدك.

بيتواصل معك خلال دقائق. ✅`
};

// Default messages for Medical Clinic (Gulf Arabic)
export const MEDICAL_CLINIC_MESSAGES: ClientMessages = {
  welcome: `أهلين وسهلين! 👋

شكراً تواصلك مع {businessName}

كيف أقدر أساعدك؟

1️⃣ أبي أحجز موعد
2️⃣ استفسار عن الأطباء
3️⃣ استفسار عن الأسعار
4️⃣ موقع العيادة`,

  questions: [
    {
      text: `تمام! وش التخصص المطلوب؟

1️⃣ طب عام
2️⃣ أسنان
3️⃣ جلدية
4️⃣ عيون
5️⃣ أطفال
6️⃣ نساء وولادة`,
      options: ['طب عام', 'أسنان', 'جلدية', 'عيون', 'أطفال', 'نساء وولادة']
    },
    {
      text: `هل عندك تأمين طبي؟

1️⃣ نعم
2️⃣ لا`,
      options: ['نعم', 'لا']
    },
    {
      text: `متى تفضل الموعد؟

1️⃣ صباحي (8ص - 12ظ)
2️⃣ مسائي (4ع - 9م)
3️⃣ أي وقت متاح`,
      options: ['صباحي', 'مسائي', 'أي وقت']
    }
  ],

  askContact: `ممتاز! 👍

أرسل لي اسمك ورقم جوالك عشان نأكد الحجز:

مثال: فاطمة أحمد، 0501234567`,

  thankYou: `تم استلام طلبك يا {name}! ✅

فريقنا بيتواصل معك خلال ساعة لتأكيد الموعد.

لو عندك أي سؤال، أنا موجود 😊`,

  invalidInput: `ما فهمت عليك 😅

اختر رقم من القائمة لو سمحت`,

  handoverRequested: `حاضر! 👍

طلبت التحدث مع موظف الاستقبال.
بيرد عليك خلال 5 دقائق.`,

  agentNotification: `🔔 *مريض جديد!*

👤 {name}
📱 {phone}
💬 واتساب: {whatsapp}

🏥 التخصص: {interest}
📋 التفاصيل: {details}

⏰ {time}

📌 *تواصل معه!*`,

  appointmentAsk: `متى يناسبك الموعد؟

1️⃣ اليوم
2️⃣ بكرة
3️⃣ بعد بكرة
4️⃣ الأسبوع الجاي`,

  appointmentConfirm: `تم تأكيد موعدك! ✅

📅 التاريخ: {date}
⏰ الوقت: {time}
👨‍⚕️ الدكتور: {doctor}
📍 العيادة: {location}

لا تنسى تجيب بطاقة التأمين لو عندك.`,

  aiGreeting: `أهلاً! كيف أقدر أساعدك؟`,

  aiDontKnow: `ما عندي هالمعلومة الحين 😅

خليني أحولك لموظف الاستقبال يفيدك أكثر.`,

  aiHandover: `تمام! بحولك لموظف الاستقبال.

بيتواصل معك خلال دقائق. ✅`
};

// Helper to get messages by industry
export function getDefaultMessages(industry: string): ClientMessages {
  switch (industry) {
    case 'dealership':
      return CAR_DEALERSHIP_MESSAGES;
    case 'clinic':
      return MEDICAL_CLINIC_MESSAGES;
    default:
      return CAR_DEALERSHIP_MESSAGES;
  }
}

// Replace placeholders in message
export function formatMessage(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  return result;
}
