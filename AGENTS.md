# Cobrix — Agent Instructions

## 1. Project objective

Implement Cobrix as a reliable application for importing ISP customers and invoices, reconciling payments, and displaying synchronization results.

Correctness of business rules, data integrity, idempotency, and acceptance tests take priority over UI polish.

## 2. Mandatory workflow

Before making changes:
- Read the relevant acceptance criteria and existing tests.
- Inspect the existing implementation and follow established project conventions.
- Identify the files that need to change and explain the intended approach.
- Do not assume requirements based on previous AI-generated analyses without checking the original documentation.

While implementing:
- Work on one coherent task at a time.
- Prefer small, reviewable changes.
- Avoid unrelated refactoring.
- Do not overwrite working functionality without a concrete reason.
- Do not add dependencies unless necessary and explicitly justified.
- Do not run destructive commands or reset databases without explicit authorization.

After implementing:
- Run the relevant tests and existing environment tests.
- Report the actual commands executed and their results.
- Identify any untested behavior or unresolved issues.
- Review the final diff for unintended modifications.

Never claim that a test, feature, or acceptance criterion passes unless it has been verified.

## 3. Protected files and boundaries

Do not modify:
- `src/billing-api/**`
- `data/billing-api.sqlite`
- `docs/**`
- Existing acceptance criteria or supplied API specifications.

These files represent the external ISP system and the original technical requirements.

Cobrix must communicate with the ISP exclusively through its HTTP API. Never import its internal modules or access its SQLite database directly.

If a protected file appears to require modification, stop and explain why before proceeding.

## 4. Technical constraints

- Follow the Node.js version and TypeScript configuration declared by the repository.
- Prefer built-in Node.js APIs and existing dependencies.
- Use the native SQLite implementation if compatible with the actual environment and requirements.
- Preserve existing startup commands, API contracts, and test conventions.
- Keep business logic separate from HTTP controllers and HTML rendering.
- Use typed interfaces and explicit domain models where appropriate.
- Store monetary values as integer minor units (cents) when representing USD amounts, with explicit and consistent conversion at API boundaries.
- Use the existing date utilities for civil dates and the `America/Caracas` timezone. Do not replace them with inconsistent local-time calculations.

## 5. TypeScript strict typing

- Do not use `any` or `unknown` anywhere in the implementation or tests, including explicit annotations, type assertions, generic parameters, or intermediate variables.
- Every variable, function parameter, return value, object, API response, database row, and external input must have a precise, explicit type whenever its type cannot be safely inferred.
- Define dedicated interfaces, type aliases, discriminated unions, and type guards for domain models and external data.
- Treat HTTP responses, JSON payloads, database results, and user input as external boundaries. Validate their structure before using their values, using typed validation functions that do not rely on `any` or `unknown`.
- Do not use unsafe type assertions (`as SomeType`) to bypass validation or silence TypeScript errors. Type assertions are acceptable only when justified by a verified invariant and cannot be used to conceal an uncertain type.
- Do not use `@ts-ignore`, `@ts-nocheck`, or similar directives to bypass type checking.
- Prefer `strict` TypeScript patterns and preserve the existing compiler settings, including `noUncheckedIndexedAccess`.
- When a value cannot be represented safely with the available types, stop and define an appropriate type or validation strategy instead of weakening the typing.
- After implementation, review changed files for prohibited types and run the project's relevant tests and type checks where available.

## 6. Business rules and data integrity

- Treat the original acceptance criteria as the source of truth.
- Normalize customer identification consistently before grouping customers.
- Do not guess when external API data is contradictory or invalid.
- Discard rows that explicitly represent no debt.
- Validate currency and residual balances using the documented business rules.
- Make invoice imports idempotent using an appropriate database uniqueness constraint and transaction-safe logic.
- Never mark an invoice as paid without the required evidence of a real payment.
- Distinguish full payments, partial payments, exemptions, and missing evidence.
- Respect configured import filters, date windows, and per-run limits.
- Simulation mode must report intended changes without modifying business records.
- Record meaningful synchronization outcomes and errors for auditing.
- Do not silently swallow errors or convert unknown states into successful results.

Do not invent thresholds, identifiers, expected totals, or state transitions. Verify them against the original requirements.

## 7. Persistence and transactions

- Keep Cobrix persistence separate from the ISP simulator.
- Enforce primary keys, foreign keys, and appropriate unique constraints.
- Use transactions for operations that must succeed or fail atomically.
- Avoid partially importing an invoice or updating related balances inconsistently.
- Never store credentials or access tokens in logs.
- Ensure retries cannot create duplicate customers, invoices, or payment events.

## 8. Testing strategy

Add tests incrementally for:
- Identification normalization.
- Currency inconsistency and residual balances.
- Filtering and date boundaries.
- Duplicate invoices and repeated imports.
- Simulation without business-data mutations.
- Full payment, partial payment, exemption, and missing evidence.
- Transaction failures and inconsistent API responses.
- The complete acceptance workflow.

Preserve all supplied tests. Do not weaken assertions or alter the expected results merely to make the implementation pass.

Use the actual expected totals and scenarios documented in the original acceptance criteria.

## 9. Scope control

Implement the smallest complete solution that satisfies the requirements.

Do not introduce unnecessary frameworks, services, background infrastructure, or abstractions.

Do not start the next implementation phase until the current phase has been tested and its results reviewed.

## 10. Required completion report

For every implementation task, report:
1. What was implemented.
2. Which files were created or modified.
3. Which business rules were addressed.
4. Which tests were executed and their actual results.
5. Any known limitations or outstanding issues.
6. Confirmation that protected files were not modified, based on inspection of the actual diff.
