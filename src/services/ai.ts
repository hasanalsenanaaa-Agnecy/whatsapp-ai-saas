import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { ConversationMessage } from '../types.js';

// ============================================================
// AI SERVICE (Claude)
// ============================================================

// Initialize client (lazy - only when API key exists)
let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    anthropicClient = new Anthropic({
      apiKey: config.anthropic.apiKey
    });
  }
  return anthropicClient;
}

/**
 * Generate AI response with conversation history
 * 
 * @param systemPrompt - The system prompt with context
 * @param conversationHistory - Array of previous messages
 * @returns AI generated response
 */
export async function generateAIResponse(
  systemPrompt: string,
  conversationHistory: ConversationMessage[]
): Promise<string> {
  try {
    const client = getClient();

    // Format messages for Claude API
    const messages: Anthropic.MessageParam[] = conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Ensure we have at least one message
    if (messages.length === 0) {
      throw new Error('Conversation history is empty');
    }

    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      system: systemPrompt,
      messages: messages
    });

    // Extract text from response
    const textBlock = response.content.find(block => block.type === 'text');
    
    if (!textBlock || textBlock.type !== 'text') {
      console.warn('⚠️ No text in AI response');
      return 'I apologize, I could not generate a response. Please try again.';
    }

    return textBlock.text;

  } catch (error) {
    // Handle specific error types
    if (error instanceof Anthropic.APIError) {
      console.error('❌ Claude API Error:', {
        status: error.status,
        message: error.message
      });

      // Handle rate limiting
      if (error.status === 429) {
        return 'I\'m currently experiencing high demand. Please try again in a moment.';
      }

      // Handle authentication errors
      if (error.status === 401) {
        console.error('❌ Invalid Anthropic API key');
        return 'Sorry, there\'s a configuration issue. Our team has been notified.';
      }
    }

    console.error('❌ AI generation error:', error);
    return 'Sorry, I\'m having trouble responding right now. A human agent will assist you shortly.';
  }
}

/**
 * Generate a simple one-shot response (no history)
 */
export async function generateSimpleResponse(
  prompt: string,
  systemContext?: string
): Promise<string> {
  return generateAIResponse(
    systemContext || 'You are a helpful assistant. Be concise and friendly.',
    [{ role: 'user', content: prompt }]
  );
}

/**
 * Check if AI service is available
 */
export function isAIAvailable(): boolean {
  return !!config.anthropic.apiKey;
}

export async function generateLeadScore(
  leadData: Record<string, any>
): Promise<{ score: 'hot' | 'warm' | 'cold'; rationale: string }> {
  const client = getClient();

  const system = `You are a lead scoring assistant.\nReturn ONLY valid JSON.\nSchema: {"score":"hot|warm|cold","rationale":"string"}.`;
  const user = `Lead data JSON:\n${JSON.stringify(leadData, null, 2)}`;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 200,
    system,
    messages: [{ role: 'user', content: user }]
  });

  const textBlock = response.content.find(block => block.type === 'text');
  const raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';

  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('Invalid AI response format');
  }

  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  const score = parsed.score as 'hot' | 'warm' | 'cold';
  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : '';

  if (!['hot', 'warm', 'cold'].includes(score)) {
    throw new Error('Invalid score value');
  }

  return { score, rationale };
}
