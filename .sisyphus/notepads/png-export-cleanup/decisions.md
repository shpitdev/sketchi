# Decisions - PNG Export Cleanup

## Architectural Choices
- Keep both `playwright` (for local) and `playwright-core` (for Browserbase)
- Keep `@browserbasehq/sdk` for Convex deployment
- Two exporters: local (chromium.launch) and remote (connectOverCDP)
