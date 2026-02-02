# Phase 7: Team Inbox, Roles & Collaboration

## Objective

Enable multi-user teams to collaborate on leads with roles, assignment, and inbox workflow.

## Goals

- Add team accounts and role-based permissions.
- Create shared inbox with assignments and SLA tracking.
- Log activity for accountability.

## Deliverables

### 1. Team Management

- Invite team members.
- Role types: Owner, Manager, Agent, Viewer.
- Permission matrix for API and portal.

### 2. Shared Inbox

- Lead assignment and ownership.
- SLA timers (first response, follow-up deadlines).
- Status changes and notes.

### 3. Collaboration

- Internal comments/notes on leads.
- Activity feed per lead.

## Data Model

- `team_members` (client_id, user_id, role, status)
- `lead_assignments` (lead_id, assigned_to, assigned_at)
- `lead_notes` (lead_id, author_id, note, created_at)

## API Endpoints (Proposed)

- `POST /api/clients/:clientId/team/invite`
- `GET /api/clients/:clientId/team`
- `POST /api/clients/:clientId/leads/:id/assign`
- `POST /api/clients/:clientId/leads/:id/notes`

## Portal Pages

- `/team`
- `/inbox`
- lead detail panel with assignments + notes

## Tests

- RBAC tests for route access.
- Assignment + notes integration tests.

## Risks

- Role enforcement consistency across routes.
- Data privacy between agents.
