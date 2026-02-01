import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

// ============================================================
// KNOWLEDGE BASE AI SYSTEM
// Answers only from provided data, admits when doesn't know
// ============================================================

const anthropic = config.anthropic.apiKey
  ? new Anthropic({ apiKey: config.anthropic.apiKey })
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

// Gulf Arabic system prompt
const SYSTEM_PROMPT = `أنت مساعد ذكي لـ {businessName} في السعودية.

قواعد مهمة جداً:
1. رد بالعربي السعودي (اللهجة الخليجية) - قصير ومباشر
2. أجب فقط من المعلومات المتوفرة - لا تخترع أي شيء
3. لو ما تعرف الإجابة، قل "ما عندي هالمعلومة" واقترح التحويل لموظف
4. لا تكرر أسئلة سبق طُرحت
5. كن صادق وواضح
6. ردودك قصيرة - جملة أو جملتين كافي

معلومات العمل:
{knowledgeBase}

معلومات العميل:
{customerContext}

المحادثة السابقة:
{conversationHistory}`;

export async function generateKnowledgeResponse(
  businessName: string,
  knowledgeBase: KnowledgeItem[],
  customerContext: Record<string, any>,
  conversationHistory: { role: string; content: string }[],
  userMessage: string
): Promise<AIResponse> {
  
  if (!anthropic) {
    return {
      answer: 'عذراً، في مشكلة تقنية. خليني أحولك لموظف.',
      confident: false,
      suggestHandover: true
    };
  }

  // Format knowledge base
  const kbText = knowledgeBase.length > 0
    ? knowledgeBase.map(k => `- ${k.category}: ${k.question}\n  الإجابة: ${k.answer}`).join('\n')
    : 'لا توجد معلومات متوفرة حالياً';

  // Format customer context
  const contextText = Object.entries(customerContext)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n') || 'عميل جديد';

  // Format conversation history (last 10 messages)
  const historyText = conversationHistory
    .slice(-10)
    .map(m => `${m.role === 'user' ? 'العميل' : 'المساعد'}: ${m.content}`)
    .join('\n') || 'بداية المحادثة';

  const systemPrompt = SYSTEM_PROMPT
    .replace('{businessName}', businessName)
    .replace('{knowledgeBase}', kbText)
    .replace('{customerContext}', contextText)
    .replace('{conversationHistory}', historyText);

  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: Math.min(config.anthropic.maxTokens, 600),
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage }
      ]
    });

    const textBlock = response.content.find(block => block.type === 'text');
    const answer = textBlock?.type === 'text' ? textBlock.text : '';

    // Detect if AI is uncertain or suggesting handover
    const uncertainPhrases = ['ما عندي', 'ما أعرف', 'مو متأكد', 'أحولك', 'موظف', 'مستشار'];
    const suggestHandover = uncertainPhrases.some(phrase => answer.includes(phrase));
    const confident = !suggestHandover;

    return {
      answer,
      confident,
      suggestHandover
    };

  } catch (error) {
    console.error('❌ AI error:', error);
    return {
      answer: 'عذراً، في مشكلة. خليني أحولك لموظف يساعدك.',
      confident: false,
      suggestHandover: true
    };
  }
}

// Detect handover intent from user message
export function detectHandoverIntent(message: string): boolean {
  const handoverPhrases = [
    'أبي أكلم',
    'ابي اكلم',
    'كلم شخص',
    'كلم موظف',
    'كلم أحد',
    'تكلم مع',
    'أبغى موظف',
    'ابغى موظف',
    'حول لي',
    'حولني',
    'agent',
    'human',
    'person',
    'talk to someone',
    'representative',
    'مستشار',
    'موظف',
    'إنسان',
    'انسان',
    'بشر'
  ];
  
  const lowerMessage = message.toLowerCase();
  return handoverPhrases.some(phrase => lowerMessage.includes(phrase));
}

// Score lead based on conversation data
export function scoreLead(data: Record<string, any>): 'hot' | 'warm' | 'cold' {
  let score = 0;
  
  // Has budget mentioned
  if (data.budget) {
    score += 2;
    // Higher budget = hotter
    if (data.budget.includes('200') || data.budget.includes('أكثر')) {
      score += 2;
    }
  }
  
  // Has specific interest
  if (data.interest || data.propertyType || data.carType || data.specialty) {
    score += 2;
  }
  
  // Requested appointment
  if (data.appointmentRequested) {
    score += 3;
  }
  
  // Multiple messages (engaged)
  if (data.messageCount && data.messageCount > 5) {
    score += 1;
  }
  
  // Asked about pricing
  if (data.askedAboutPrice) {
    score += 2;
  }
  
  if (score >= 6) return 'hot';
  if (score >= 3) return 'warm';
  return 'cold';
}
