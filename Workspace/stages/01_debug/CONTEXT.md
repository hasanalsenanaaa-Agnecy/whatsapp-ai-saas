# Debug Stage

## Role

Diagnose and fix bugs in the production WhatsApp automation platform. Live clients are affected — precision matters more than speed.

## Inputs

- Layer 4 (working): output/current-bug.md — the bug description, steps to reproduce, and what's been tried
- Layer 3 (reference): ../../_config/principles.md — what not to do
- Layer 3 (reference): ../../_config/architecture.md — where things live in the codebase
- Layer 3 (skill, load if bug is in a flow): ../../_config/skills/whatsapp-flows.md
- Layer 3 (skill, load if bug involves messages or Arabic text): ../../_config/skills/arabic-voice.md
- Layer 3 (skill, load if bug involves database queries): ../../_config/skills/db-patterns.md

## Process

1. Read `output/current-bug.md` to understand the reported symptom and context
2. Use `architecture.md` to identify the likely source file(s)
3. Read the relevant source files before proposing anything
4. Diagnose root cause — do not guess
5. Write a minimal, targeted fix
6. Update `output/current-bug.md` with: root cause, files changed, what to test

## Outputs

- Fixed source file(s) in `src/`
- Updated `output/current-bug.md` with diagnosis and change summary

## Constraints

- Fix the reported bug only. Do not clean up surrounding code.
- Do not mix static flow logic with AI/Claude API calls.
- If a test needs updating, note it explicitly — do not silently change test expectations.
- One change at a time. If fixing the bug reveals a second issue, document it and stop.
