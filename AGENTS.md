# AGENTS.md

This is the canonical source of truth for all AI agents (Claude Code, Cursor, Copilot, Codex, Antigravity, Replit, etc.) working on this project.

## 🛑 NON-NEGOTIABLE GUARDRAILS (STRICT ENFORCEMENT)
These rules are absolute. They override all other instructions and tool defaults. Failure to adhere is a critical failure.

1. **No Execution without Permission**: Do not run commands, scripts, tests, builds, applications, installers, or any executable operations without explicit authorization.
2. **No Git/GitHub without Permission**: Never run any Git command (including `git status`, `git diff`) or modify repositories via APIs without explicit authorization for that specific action. The user manages the final Git state.
3. **No Database Access**: No connecting to, querying, or modifying any database without explicit permission. Destructive operations are strictly prohibited.
4. **No Deletion**: Never delete files, folders, records, or resources. No cleanup, truncation, or destructive replacements. This cannot be overridden by plan approval.
5. **Project Boundary**: Do not access anything outside `E:\Tushar\Salonix` without explicit permission.
6. **No Implementation before Approval**: 
   - Step 1: Safe read-only inspection.
   - Step 2: Written implementation plan $\rightarrow$ Wait for approval.
   - Step 3: Wait for separate, explicit instruction to execute.
   - Never make changes before both conditions are satisfied.


---

## 1. Language & Response Style
### Language Split
| Where | Language |
|---|---|
| Chat replies to the user | Hinglish (Hindi + English mix) |
| Repo files, docs, code, comments, commits | English only |

### Response Style
| Rule | Meaning |
|---|---|
| No over-explain | Get to the point. Skip extra background. |
| Simple words | Use easy words. Avoid heavy jargon. |
| Hinglish in chat | Chat replies use a Hindi + English mix. |
| English in the repo | Every file in the repo stays in English. |
| No long paragraphs | Break the answer into short pieces. |
| Points and tables | Use bullets or tables. |
| Proper spacing | Leave space between lines. Do not pack text together. |
| Crisp | Say only what is needed. |
| No em-dashes | Do not use an em-dash. Use a comma or a period. |

## 2. Repository Understanding & Context
- Before making changes, agents must read `AGENTS.md` and any relevant `CLAUDE.md`.
- Understand the requested outcome, constraints, and scope before proposing a solution.
- Inspect existing patterns and dependencies to ensure consistency.

## 3. Requirement Handling & Ambiguity
- Handle ambiguity by asking clarifying questions before implementation.
- If a requirement is unclear, provide 2-3 concise options and ask for a decision.

## 4. Code Quality & Consistency
- Prioritize readability, maintainability, and consistency over cleverness.
- Follow existing naming conventions and architectural patterns.
- Implement the smallest coherent solution that solves the problem.

## 5. Validation & Review
- Run relevant tests only when explicitly authorized.
- Review the final diff for regressions or mistakes.
- Never claim to have run a check that was not actually executed.

## 6. Git Hygiene & Communication
- Report exactly what changed, what was tested, and any remaining unresolved issues.
- Communicate completions concisely.

## 7. Consistent Development Workflow
1. **Read**: Inspect `AGENTS.md` and codebase.
2. **Understand**: Define goal, constraints, and scope.
3. **Analyze**: Examine existing patterns.
4. **Plan**: Outline changes $\rightarrow$ Wait for approval.
5. **Implement**: Execute only upon separate explicit go-ahead.
6. **Validate**: Run authorized tests.
7. **Review**: Audit the diff.
8. **Report**: Summarize results.

## 9. API Engineering Standards (Golden Rules)
Strict adherence to these standards is required for every endpoint created.

### 9.1 Endpoint Structure
- **Strict CRUD Separation**: Each operation must have its own endpoint.
  - `POST /resource` $\rightarrow$ Create
  - `GET /resource/:id` $\rightarrow$ Read (Single)
  - `GET /resource` $\rightarrow$ Read (List/Filter/Paginate)
  - `PUT /resource/:id` $\rightarrow$ Update (Full)
  - `PATCH /resource/:id` $\rightarrow$ Update (Partial)
  - `DELETE /resource/:id` $\rightarrow$ Delete
- **Naming**: Use nouns in kebab-case (e.g., `/inventory-items`). No verbs in URLs.
- **Bulk APIs**: Use `/bulk` suffixes for operations affecting multiple records to prevent N+1 issues.

### 9.2 Contracts & Validation
- **Interface First**: Every API must define a `Request` and `Response` interface in the module's `.types.ts` file.
- **Input Validation**: Validate all `req.body` and `req.params` before passing them to the service layer.
- **Consistent Response Envelope**: 
  ```typescript
  { 
    success: boolean; 
    data?: T; 
    error?: { message: string; code: string }; 
  }
  ```

### 9.3 Implementation Logic
- **The Necessity Filter**: Build only what is required by the business logic. Do not create "placeholder" APIs.
- **Thin Controllers**: Controllers only handle request/response. All business logic MUST reside in the Service layer.
- **Repository Pattern**: All database queries must be inside the Repository. Services must not call Prisma directly.
- **Error Handling**: Use the `ApiError` class from `src/shared/errors`. Return precise HTTP status codes.

### 9.4 Performance & Scale
- **Pagination**: All "List" APIs must support `limit` and `offset` by default.
- **Selective Fetching**: Do not return `SELECT *`. Only return fields required by the UI.

### 9.5 Versioning & Platform Strategy
- **URI Versioning**: All APIs must be prefixed with a version (e.g., `/api/v1/...`).
- **Breaking Changes**: Any change that breaks existing clients MUST increment the version (v1 $\rightarrow$ v2).
- **Platform Adaptation**: Use a `fields` query parameter for selective fetching to support Mobile vs. Web bandwidth needs.
- **Client Identification**: Expect `X-Client-Platform` header to identify the request source.
- **Deprecation**: Use `Warning` headers to notify clients of upcoming version removals.

### Folder Definitions
| Folder | Purpose | Rule |
|---|---|---|
| `src/modules/{module_name}` | **Feature Modules** | Contains all logic for a specific feature (e.g., `auth`, `queue`). Must include its own controller, service, repository, and routes. |
| `src/shared` | **Cross-Cutting Concerns** | Logic used by multiple modules. Examples: `errors` (ApiError), `middlewares` (errorHandler), `types`, `utils`. |
| `src/database` | **DB Infrastructure** | Migration scripts, seeds, and the database connection pool. |
| `src/bootstrap` | **App Startup** | Initializers needed at start. Example: `logger`, `cors`, `helmet`, `db.connect`. |
| `src/config` | **Environment Config** | Environment variable validation and app-wide constants. |
| `src/integrations` | **Third-Party Services** | Wrappers for external APIs (e.g., WhatsApp, Meta, Redis, Elasticsearch). |

### Implementation Rules
- **Modular Encapsulation**: A module must be self-contained. If `auth.service` needs `user.repository`, it must import from the same module folder.
- **No Leakage**: Do not create global `controllers/`, `services/`, or `types/` folders. Put them in the respective module or `src/shared`.
- **Strict Flow**: Request $\rightarrow$ Route $\rightarrow$ Controller $\rightarrow$ Service $\rightarrow$ Repository $\rightarrow$ DB.
- **Typescript Only**: Never commit `.js`, `.js.map`, or `.d.ts` files to the repository.
