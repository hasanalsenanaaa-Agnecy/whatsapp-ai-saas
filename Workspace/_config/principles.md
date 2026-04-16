# Coding Principles

These apply to all work on this project.

## Rules

1. **Separate flows from AI**: Static button/list flows are hardcoded state machines in `src/flows/` and `src/messages.ts`. The Claude API is only called for fallback conversations, Q&A responses, or intent detection. Never mix the two.

2. **Bugs before features, features before refactoring**: Fix production issues first. Do not refactor while fixing a bug. Do not add features while fixing a bug.

3. **No over-engineering**: Straightforward code. No abstract factories. No dependency injection containers. Config lives in code, not the database. If you need a utility function more than three times, extract it. Otherwise, inline it.

4. **Token cost awareness**: Every Claude API call costs money and counts against the client's tier. Feature-gate expensive operations. Do not call the AI for things a simple conditional can handle.

5. **Test on real clients**: A change is not done until it has run live on an actual WhatsApp number. Automated tests are necessary but not sufficient.

## What to avoid

- Making assumptions about business logic without asking
- Mixing static flow routing with AI-generated routing
- Writing to the database in message templates or flow files (keep those pure)
- Shipping untested code on the production webhook
- Adding error handling for impossible scenarios — trust internal code
- Backwards-compatibility shims for code you're removing
