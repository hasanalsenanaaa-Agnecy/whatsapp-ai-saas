// ============================================================
// MESSAGE TEMPLATES
// Industry-specific messages - all in code, not database
// ============================================================

export interface Question {
  text: string;
  options: string[];
  field: string;
}

export interface ClientMessages {
  welcome: string;
  askName: string;
  questions: Question[];
  thankYou: string;
  thankYouWithAppointment: string;
  invalidInput: string;
  agentNotification: string;
  appointmentNotification: string;
  // Appointment flow messages
  askAppointmentDate: string;
  askAppointmentTime: string;
  appointmentConfirmed: string;
  appointmentReminder: string;
  // Post-completion chat fallback (shown when AI is off and customer messages after completing flow)
  chatFallback: string;
  // Handover messages
  handoverDetected: string;
  handoverAgentNotification: string;
}

// ============================================================
// REAL ESTATE MESSAGES
// ============================================================
const REAL_ESTATE_MESSAGES: ClientMessages = {
  welcome: `أهلاً فيك في {businessName}! 👋

وش اسمك الكريم؟`,
  askName: 'وش اسمك الكريم؟',
  questions: [
    { text: 'كيف أقدر أساعدك؟', options: ['أبي أشتري عقار', 'أبي أبيع عقار', 'أبي أستأجر'], field: 'interest' },
    { text: 'وش نوع العقار؟', options: ['شقة', 'فيلا', 'أرض', 'دوبلكس'], field: 'property_type' },
    { text: 'في أي مدينة؟', options: ['الدمام', 'الخبر', 'الظهران', 'القطيف'], field: 'city' },
    { text: 'كم ميزانيتك؟', options: ['أقل من 500 ألف', '500 ألف - مليون', 'مليون - 2 مليون', 'أكثر من 2 مليون'], field: 'budget' }
  ],
  thankYou: `تمام يا {name}! ✅

معلوماتك وصلت. مستشارنا بيتواصل معك قريب.
شكراً لتواصلك! 🙏`,
  thankYouWithAppointment: `تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.
شكراً لتواصلك! 🙏`,
  invalidInput: 'اختر من الخيارات المتاحة 👆',
  agentNotification: `🏠 *عميل جديد!*

👤 {name}
📱 {phone}

📋 التفاصيل:
{details}

⏰ {time}

wa.me/{whatsapp}`,
  appointmentNotification: `📅 *موعد جديد!*

👤 {name}
📱 {phone}
📅 {appointmentDate}
🕐 {appointmentTime}

📋 التفاصيل:
{details}

wa.me/{whatsapp}`,
  askAppointmentDate: 'متى يناسبك الموعد؟',
  askAppointmentTime: 'أي وقت يناسبك؟',
  appointmentConfirmed: `تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.`,
  appointmentReminder: `مرحبا {name}! 👋

تذكير بموعدك اليوم {appointmentTime} في {businessName}.
نتطلع لخدمتك! ✨`,
  chatFallback: `أهلاً {name}! 👋
تم استلام معلوماتك وأحد المستشارين سيتواصل معك قريباً.
إذا كان عندك استفسار عاجل، رد بـ "موظف".`,
  handoverDetected: `فهمت! خليني أحولك لأحد المستشارين.
بيتواصل معك في أقرب وقت. 🙏`,
  handoverAgentNotification: `🔴 *طلب تحويل!*

العميل يبي يتكلم مع موظف

👤 {name}
📱 {phone}

آخر رسالة: {lastMessage}

wa.me/{whatsapp}`
};

// ============================================================
// CLINIC / MEDICAL MESSAGES
// ============================================================
const CLINIC_MESSAGES: ClientMessages = {
  welcome: `أهلاً فيك في {businessName}! 👋

وش اسمك الكريم؟`,
  askName: 'وش اسمك الكريم؟',
  questions: [
    { text: 'وش نوع الموعد؟', options: ['كشف جديد', 'متابعة', 'استشارة'], field: 'appointment_type' },
    { text: 'أي تخصص تحتاج؟', options: ['عام', 'أسنان', 'جلدية', 'عيون'], field: 'specialty' }
  ],
  thankYou: `تمام يا {name}! ✅

معلوماتك وصلت. بنتواصل معك قريب.
شكراً لتواصلك! 🙏`,
  thankYouWithAppointment: `تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.
شكراً لتواصلك! 🏥`,
  invalidInput: 'اختر من الخيارات المتاحة 👆',
  agentNotification: `🏥 *مريض جديد!*

👤 {name}
📱 {phone}

📋 التفاصيل:
{details}

⏰ {time}

wa.me/{whatsapp}`,
  appointmentNotification: `📅 *موعد جديد!*

👤 {name}
📱 {phone}
📅 {appointmentDate}
🕐 {appointmentTime}

📋 نوع الموعد:
{details}

wa.me/{whatsapp}`,
  askAppointmentDate: 'متى يناسبك الموعد؟',
  askAppointmentTime: 'أي وقت يناسبك؟',
  appointmentConfirmed: `تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.`,
  appointmentReminder: `مرحبا {name}! 👋

تذكير بموعدك اليوم {appointmentTime} في {businessName}.
نتطلع لخدمتك! ✨`,
  chatFallback: `أهلاً {name}! 👋
تم استلام معلوماتك وفريق الاستقبال سيتواصل معك قريباً.
إذا كان عندك استفسار عاجل، رد بـ "موظف".`,
  handoverDetected: `فهمت! خليني أحولك للاستقبال.
بيتواصلون معك في أقرب وقت. 🙏`,
  handoverAgentNotification: `🔴 *طلب تحويل!*

المريض يبي يتكلم مع موظف

👤 {name}
📱 {phone}

آخر رسالة: {lastMessage}

wa.me/{whatsapp}`
};

// ============================================================
// CAR DEALERSHIP MESSAGES
// ============================================================
const CAR_DEALERSHIP_MESSAGES: ClientMessages = {
  welcome: `أهلاً فيك في {businessName}! 👋

وش اسمك الكريم؟`,
  askName: 'وش اسمك الكريم؟',
  questions: [
    { text: 'كيف أقدر أساعدك؟', options: ['أبي أشتري سيارة', 'أبي أبيع سيارتي', 'حجز صيانة'], field: 'interest' },
    { text: 'وش نوع السيارة؟', options: ['سيدان', 'جيب', 'بيك أب'], field: 'car_type' },
    { text: 'كم ميزانيتك؟', options: ['أقل من 50 ألف', '50 - 100 ألف', 'أكثر من 100 ألف'], field: 'budget' },
    { text: 'جديدة ولا مستعملة؟', options: ['جديدة', 'مستعملة'], field: 'condition' }
  ],
  thankYou: `تمام يا {name}! ✅

معلوماتك وصلت. مستشارنا بيتواصل معك قريب.
شكراً لتواصلك! 🙏`,
  thankYouWithAppointment: `تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.
شكراً لتواصلك! 🚗`,
  invalidInput: 'اختر من الخيارات المتاحة 👆',
  agentNotification: `🚗 *عميل جديد!*

👤 {name}
📱 {phone}

📋 التفاصيل:
{details}

⏰ {time}

wa.me/{whatsapp}`,
  appointmentNotification: `📅 *موعد جديد!*

👤 {name}
📱 {phone}
📅 {appointmentDate}
🕐 {appointmentTime}

📋 التفاصيل:
{details}

wa.me/{whatsapp}`,
  askAppointmentDate: 'متى يناسبك الموعد؟',
  askAppointmentTime: 'أي وقت يناسبك؟',
  appointmentConfirmed: `تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.`,
  appointmentReminder: `مرحبا {name}! 👋

تذكير بموعدك اليوم {appointmentTime} في {businessName}.
نتطلع لخدمتك! ✨`,
  chatFallback: `أهلاً {name}! 👋
تم استلام معلوماتك وأحد المستشارين سيتواصل معك قريباً.
إذا كان عندك استفسار عاجل، رد بـ "موظف".`,
  handoverDetected: `فهمت! خليني أحولك لأحد المستشارين.
بيتواصل معك في أقرب وقت. 🙏`,
  handoverAgentNotification: `🔴 *طلب تحويل!*

العميل يبي يتكلم مع موظف

👤 {name}
📱 {phone}

آخر رسالة: {lastMessage}

wa.me/{whatsapp}`
};

// ============================================================
// GENERIC MESSAGES (default)
// ============================================================
const GENERIC_MESSAGES: ClientMessages = {
  welcome: `أهلاً فيك في {businessName}! 👋

وش اسمك الكريم؟`,
  askName: 'وش اسمك الكريم؟',
  questions: [
    { text: 'كيف أقدر أساعدك؟', options: ['استفسار', 'طلب خدمة', 'تواصل معنا'], field: 'interest' }
  ],
  thankYou: `تمام يا {name}! ✅

بنتواصل معك قريب.
شكراً لتواصلك! 🙏`,
  thankYouWithAppointment: `تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.
شكراً لتواصلك! 🙏`,
  invalidInput: 'اختر من الخيارات 👆',
  agentNotification: `🔔 *عميل جديد!*

👤 {name}
📱 {phone}

📋 التفاصيل:
{details}

⏰ {time}

wa.me/{whatsapp}`,
  appointmentNotification: `📅 *موعد جديد!*

👤 {name}
📱 {phone}
📅 {appointmentDate}
🕐 {appointmentTime}

wa.me/{whatsapp}`,
  askAppointmentDate: 'متى يناسبك الموعد؟',
  askAppointmentTime: 'أي وقت يناسبك؟',
  appointmentConfirmed: `تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.`,
  appointmentReminder: `مرحبا {name}! 👋

تذكير بموعدك اليوم {appointmentTime} في {businessName}.
نتطلع لخدمتك! ✨`,
  chatFallback: `أهلاً {name}! 👋
تم استلام معلوماتك وفريقنا سيتواصل معك قريباً.
إذا كان عندك استفسار عاجل، رد بـ "موظف".`,
  handoverDetected: `فهمت! خليني أحولك لأحد الموظفين.
بيتواصل معك في أقرب وقت. 🙏`,
  handoverAgentNotification: `🔴 *طلب تحويل!*

العميل يبي يتكلم مع موظف

👤 {name}
📱 {phone}

آخر رسالة: {lastMessage}

wa.me/{whatsapp}`
};

// ============================================================
// SHOPIFY / E-COMMERCE MESSAGES
// Used as fallback if a shopify client has no Shopify config
// and falls through to the standard flow.
// The dedicated shopify bot (shopify-agent.ts) has its own
// inline messages and does not read these.
// ============================================================
const SHOPIFY_MESSAGES: ClientMessages = {
  welcome: `مرحباً بك في {businessName}! 🌴

وش اسمك الكريم؟`,
  askName: 'وش اسمك الكريم؟',
  questions: [
    { text: 'كيف نقدر نساعدك؟', options: ['تصفح المنتجات', 'متابعة طلب', 'تكلم مع موظف'], field: 'intent' }
  ],
  thankYou: `شكراً لتسوقك من {businessName}! 🙏
نتمنى تعجبك المنتجات ❤️`,
  thankYouWithAppointment: `شكراً لتسوقك من {businessName}! 🙏
نتمنى تعجبك المنتجات ❤️`,
  invalidInput: 'اختر من الخيارات المتاحة 👆',
  agentNotification: `🛒 *عميل جديد!*

👤 {name}
📱 {phone}

📋 التفاصيل:
{details}

⏰ {time}

wa.me/{whatsapp}`,
  appointmentNotification: `📅 *موعد جديد!*

👤 {name}
📱 {phone}
📅 {appointmentDate}
🕐 {appointmentTime}

wa.me/{whatsapp}`,
  askAppointmentDate: 'متى يناسبك الموعد؟',
  askAppointmentTime: 'أي وقت يناسبك؟',
  appointmentConfirmed: `تمام يا {name}! ✅

تم حجز موعدك:
📅 {appointmentDate}
🕐 {appointmentTime}

بنرسل لك تذكير قبل الموعد.`,
  appointmentReminder: `مرحبا {name}! 👋

تذكير بموعدك اليوم {appointmentTime} في {businessName}.
نتطلع لخدمتك! ✨`,
  chatFallback: `أهلاً {name}! 👋
طلبك وصلنا وفريقنا على اطلاع.
إذا تحتاج مساعدة، رد بـ "موظف".`,
  handoverDetected: `فهمت! خليني أحولك لأحد الموظفين.
بيتواصل معك في أقرب وقت. 🙏`,
  handoverAgentNotification: `🔴 *طلب تحويل!*

العميل يبي يتكلم مع موظف

👤 {name}
📱 {phone}

آخر رسالة: {lastMessage}

wa.me/{whatsapp}`
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

export function getDefaultMessages(industry: string): ClientMessages {
  switch (industry) {
    case 'real_estate':
      return REAL_ESTATE_MESSAGES;
    case 'clinic':
    case 'medical':
    case 'dental':
    case 'healthcare':
      return CLINIC_MESSAGES;
    case 'dealership':
    case 'car_dealership':
    case 'automotive':
      return CAR_DEALERSHIP_MESSAGES;
    case 'shopify':
    case 'ecommerce':
    case 'e-commerce':
      return SHOPIFY_MESSAGES;
    default:
      return GENERIC_MESSAGES;
  }
}

export function formatMessage(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  return result;
}
