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

  // Business (Customizable per client)
  agencyName: getEnvVar('AGENCY_NAME', 'Real Estate Agency'),
  agentPhone: getEnvVar('AGENT_PHONE_NUMBER', '966500000000'),
  
  // Property options (comma-separated in env)
  propertyTypes: getEnvVar('PROPERTY_TYPES', 'Villa,Apartment,Land,Commercial').split(','),
  cities: getEnvVar('CITIES', 'Riyadh,Jeddah,Dammam,Khobar,Other').split(','),
  budgets: getEnvVar('BUDGETS', 'Under 500K SAR,500K-1M SAR,1M-2M SAR,Above 2M SAR').split(','),
  bedrooms: getEnvVar('BEDROOMS', '1-2,3-4,5-6,7+').split(','),

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
  }
} as const;

export function validateConfig(): void {
  const missing: string[] = [];
  if (!config.whatsapp.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!config.whatsapp.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (missing.length > 0) {
    console.error('❌ Missing required:', missing.join(', '));
    if (!config.isDev) process.exit(1);
  }
}

validateConfig();
