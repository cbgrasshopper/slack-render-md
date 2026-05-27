# Recommendation: Separation of Concerns via Controller/Service Pattern

## Overview
The current architecture of the project, while highly functional and well-tested, suffers from a "God Module" pattern in `main.ts`. As the application grows, the density of responsibilities within this single file will increase cognitive load and make maintenance more difficult.

## Current State: The "God Module" Problem
`main.ts` currently manages several distinct architectural layers:
1.  **Network/Routing Layer:** Handling HTTP requests and defining endpoints (e.g., `/render/:id`, `/home`).
2.  **Security Layer:** Implementing Slack-specific request signature verification (`verifySlackRequest`).
3.  **Data Persistence Layer:** Managing the complex logic for Deno KV storage, including chunking large payloads (>64KB) and managing TTLs.
4.  **Business/Orchestration Layer:** Parsing Slack payloads, identifying `.md` files, and coordinating between the `renderer.ts` and `slack-api.ts`.
5.  **Authentication/OAuth Layer:** Managing the OAuth v2 installation and callback lifecycle.

## Proposed Improvement: Controller/Service Refactoring
I recommend refactoring the codebase to adopt a structured **Controller/Service pattern**. This involves moving logic out of `main.ts` and into specialized, testable modules.

### Target Architecture

#### 1. `StorageService` (The Persistence Layer)
*   **Responsibility:** Encapsulate all Deno KV operations.
*   **Logic to move:** `storeRenderContent`, `loadRenderContent`, and the complex chunking/manifest logic.
*   **Benefit:** Allows for future migrations (e.g., moving to S3 or PostgreSQL) without touching the HTTP or Slack logic.

#### 2. `SlackEventHandler` (The Business Logic Layer)
*   **Responsibility:** Process incoming Slack events and payloads.
*   **Logic to move:** `findMdFiles`, `isMd`, `extractUserAndChannelIds`, and payload-driven orchestration like `handleFileAction`.
*   **Benefit:** Simplifies the testing of event-driven logic by isolating it from the HTTP request/response cycle.

#### 3. `AuthController` (The Identity Layer)
*   **Responsibility:** Manage the OAuth lifecycle and user session validation.
*   **Logic to move:** `handleOAuthInstall`, `handleOAuthCallback`, and `getAuthForUser`.
*   **Benefit:** Separates security/auth concerns from general application features.

#### 4. `main.ts` (The Orchestrator)
*   **Respons responsibility:** Act as a thin entry point.
*   **Logic to keep:** HTTP server initialization, high-level route definitions, and delegating requests to the appropriate Service or Controller.

## Expected Benefits
*   **Enhanced Testability:** Enables true unit testing of business logic (e.g., testing `SlackEventHandler` without mocking a full Deno `Request` object).
*   **Reduced Cognitive Load:** Developers can navigate the codebase by feature rather than searching through a single large file.
*   **Scalability:** New features (like a "Delete" command or "User Dashboard") can be added as new Services/Controllers with minimal impact on existing code.
*   **Improved Maintainability:** Changes to storage technology or authentication providers are isolated to their respective modules, reducing the risk of regression in unrelated areas.
