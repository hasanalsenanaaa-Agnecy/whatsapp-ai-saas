# Workspace Context

## What this workspace covers

This is the working area for the WhatsApp AI SaaS project. It contains stage-specific context files, reference material, and working artifacts for each session.

## Routing table

| What you want to do | Stage | Load |
|---------------------|-------|------|
| Diagnose or fix a bug | stages/01_debug/ | CONTEXT.md + output/current-bug.md |
| Build or extend a feature | stages/02_feature/ | CONTEXT.md + output/current-feature.md |

## Shared reference (load when relevant)

- `_config/principles.md` — coding constraints and what to avoid
- `_config/architecture.md` — project structure, file responsibilities, patterns
- `_config/skills/whatsapp-flows.md` — state machine conventions, send functions, limits
- `_config/skills/arabic-voice.md` — Gulf Arabic message tone and template patterns
- `_config/skills/db-patterns.md` — multi-tenant query conventions

## Notes

Working artifacts (current bug, current feature) live in each stage's output/ folder.
Update them at the start of each session so they reflect what's actually being worked on.
