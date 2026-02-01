export const securityConfig = {
  jwt: {
    // JWT_SECRET must be set in environment - no fallback for security
    secret: process.env.JWT_SECRET,
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

  if (missing.length > 0) {
    console.error('❌ Missing required security environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('⚠️  WARNING: Running in development mode without required secrets!');
    }
  }

  // Check for weak secrets
  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret && jwtSecret.length < 32) {
    console.warn('⚠️  WARNING: JWT_SECRET should be at least 32 characters long!');
  }
}
