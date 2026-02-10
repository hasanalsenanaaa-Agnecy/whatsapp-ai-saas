/**
 * OpenAPI/Swagger Configuration
 */

export const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WhatsApp AI SaaS API',
      version: '4.0.0',
      description: 'Production-ready WhatsApp AI receptionist SaaS platform',
      contact: {
        name: 'Support',
        email: 'support@example.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development'
      }
    ]
  }
};
