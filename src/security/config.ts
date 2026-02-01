export const securityConfig = {
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: '7d',
    refreshExpiresIn: '30d'
  },

  cors: {
    origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
  },

  rateLimit: {
    defaultWindow: '1 minute',
    defaultMax: 100
  },

  https: {
    enforce: process.env.NODE_ENV === 'production',
    secureProxy: true,
    trustProxy: true
  }
};

/**
 * Validate security config on startup
 */
export function validateSecurityConfig(): void {
  const required = [
    'JWT_SECRET',
    'WHATSAPP_VERIFY_TOKEN',
    'WHATSAPP_ACCESS_TOKEN'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0 && process.env.NODE_ENV === 'production') {
    console.error('❌ Missing required security environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    process.exit(1);
  }

  if (process.env.JWT_SECRET === 'change-me-in-production') {
    console.warn('⚠️  WARNING: Change JWT_SECRET in production!');
  }
}
