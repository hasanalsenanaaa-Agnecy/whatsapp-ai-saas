# Feature Stage

## Role

Build or extend features in the WhatsApp automation platform. Minimum working implementation — nothing speculative.

## Inputs

- Layer 4 (working): output/current-feature.md — the feature spec, requirements, and acceptance criteria
- Layer 3 (reference): ../../_config/principles.md — coding constraints and what to avoid
- Layer 3 (reference): ../../_config/architecture.md — where new code belongs
- Layer 3 (skill, load if building a flow or state): ../../_config/skills/whatsapp-flows.md
- Layer 3 (skill, load if writing messages or button labels): ../../_config/skills/arabic-voice.md
- Layer 3 (skill, load if writing database queries): ../../_config/skills/db-patterns.md

## Process

1. Read `output/current-feature.md` to understand what needs to be built
2. Ask clarifying questions if requirements are ambiguous before writing any code
3. Use `architecture.md` to identify where the new code belongs
4. Build the minimum working implementation
5. Update `output/current-feature.md` with: what was built, files changed, how to test

## Outputs

- New or modified source files in `src/`
- Updated `output/current-feature.md` with implementation summary

## Constraints

- Static button/list flows go in `src/flows/` and `src/messages.ts`. Keep them as state machines.
- AI (Claude API) is only for fallback conversations, Q&A, or intent detection. Never in the main flow.
- Feature-gate expensive operations by pricing tier (Basic/Pro/Business).
- No abstract factories. No config in the database. No speculative abstractions.
- If it requires a new database table or Redis key pattern, document the schema change explicitly.
