# Salonix Frontend Agent Rules

This file is the required entry point for every AI agent working in `salonix-frontend/`.

## Required Reading Order

1. Read the repository-wide [AGENTS.md](../AGENTS.md) for shared guardrails, response style, workflow, TypeScript baseline and project boundaries.
2. Read the frontend [architecture and engineering rule book](docs/FRONTEND_RULES.md) for Next.js-specific folders, components, routing, state, forms, styling, testing and dependencies.
3. When a frontend rule overlaps with a repository rule, apply both. The stricter rule wins and frontend-specific guidance only clarifies frontend implementation.

The frontend rule book is authoritative for Next.js decisions under this directory. It does not override repository guardrails or backend rules that do not apply to this frontend project.

## Frontend Architecture

Use a feature-based modular monolith. `features/<feature>/` owns feature UI, hooks, API calls, schemas and types. Shared UI and utilities belong only in their relevant shared folders. Do not create empty global folders for speculative architecture.

## Repository Guardrails

This file adds frontend-specific guidance only. It makes no exception to the root repository rules.

## Required Workflow

1. Read `docs/FRONTEND_RULES.md`.
2. Inspect the existing frontend files and package manifest before proposing changes.
3. Plan changes before implementation.
4. Request separate approval before executing commands or installs.
5. Keep every frontend change inside `salonix-frontend/` unless the user explicitly authorizes another location.
