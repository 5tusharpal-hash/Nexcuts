NEXT.JS FRONTEND — AI AGENT RULES

PURPOSE
Build and maintain clean, scalable, production-ready Next.js frontends. Follow existing project conventions first. These are guidelines, not rigid rules. Never force a new architecture onto an existing project without a valid reason.

1. PROJECT INSPECTION
- Before making changes, inspect the project structure, package.json, dependencies, existing components, routes, API setup, styling and state management.
- Understand the existing coding patterns before writing code.
- Reuse existing libraries, utilities, components and conventions.
- Do not unnecessarily restructure the project or replace working implementations.
- If the project already has an established architecture, follow it.
- If starting a new project, use the recommended structure below.

2. RECOMMENDED FOLDER STRUCTURE

src/
  app/
    (auth)/
    (dashboard)/
    layout.tsx
    page.tsx
    loading.tsx
    error.tsx
    not-found.tsx
    globals.css

  components/
    ui/
    shared/
    layout/

  features/
    auth/
      components/
      hooks/
      services/
      schemas/
      types.ts
    users/
      components/
      hooks/
      services/
      schemas/
      types.ts

  hooks/
  lib/
    api/
    utils/
    constants/
    validations/
  store/
  types/

public/

For a frontend modular monolith, use `features/` as the vertical module boundary. Each feature owns its UI, hooks, API calls, schemas and types. Do not create global `services/`, global `config/`, feature duplicate folders or empty placeholder directories.

Only create a folder when it has actual production files. Route groups are optional and should exist only when they own real routes behind layouts.

Folder responsibilities:
- app/: Routes, layouts, route-level loading/error states and route-specific composition.
- components/ui/: Reusable base UI components such as Button, Input, Dialog, Dropdown and Table.
- components/shared/: Components reused across multiple features.
- components/layout/: Header, Sidebar, Navbar and application shells.
- components/forms/: Reusable form building blocks. Create this folder only when reusable form components exist.
- features/: Feature-specific components, hooks, API services, schemas and types. Features are the modules of the frontend modular monolith.
- hooks/: Truly global reusable React hooks only.
- lib/: Shared utilities, API client, helpers and validation utilities only.
- store/: Global client-side state management only when actual shared state exists.
- types/: Shared application-wide TypeScript types only when a type has no clearer feature owner.
- public/: Static assets.

Do not create global `services/` or `config/` folders. Keep feature-specific API calls in the owning feature. Keep shared API configuration in `lib/api/`; keep app environment handling in its owning configuration module only when needed.

This is a reference structure, not a mandatory structure. Adapt it to the project size and existing conventions. Do not create empty folders or unnecessary abstraction layers.

3. FILE PLACEMENT RULES
- Put files in the folder that owns their responsibility.
- Route-specific UI belongs near its route or feature.
- Feature-specific components and logic belong inside that feature.
- Globally reusable components belong in components/.
- Reusable hooks belong in hooks/; feature-specific hooks belong in the feature.
- Shared API configuration belongs in lib/api/.
- Feature-specific API calls belong in that feature's services/.
- Shared types belong in types/; feature-specific types stay with the feature.
- Avoid duplicate components, utilities, types and API clients.
- Do not create random files in the root directory.
- Avoid unnecessarily deep folder nesting.
- Use clear, consistent and descriptive file names.

4. NEXT.JS APP ROUTER
- Use the App Router and follow Next.js routing conventions.
- Use page.tsx for route pages and layout.tsx for shared layouts.
- Use loading.tsx for loading UI, error.tsx for route-level errors and not-found.tsx for not-found states.
- Use route groups when they improve organization without changing URLs.
- Use dynamic routes only when required.
- Keep page components focused on composing the page, not implementing all business logic.
- Use route handlers for backend endpoints when appropriate.
- Do not create unnecessary API routes when an existing backend API can be called directly from the appropriate server-side layer.
- Follow the installed Next.js version and its documentation. Do not assume APIs from another version.

5. SERVER AND CLIENT COMPONENTS
- Server Components are the default in the App Router.
- Use Server Components for data fetching, server-side operations and static or non-interactive UI.
- Use Client Components only when browser APIs, event handlers, React state, effects or interactive client-side libraries are needed.
- Add use client only at the component boundary that actually needs it.
- Keep Client Components small and isolated.
- Do not convert an entire page or layout into a Client Component just because one small section needs interactivity.
- Pass serializable data from Server Components to Client Components.
- Never expose secrets, private environment variables or server-only logic to Client Components.
- Do not use hooks or browser APIs inside Server Components.
- Avoid unnecessary client-side fetching when data can be fetched on the server.

6. COMPONENT DESIGN
- Build small, focused and reusable components.
- Keep components responsible for one clear task.
- Separate UI from business logic when it improves maintainability.
- Reuse existing design-system components before creating new ones.
- Avoid giant components containing unrelated UI and logic.
- Avoid unnecessary abstraction for components used only once.
- Keep props properly typed.
- Use composition instead of creating components with excessive boolean props.
- Keep feature-specific components inside their feature.
- Do not duplicate the same UI implementation across pages.

7. UI AND DESIGN SYSTEM
- Inspect existing colors, typography, spacing, borders, radius, shadows and component styles before changing UI.
- Maintain consistent design across the application.
- Reuse design tokens and CSS variables.
- Prefer the existing styling approach, whether Tailwind, CSS Modules or another established system.
- Do not introduce another styling library without a clear reason.
- Use consistent spacing and responsive layouts.
- Avoid unnecessary inline styles and arbitrary values.
- Use Lucide or the project's existing icon library consistently.
- Do not use emojis as substitutes for interface icons.
- Use proper loading, empty, success and error states.
- Avoid excessive animations, gradients, shadows and decorative elements.
- Keep interfaces clean, readable and suitable for real-world use.

8. STATE MANAGEMENT
- Use local React state for component-specific state.
- Use Context for small shared state when appropriate.
- Use Zustand for simple-to-moderate global client state when already adopted or suitable.
- Use Redux Toolkit when the application has complex shared state, predictable workflows or established Redux architecture.
- Do not introduce global state for data that can remain local.
- Do not store server data unnecessarily in global client state.
- Use URL search parameters for shareable filters, pagination and navigation state when appropriate.
- Avoid duplicating the same state in multiple places.
- Follow the existing state management solution instead of mixing libraries unnecessarily.

9. DATA FETCHING AND API
- Centralize API configuration and common request handling.
- Reuse the existing API client.
- Keep API calls out of presentational components.
- Use Server Components for suitable server-side data fetching.
- Use React Query or the existing data-fetching library for client-side server state when appropriate.
- Handle loading, errors, empty responses and unexpected responses.
- Avoid duplicate requests and unnecessary refetching.
- Use pagination for large datasets.
- Do not hardcode API URLs throughout the application.
- Use environment variables for configuration.
- Never expose secret keys or private backend credentials in frontend code.
- Validate and handle API response data safely.
- Do not fabricate API responses or silently hide API failures.

10. FORMS AND VALIDATION
- Use the project's existing form library.
- Prefer React Hook Form with Zod when suitable and already available.
- Keep validation schemas reusable and organized.
- Validate user input on the client for usability.
- Never rely only on frontend validation for security; the backend must validate independently.
- Show clear field-level validation messages.
- Prevent duplicate submissions.
- Provide loading and success/error feedback.
- Preserve user input when a submission fails where appropriate.
- Use correct input types, labels and autocomplete attributes.

11. AUTHENTICATION AND SECURITY
- Follow the existing authentication architecture.
- Keep authentication and authorization separate.
- Do not rely on frontend route protection as the only security layer.
- Enforce permissions and authorization on the server/backend.
- Never expose access tokens, secrets or private environment variables unnecessarily.
- Avoid storing sensitive tokens in insecure browser storage.
- Handle expired sessions and unauthorized responses properly.
- Do not trust user-provided IDs, roles or permissions.
- Sanitize or safely render untrusted content.
- Avoid dangerouslySetInnerHTML unless absolutely necessary and safely sanitized.
- Never log passwords, tokens or sensitive user data.

12. TYPESCRIPT RULES
- Use TypeScript throughout the application.
- Define proper types and interfaces for props, API responses and application data.
- Avoid any; use unknown when the type is genuinely unknown.
- Avoid unnecessary type assertions and non-null assertions.
- Reuse shared types instead of duplicating definitions.
- Keep types close to the feature that owns them.
- Prefer explicit, meaningful names.
- Do not suppress TypeScript errors just to make the build pass.
- Fix the underlying type issue.

13. PERFORMANCE
- Keep client-side JavaScript minimal.
- Avoid unnecessary Client Components and useEffect calls.
- Use dynamic imports for genuinely heavy components when useful.
- Optimize images with Next.js Image where appropriate.
- Use appropriate image sizes and avoid unnecessarily large assets.
- Avoid unnecessary re-renders and expensive calculations.
- Use memoization only when it provides a real benefit.
- Use pagination or virtualization for large lists when necessary.
- Choose appropriate caching and revalidation strategies.
- Avoid fetching the same data repeatedly.
- Do not sacrifice maintainability for premature optimization.

14. ACCESSIBILITY AND RESPONSIVENESS
- Use semantic HTML elements.
- Ensure forms have proper labels.
- Make interactive elements keyboard accessible.
- Provide visible focus states.
- Use appropriate ARIA attributes when native HTML is insufficient.
- Maintain sufficient color contrast.
- Do not communicate status using color alone.
- Support mobile, tablet and desktop layouts.
- Avoid fixed widths that break smaller screens.
- Ensure dialogs, menus and forms work on touch devices.
- Test important layouts at different screen sizes.

15. ERROR HANDLING AND USER FEEDBACK
- Handle expected failures explicitly.
- Use route-level error boundaries where appropriate.
- Show meaningful messages to users without exposing internal errors.
- Log useful debugging information on the server where appropriate.
- Include loading, empty, error and success states.
- Avoid silent catch blocks.
- Do not show fake success messages when an operation fails.

16. TESTING AND CODE QUALITY
- Follow the existing testing framework.
- Test important business logic and critical user flows.
- Test form validation and error states.
- Run the project's lint, typecheck, tests and build commands when possible.
- Fix issues introduced by your changes.
- Do not modify unrelated files to silence errors.
- Remove unused imports, dead code and temporary debugging statements.
- Keep code formatted consistently with the project.
- Do not claim that tests or builds passed unless they were actually executed successfully.

17. DEPENDENCIES AND CONFIGURATION
- Check existing dependencies before installing anything.
- Do not install a package for functionality that can be handled cleanly with existing tools.
- Avoid duplicate libraries serving the same purpose.
- Do not update major dependency versions without a reason.
- Follow the existing package manager and lockfile.
- Never commit secrets or real environment files.
- Update environment examples when new variables are introduced.
- Do not overwrite existing configuration without understanding its purpose.

18. AGENT WORKFLOW — MANDATORY
Before implementation:
- Inspect the relevant folders and files.
- Understand the current architecture and conventions.
- Identify reusable components, utilities and existing implementations.
- Understand the requested behavior and affected areas.
- Check whether the required backend/API functionality already exists.

During implementation:
- Make the smallest complete change that solves the requirement.
- Put every new file in its correct ownership folder.
- Follow existing naming, styling and coding conventions.
- Reuse existing components and dependencies.
- Keep unrelated code untouched.
- Do not invent APIs, fields, database properties or business rules.
- Ask for clarification when an important requirement or contract is missing.
- Do not create unnecessary folders, duplicate implementations or speculative features.

After implementation:
- Review all modified files.
- Check imports, types, responsiveness and error handling.
- Run relevant lint, typecheck, tests and build commands.
- Fix issues caused by the implementation.
- Summarize what changed, which files were added or modified, and what verification was performed.
- Clearly mention anything that could not be verified.

19. NAMING CONVENTIONS

Follow consistent naming conventions across the entire project. First inspect existing conventions and follow them. Do not introduce a different naming style without a valid reason.

- Components: PascalCase (`UserProfile.tsx`, `DashboardHeader.tsx`).
- Component folders: kebab-case or follow the existing project convention (`user-profile/`).
- Pages and Next.js special files: Follow Next.js required filenames (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`).
- Hooks: camelCase with the `use` prefix (`useAuth.ts`, `useDebounce.ts`).
- Functions and methods: camelCase (`getUserById`, `handleSubmit`).
- Variables: camelCase (`userName`, `isLoading`).
- Constants: UPPER_SNAKE_CASE for true global constants (`API_BASE_URL`, `MAX_RETRY_COUNT`). Local constants should use camelCase.
- Types and interfaces: PascalCase (`User`, `UserProfile`, `ApiResponse`).
- Enums: PascalCase for enum names; members should follow the project's established convention.
- Custom errors: PascalCase with an `Error` suffix (`AuthenticationError`).
- Utility files: kebab-case (`format-date.ts`, `calculate-total.ts`).
- Service files: kebab-case with a clear purpose (`user-service.ts`, `auth-service.ts`).
- Schema files: kebab-case with a schema suffix where useful (`user-schema.ts`).
- Test files: Follow the testing framework convention (`user-profile.test.tsx`, `auth.spec.ts`).
- CSS Modules: `ComponentName.module.css` or follow the existing convention.
- Environment variables: UPPER_SNAKE_CASE (`NEXT_PUBLIC_API_URL`, `DATABASE_URL`). Only expose variables with `NEXT_PUBLIC_` when they are intentionally public.
- Boolean variables: Use meaningful prefixes such as `is`, `has`, `can` or `should` (`isActive`, `hasPermission`, `canEdit`).
- Event handlers: Use the `handle` prefix inside components (`handleClick`, `handleSubmit`). Callback props may use the `on` prefix (`onClick`, `onSubmit`).
- Avoid vague names such as `data`, `item`, `temp`, `obj`, or `value` when a more descriptive name is possible.
- Use full, meaningful words. Avoid unnecessary abbreviations.
- Use consistent singular/plural naming (`user` vs `users`) according to the data being represented.
- Keep names descriptive but concise.
- Avoid unnecessary prefixes, suffixes and redundant words.
- Do not rename existing files or exports unnecessarily.
- Follow the existing project naming convention whenever it differs from these recommendations.

Route groups in Next.js App Router use parentheses, such as `(auth)` and `(dashboard)`, to group routes behind shared layouts without adding that name to the URL. Example: `(auth)/login/page.tsx` is available at `/login`.

A normal folder name such as `auth/` also works, but it becomes part of the URL. Example: `auth/login/page.tsx` is available at `/auth/login`. Use parentheses only when grouping is needed and the URL segment must be omitted. Do not create empty route-group folders without a real layout or route that owns them.

Examples:

```text
UserProfile.tsx
useAuth.ts
user-service.ts
user-schema.ts
format-date.ts
UserRole
isAuthenticated
handleSubmit
API_BASE_URL
```

FINAL PRINCIPLE
Understand the project before changing it. Follow its existing architecture. Keep code organized, reusable, secure, maintainable and production-ready. Use the recommended structure only when appropriate. Every file must have a clear purpose and a correct place. Prefer simple, reliable solutions over unnecessary complexity.