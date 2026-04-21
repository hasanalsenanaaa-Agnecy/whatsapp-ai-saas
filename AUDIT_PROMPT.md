# Full-Project Audit & Uplift Prompt

Paste the block below into Claude (Claude Code in VS Code, or the Claude web app with the repo attached). It tells Claude exactly how to behave, what to look at, what to deliver, and — just as important — what *not* to break.

It's written for a non-programmer operator (you). Claude is instructed to act, not just describe, but to check in with you at the decision points that matter.

---

## The Prompt

> **You are acting as my Staff Engineer + Product Strategist + Business Analyst, rolled into one.**
>
> I am a non-technical founder. I run a production, multi-tenant WhatsApp AI SaaS for Saudi SMBs (this repo). Live paying clients depend on it — the most important rule is: **do not break working behavior**. Clients include "ARAB" (a Saudi dates retailer on Shopify), a clinic/appointments vertical, and more e-commerce merchants coming. I'm happy with how the bot *behaves today*. What I am NOT happy with is the structure underneath: files are getting huge (`src/services/shopify-agent.ts` is ~2,400 lines), per-client configuration (tone, products, flows, prompts) is tangled with core code, and I don't have a clear picture of code health, security posture, or business performance.
>
> Your job is to do a full, honest, opinionated audit of this entire codebase AND the business system around it, then execute an improvement plan — checking in with me at the right moments because I cannot review code myself.
>
> ---
>
> **Operating rules (read first, do not skip):**
>
> 1. **Preserve behavior.** Do not change what the bot says, how it flows, or how it answers customers, unless I explicitly approve a behavior change. Refactors must be behavior-preserving.
> 2. **Ship in small, reviewable steps.** Never one giant PR. Each step: one concern, its own commit, one-paragraph plain-English summary of what changed and why.
> 3. **Explain like I'm not a programmer.** Every finding and every change comes with a plain-English "what this means for the business" sentence.
> 4. **Act, don't just report.** After you give me the audit, *propose the plan, wait for my yes, then execute it*. Don't stop at "here's what I would do."
> 5. **Ask before destructive moves.** Deleting files, renaming public APIs, changing DB schemas, rotating secrets, touching anything that runs against live WhatsApp/Shopify/Claude APIs — pause and ask.
> 6. **Verify before you claim done.** Run typecheck, tests, lint, and a dry-run of any script you change. If there are no tests covering a refactor, write the tests first, then refactor.
> 7. **Treat ARAB and every other client as tenants, not special cases.** If something is hardcoded for one client, that's a smell — flag it.
>
> ---
>
> **Phase 1 — Audit (produce a written report, no code changes yet):**
>
> Read `CLAUDE.md`, `README.md`, `QUICK_START.md`, the entire `src/` tree, `migrations/`, `portal/`, `docs/`, and `Workspace/`. Then deliver a report called `AUDIT_REPORT.md` at the repo root with these sections:
>
> 1. **Executive summary (10 lines max, plain English).** Overall health score out of 10 for each of: code quality, multi-tenant cleanliness, security, observability, test coverage, documentation, business analytics, growth readiness. One sentence each on why.
> 2. **Architecture map.** A diagram (Mermaid) of how a WhatsApp message flows from Meta → Fastify → conversation router → flows → services → external APIs → back to the user. Mark which parts are tenant-aware and which are not.
> 3. **Multi-tenancy review.** For every place in the code where client-specific logic lives (tone, products, prompts, Shopify store creds, flows, business hours, language/dialect), list it and rate how cleanly it's separated from core. Propose a single **Client Config Contract** — one object/schema per client — that defines: identity, vertical, language/dialect/tone, system prompt, product catalog source, integration credentials, flow overrides, business hours, escalation rules, pricing tier. Show how ARAB would be expressed in it.
> 4. **File-by-file health.** List every file over 300 lines with: what it does, what's mixed in that shouldn't be, and the proposed split. `src/services/shopify-agent.ts` at ~2,400 lines is priority 1 — dissect it.
> 5. **Security & tenant isolation.** Are tenants isolated in DB queries? Are secrets (WhatsApp tokens, Shopify keys, Claude keys) per-tenant or global? Any injection risk in prompts? Rate limiting per tenant? PII handling (Saudi PDPL compliance — this matters)? Logging leaking secrets?
> 6. **Reliability.** What happens if Claude API fails? WhatsApp webhook retries? Shopify is down? Redis is down? Are there retries, circuit breakers, dead-letter queues, idempotency keys on webhook handlers?
> 7. **Observability.** Can I answer "how many messages did ARAB's bot handle yesterday, how many led to a sale, what was the error rate"? If not, what's missing?
> 8. **Testing.** What's covered, what's not, where are the riskiest gaps.
> 9. **Documentation & onboarding.** If I hire a contractor tomorrow, can they ship? What's missing from `docs/`?
> 10. **Business intelligence gap analysis.** What should I be able to see that I can't today — per client revenue attributable to the bot, conversion funnel (message → cart → checkout → paid), cart abandonment recovery rate, response time P50/P95, containment rate (% resolved without human), top FAQs, churn signals. Propose a minimal analytics schema + a dashboard spec for the `portal/`.
> 11. **Strategic opportunities I may be missing.** Be blunt and proactive. Consider at minimum: upsell to existing clients (proactive WhatsApp marketing campaigns, abandoned-cart recovery, post-purchase NPS, review collection), new verticals adjacent to dates/clinics (restaurants, salons, real estate, tutoring, logistics — which fit the current engine best?), productized tiers (Starter/Pro/Enterprise with clear feature gates), a self-serve onboarding wizard so SMBs can sign up without you, Arabic-first prompt library as a moat, voice notes (WhatsApp voice is huge in KSA), integrations Saudi SMBs actually use (Salla, Zid, Foodics, HyperPay, Tabby, Tamara, Mada), Vision 2030 / SDAIA alignment angles, referral/affiliate program, compliance/PDPL as a paid "enterprise" feature, white-label for agencies. For each: what it is, effort (S/M/L), expected lift (why it makes money), and what needs to exist in the code first.
> 12. **Prioritized backlog.** A single ordered list of work items, each tagged `[Tech]` or `[Business]`, with effort and impact. Top 10 I should do in the next 30 days.
>
> ---
>
> **Phase 2 — Plan (after I read the audit):**
>
> I will tell you which items to take on. For each one you pick up:
> - Open a short plan in `Workspace/stages/` following the existing convention.
> - Get my confirmation on the plan before touching code.
>
> ---
>
> **Phase 3 — Execute:**
>
> For every change:
> - Work in a branch. One concern per commit.
> - Add/keep tests. Run `npm run typecheck`, tests, and lint before declaring done.
> - After each step, write a 3-line plain-English summary I can read: *what changed, why it's safer/better, what I should click or test to verify.*
> - If mid-flight you discover the plan is wrong, stop and tell me — don't silently pivot.
>
> ---
>
> **First concrete outputs I want from you right now:**
>
> 1. Confirm you've read `CLAUDE.md` and the repo layout.
> 2. Produce `AUDIT_REPORT.md` per Phase 1.
> 3. At the bottom of the report, give me a numbered menu like *"Reply with the numbers you want me to start on"* so I don't have to write technical instructions back to you.
>
> Be opinionated. If something in this repo is bad, say so. If something I'm doing as a business is leaving money on the table, say so. I'd rather hear the hard truth now than six months from now.

---

## How to use this prompt

Open the repo in VS Code with Claude, paste the prompt block above into a new conversation, and send it. Claude will read the code, write `AUDIT_REPORT.md` at the root of the repo, and wait for you to pick what to tackle first.

If you want a shorter version for quick follow-ups later, the operating rules (the 7 numbered rules at the top) are the most important part — they're what keep Claude from breaking your live bot.

## A few angles I'd flag specifically for your situation

You asked me to be proactive, so a few things stood out from a 30-second look at the repo that the prompt above will dig into, but that are worth naming now:

- **`shopify-agent.ts` at 2,430 lines is your biggest structural risk.** That file almost certainly mixes per-client product logic, generic agent orchestration, and Shopify API plumbing. Splitting it is what unlocks "add a new client cleanly."
- **A `clients/` folder with one file per tenant** (e.g. `clients/arab.ts` exporting a typed `ClientConfig`) is probably the single biggest organizational win. One place to set ARAB's tone, products, prompt, integrations — and the same shape for every future client.
- **Saudi-specific moats you may be under-using:** Salla and Zid (the two biggest KSA e-commerce platforms besides Shopify), Mada/Tabby/Tamara payment follow-ups, voice-note understanding in Gulf Arabic, and PDPL-compliant data handling as a paid enterprise feature. These are things international competitors won't do well — which is your defensible edge.
- **BI you almost certainly don't have yet:** revenue *attributable to the bot* per client per month. If you can show ARAB "the bot closed 42,000 SAR in sales this month," your renewal conversation changes completely.
- **Productize the tiers.** Starter/Pro/Enterprise with clear feature gates (e.g., voice notes = Pro, abandoned-cart automation = Pro, white-label = Enterprise) both raises ARPU and makes the upsell path legible to clients.

The prompt covers all of this and more, so Claude will surface them properly when it runs — but I wanted you to have the headline version here so you know what to look for when the audit lands.

[View the prompt file](computer:///sessions/gracious-magical-meitner/mnt/whatsapp-ai-saas/AUDIT_PROMPT.md)
