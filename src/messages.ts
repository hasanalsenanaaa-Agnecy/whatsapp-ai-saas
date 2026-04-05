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
  welcomeButtons?: { id: string; title: string }[];
  askName: string;
  questions: Question[];
  thankYou: string;
  thankYouWithAppointment: string;  // NEW: When appointment is booked
  invalidInput: string;
  agentNotification: string;
  appointmentNotification: string;  // NEW: Separate appointment notification
  // Appointment flow messages
  askAppointmentDate: string;
  askAppointmentTime: string;
  appointmentConfirmed: string;
  appointmentReminder: string;
  // Handover messages
  handoverDetected: string;
  handoverAgentNotification: string;
}

// ============================================================
// REAL ESTATE MESSAGES
// ============================================================
export const REAL_ESTATE_MESSAGES: ClientMessages = {
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

تذكير بموعدك اليوم {appointmentTime}.
نتطلع لخدمتك! ✨`,
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
export const CLINIC_MESSAGES: ClientMessages = {
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
export const CAR_DEALERSHIP_MESSAGES: ClientMessages = {
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

تذكير بموعدك اليوم {appointmentTime}.
نتطلع لخدمتك! ✨`,
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
// DENTAL CLINIC MESSAGES (Perfect Smile)
// ============================================================
export const DENTAL_CLINIC_MESSAGES: ClientMessages = {
  welcome: `أهلاً وسهلاً في {businessName}! 🦷\n\nوش اسمك الكريم؟`,
  askName: `وش اسمك الكريم؟`,
  questions: [], // not used — clinic flow is handled dynamically in handleClinicFlow()
  thankYou: `شكراً يا {name}! ✅\n\nتم استلام طلبك وسيتواصل معك فريقنا قريباً.\n\n📍 {address}\n⏰ {workingHours}`,
  thankYouWithAppointment: `شكراً يا {name}! ✅\n\nتم استلام طلبك وسيتواصل معك فريقنا قريباً.\n\n📍 {address}`,
  invalidInput: `اختر من الخيارات المتاحة 👆`,
  agentNotification: `🦷 *مريض جديد - بوت واتساب*\n\n👤 {name}\n📱 {phone}\n\n📋 {details}\n⏰ {time}\n\nwa.me/{whatsapp}`,
  appointmentNotification: `📅 *طلب موعد جديد*\n\n👤 {name}\n📱 {phone}\n📋 {details}\n\nwa.me/{whatsapp}`,
  askAppointmentDate: `متى يناسبك الموعد؟`,
  askAppointmentTime: `أي وقت يناسبك؟`,
  appointmentConfirmed: `تمام يا {name}! ✅\n\nتم تسجيل طلبك.`,
  appointmentReminder: `مرحبا {name}! 👋\n\nتذكير بموعدك اليوم {appointmentTime} في {businessName}.\nنتطلع لخدمتك! ✨`,
  handoverDetected: `فهمت! خليني أحولك للاستقبال.\nبيتواصلون معك في أقرب وقت. 🙏`,
  handoverAgentNotification: `🔴 *طلب تحويل للموظف*\n\n👤 {name}\n📱 {phone}\n\nآخر رسالة: {lastMessage}\n\nwa.me/{whatsapp}`
};

// ============================================================
// GENERIC MESSAGES (default)
// ============================================================
export const GENERIC_MESSAGES: ClientMessages = {
  welcome: `أهلاً فيك في {businessName}! 👋

وش اسمك الكريم؟`,
  askName: 'وش اسمك الكريم؟',
  questions: [
    { text: 'كيف أقدر أساعدك؟', options: ['استفسار', 'طلب خدمة', 'شكوى'], field: 'interest' }
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

تذكير بموعدك اليوم {appointmentTime}.
نتطلع لخدمتك! ✨`,
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
// ============================================================
export const SHOPIFY_MESSAGES: ClientMessages = {
  welcome: `مرحباً بك في {businessName}! 🛍️

عندنا أحلى المنتجات! وش تبي تسوي؟`,
  askName: 'قبل نبدأ، ممكن اسمك الكريم؟ 😊',
  questions: [
    { text: 'كيف نقدر نساعدك؟', options: ['تصفح المنتجات', 'البحث عن منتج', 'متابعة طلب', 'تكلم مع موظف'], field: 'intent' }
  ],
  thankYou: `شكراً لتسوقك من {businessName}! 🙏
نتمنى تعجبك المنتجات ❤️`,
  thankYouWithAppointment: `شكراً لتسوقك من {businessName}! 🙏
نتمنى تعجبك المنتجات ❤️`,
  invalidInput: 'اختر من الخيارات المتاحة 👆',
  agentNotification: `🛒 *طلب جديد!*

👤 {name}
📱 {phone}
💬 wa.me/{whatsapp}

📦 المنتج: {productName}
💰 المبلغ: {price} ريال
🔗 رابط الدفع: {checkoutUrl}
⏰ {time}`,
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

تذكير بموعدك اليوم {appointmentTime}.
نتطلع لخدمتك! ✨`,
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
// SHOPIFY-SPECIFIC EXTRA MESSAGES (not part of ClientMessages)
// ============================================================
export const SHOPIFY_EXTRA_MESSAGES = {
  productList: 'تفضل منتجاتنا المتوفرة: 👇',
  productDetails: `📦 *{productName}*
💰 السعر: {price} ريال

{description}`,
  checkoutLink: `تفضل رابط الدفع 💳
{checkoutUrl}

بعد ما تدفع، راح نأكد طلبك ✅`,
  orderConfirmed: `تم تأكيد طلبك بنجاح! ✅

شكراً {name}! بنتواصل معك لتوصيل الطلب 📦`,
  paymentConfirmation: `✅ *تم الدفع!*

👤 {name}
📱 {phone}
📦 المنتج: {productName}
💰 المبلغ: {price} ريال
⏰ {time}`,
  searchPrompt: 'وش تبي تبحث عنه؟ 🔍',
  noProducts: 'ما لقينا منتجات حالياً. تبي تتكلم مع موظف؟',
  noSearchResults: 'ما لقينا نتائج لبحثك. جرب كلمة ثانية أو تصفح كل المنتجات.',
  orderButton: 'اطلب الحين',
  confirmPaymentButton: 'تأكيد الدفع',
  browseButton: 'تصفح المنتجات',
  apiError: 'عذراً، صار خطأ في النظام. حاول مرة ثانية أو تكلم مع موظف.'
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

export function getDefaultMessages(industry: string): ClientMessages {
  switch (industry) {
    case 'real_estate': 
      return REAL_ESTATE_MESSAGES;
    case 'dental':
      return DENTAL_CLINIC_MESSAGES;
    case 'clinic':
    case 'medical':
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
