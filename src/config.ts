// ============================================================
// CENTRALIZED CONFIGURATION
// ============================================================
// All environment variables and settings in one place

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    console.warn(`⚠️ Missing environment variable: ${key}`);
  }
  return value || defaultValue || '';
}

export const config = {
  // App
  version: '3.0.0',
  isDev: process.env.NODE_ENV !== 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

  // Business
  agencyName: getEnvVar('AGENCY_NAME', 'Your Real Estate Agency'),
  agentPhone: getEnvVar('AGENT_PHONE_NUMBER', '966563057345'),

  // WhatsApp API
  whatsapp: {
    phoneNumberId: getEnvVar('WHATSAPP_PHONE_NUMBER_ID'),
    accessToken: getEnvVar('WHATSAPP_ACCESS_TOKEN'),
    verifyToken: getEnvVar('WHATSAPP_VERIFY_TOKEN', 'my-test-verify-token'),
    apiVersion: 'v21.0'
  },

  // Claude AI
  anthropic: {
    apiKey: getEnvVar('ANTHROPIC_API_KEY'),
    model: 'claude-sonnet-4-20250514',
    maxTokens: 1024
  },

  // Google Sheets
  google: {
    sheetId: getEnvVar('GOOGLE_SHEET_ID'),
    credentials: process.env.GOOGLE_CREDENTIALS || null,
    credentialsPath: './google-credentials.json',
    sheetName: getEnvVar('GOOGLE_SHEET_NAME', 'Sheet1')
  },

  // Rate Limiting
  rateLimit: {
    maxRequests: 100,
    windowMs: 60 * 1000 // 1 minute
  }
} as const;

// Validate critical config on startup
export function validateConfig(): void {
  const missing: string[] = [];

  if (!config.whatsapp.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!config.whatsapp.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!config.anthropic.apiKey) missing.push('ANTHROPIC_API_KEY');

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('Please check your .env file or environment configuration.');
    
    if (!config.isDev) {
      process.exit(1);
    }
  }
}

// Run validation
validateConfig();
