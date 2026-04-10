import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// KNOWLEDGE BASE AI SYSTEM
// Gulf Arabic responses, lead scoring, handover detection
// ============================================================

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export interface KnowledgeItem {
  category: string;
  question: string;
  answer: string;
}

export interface AIResponse {
  answer: string;
  confident: boolean;
  suggestHandover: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Gulf Arabic system prompt — knowledgeable salesperson
const SYSTEM_PROMPT = `أنت مسؤول مبيعات محترف لـ {businessName}. تعرف كل شي عن المنتجات وتساعد العميل يختار.

قواعد:
1. رد بالعربي الخليجي — قصير ومباشر، جملة أو جملتين
2. استخدم المعلومات المتوفرة أدناه للإجابة — إذا السؤال عن منتج موجود في القائمة، أجب بثقة عن سعره ومواصفاته
3. لو السؤال عن شي مو موجود أبداً في المعلومات (مثل سياسة الإرجاع أو مواعيد التوصيل)، قل "خليني أحولك لفريقنا يساعدك"
4. لا تخترع معلومات غير موجودة — بس لا تقول "ما عندي" إذا الجواب موجود في المنتجات
5. لا تستخدم إيموجي
6. إذا العميل يسأل عن أفضل منتج أو توصية، اذكر المنتجات المتوفرة وخل العميل يختار

معلومات العمل والمنتجات:
{knowledgeBase}

معلومات العميل:
{customerContext}`;

/**
 * Check if AI service is available
 */
export function isAIAvailable(): boolean {
  return anthropic !== null;
}

/**
 * Generate AI response using knowledge base
 */
export async function generateKnowledgeResponse(
  businessName: string,
  knowledgeBase: KnowledgeItem[],
  customerContext: Record<string, any>,
  conversationHistory: ConversationMessage[],
  userMessage: string
): Promise<AIResponse> {
  // If no API key, return graceful fallback
  if (!anthropic) {
    console.warn('⚠️ Anthropic API key not configured');
    return {
      answer: 'عذراً، ما قدرت أفهم. خليني أكمل معك.',
      confident: false,
      suggestHandover: false
    };
  }

  try {
    // Format knowledge base
    const kbText = knowledgeBase.length > 0
      ? knowledgeBase.map(k => `- ${k.category}: ${k.question}\n  الإجابة: ${k.answer}`).join('\n')
      : 'لا توجد معلومات إضافية متوفرة';

    // Format customer context
    const contextText = Object.entries(customerContext)
      .filter(([_, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') || 'عميل جديد';

    // Build system prompt
    const systemPrompt = SYSTEM_PROMPT
      .replace('{businessName}', businessName)
      .replace('{knowledgeBase}', kbText)
      .replace('{customerContext}', contextText);

    // Prepare messages (last 6 messages for context)
    const recentHistory = conversationHistory.slice(-6);
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      ...recentHistory.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      })),
      { role: 'user' as const, content: userMessage }
    ];

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages
    });

    const textBlock = response.content.find(block => block.type === 'text');
    const answer = textBlock?.type === 'text' ? textBlock.text.trim() : '';

    // Detect if AI is uncertain or suggesting handover
    const uncertainPhrases = ['ما عندي', 'ما أعرف', 'مو متأكد', 'أحولك', 'لفريقنا', 'موظف', 'مستشار'];
    const suggestHandover = uncertainPhrases.some(phrase => answer.includes(phrase));

    return {
      answer: answer || 'عذراً، ما قدرت أفهم. خليني أكمل معك.',
      confident: !suggestHandover,
      suggestHandover
    };

  } catch (error) {
    console.error('❌ AI error:', error);
    return {
      answer: 'عذراً، صار خطأ. خليني أكمل معك.',
      confident: false,
      suggestHandover: false
    };
  }
}

/**
 * Detect if user wants to talk to a human
 */
export function detectHandoverIntent(message: string): boolean {
  const handoverPhrases = [
    // Arabic
    'أبي أكلم',
    'ابي اكلم',
    'كلم شخص',
    'كلم موظف',
    'كلم أحد',
    'أبغى موظف',
    'ابغى موظف',
    'حول لي',
    'حولني',
    'مستشار',
    'موظف',
    'إنسان',
    'انسان',
    'بشر',
    'أبي أتكلم مع أحد',
    'ابي اتكلم مع احد',
    'وصلني بموظف',
    'تكلم مع',
    // English
    'agent',
    'human',
    'person',
    'talk to someone',
    'representative',
    'speak to',
    'real person'
  ];

  const lowerMessage = message.toLowerCase().trim();
  return handoverPhrases.some(phrase => lowerMessage.includes(phrase));
}

/**
 * Check if message looks like a question (vs expected flow input)
 */
export function looksLikeQuestion(message: string): boolean {
  const lowerMessage = message.toLowerCase().trim();

  // Too short to be a real question
  if (lowerMessage.length < 4) return false;

  // Explicit question marks — always a question
  if (lowerMessage.includes('?') || lowerMessage.includes('؟')) return true;

  // Strong question words — high confidence (no question mark needed)
  const strongIndicators = [
    // Question words
    'كم', 'كيف', 'متى', 'وين', 'ليش', 'ليه', 'شو', 'وش', 'ايش', 'إيش',
    // Pricing
    'سعر', 'اسعار', 'أسعار', 'تكلفة', 'بكم',
    // Availability
    'عندكم', 'عندك', 'فيه', 'متوفر', 'موجود',
    // Capability
    'تقدر', 'تقدرون', 'يصير', 'ينفع',
    // Comparison / recommendation
    'احسن', 'أحسن', 'افضل', 'أفضل', 'الفرق', 'انصح', 'أنصح', 'تنصح',
    // Request patterns (natural questions without ?)
    'ابي اعرف', 'أبي أعرف', 'ابغى اعرف', 'أبغى أعرف',
    'ودي اعرف', 'حابب اعرف', 'حاب اعرف',
    'قولي', 'قول لي', 'خبرني', 'خبر لي',
    'وش عندكم', 'ايش عندكم', 'شو عندكم',
    'وش الأنواع', 'ايش الانواع',
    'ابي شي', 'أبي شي', 'ابغى شي', 'أبغى شي',
    'شنو', 'شلون'
  ];
  if (strongIndicators.some(q => lowerMessage.includes(q))) return true;

  // Weak indicators — only match if message is long enough to be a real question
  if (lowerMessage.length >= 8) {
    const weakIndicators = [
      'هل', 'موقع', 'عنوان', 'رقم', 'تواصل',
      'مواعيد', 'دوام', 'ساعات', 'متاح', 'فاضي',
      'ممكن', 'توصيل', 'شحن', 'تبديل', 'استرجاع', 'ضمان',
      'نوع', 'أنواع', 'انواع', 'مقاس', 'حجم',
      'طريقة', 'كيفية'
    ];
    if (weakIndicators.some(q => lowerMessage.includes(q))) return true;
  }

  return false;
}

/**
 * Score lead based on conversation data
 * Returns: 'hot' | 'warm' | 'cold'
 */
export function scoreLead(data: Record<string, any>): 'hot' | 'warm' | 'cold' {
  let score = 0;

  // Has budget mentioned
  if (data.budget || data.ميزانية) {
    score += 2;
    // Higher budget indicators
    const budgetStr = String(data.budget || data.ميزانية || '').toLowerCase();
    if (budgetStr.includes('مليون') || budgetStr.includes('أكثر') || budgetStr.includes('اكثر')) {
      score += 2;
    }
  }

  // Has specific interest
  if (data.interest || data.propertyType || data.نوع || data.اهتمام) {
    score += 2;
  }

  // Has location preference
  if (data.location || data.موقع || data.منطقة || data.حي) {
    score += 1;
  }

  // Requested appointment or urgent
  if (data.appointment || data.appointmentRequested || data.موعد) {
    score += 3;
  }

  // Multiple interactions (engaged customer)
  const messageCount = data.messageCount || 0;
  if (messageCount > 5) {
    score += 1;
  }
  if (messageCount > 10) {
    score += 1;
  }

  // Asked about pricing (serious buyer)
  if (data.askedAboutPrice || data.priceInquiry) {
    score += 2;
  }

  // Ready to buy/move soon
  const timeline = String(data.timeline || data.وقت || '').toLowerCase();
  if (timeline.includes('الآن') || timeline.includes('اليوم') || timeline.includes('أسبوع') || timeline.includes('شهر')) {
    score += 2;
  }

  // Scoring thresholds
  if (score >= 6) return 'hot';
  if (score >= 3) return 'warm';
  return 'cold';
}

/**
 * Get score label in Arabic
 */
export function getScoreLabel(score: 'hot' | 'warm' | 'cold'): string {
  switch (score) {
    case 'hot': return '🔥 حار';
    case 'warm': return '🟡 دافئ';
    case 'cold': return '❄️ بارد';
    default: return 'جديد';
  }
}
