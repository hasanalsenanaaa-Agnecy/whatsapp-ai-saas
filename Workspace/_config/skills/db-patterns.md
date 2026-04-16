# Skill: Database Patterns

How to write safe, correct database queries for this multi-tenant platform.

## The one rule that cannot be broken

Every query that touches client data must be scoped by `client_id`. No exceptions.

```typescript
// Correct
const rows = await sql`SELECT * FROM leads WHERE client_id = ${clientId} AND phone = ${phone}`;

// Wrong — exposes all clients' data
const rows = await sql`SELECT * FROM leads WHERE phone = ${phone}`;
```

## Query syntax

Uses the `postgres` library with tagged template literals. Never use string concatenation for values — the template literal handles parameterization.

```typescript
// Correct — parameterized
await sql`UPDATE clients SET active = false WHERE id = ${clientId}`;

// Wrong — SQL injection risk
await sql`UPDATE clients SET active = false WHERE id = '${clientId}'`;
```

## JSONB fields

The `clients` table has four JSONB columns: `features`, `settings`, `knowledge_base`, `questions`. Always parse them with the `parseJSON` helper from `database.ts` — they may be stored as strings or null.

```typescript
features: parseJSON(client.features, getDefaultFeatures()),
settings: parseJSON(client.settings, {}),
knowledge_base: parseJSON(client.knowledge_base, []),
questions: parseJSON(client.questions, []),
```

When updating a JSONB field, use `::jsonb` cast:

```typescript
await sql`
  UPDATE clients
  SET features = ${JSON.stringify(newFeatures)}::jsonb
  WHERE id = ${clientId}
`;
```

## Error handling

Wrap every query in try/catch. Return `null` on error — do not throw. Log the error with `console.error`.

```typescript
export async function getConversation(clientId: string, phone: string) {
  try {
    const rows = await sql`
      SELECT * FROM conversations
      WHERE client_id = ${clientId} AND phone = ${phone}
      LIMIT 1
    `;
    return rows[0] || null;
  } catch (error) {
    console.error('❌ DB error:', error);
    return null;
  }
}
```

## Key tables

| Table | Primary key | Tenant scope | Notes |
|-------|------------|--------------|-------|
| `clients` | `id` | itself | Config, features, tier. Identified by `phone_number_id` on incoming webhooks. |
| `conversations` | `id` | `client_id` | Redis is source of truth for active convos. DB is backup/analytics. |
| `leads` | `id` | `client_id` | One row per captured lead. |
| `appointments` | `id` | `client_id` | Linked to lead via `lead_id`. |

## Adding a new query

1. Add it to `src/services/database.ts`
2. Export the function — do not inline SQL in flow files
3. Scope by `client_id` (or `phone_number_id` for initial client lookup)
4. Return `null` on empty result, throw nothing

## Checking feature flags

Feature flags are on the `client.features` object, already parsed before flows run:

```typescript
if (client.features.appointment_setting) {
  // show appointment booking
}
```

Do not re-query the database to check features inside a flow handler. They're already available on the `client` object passed in.
