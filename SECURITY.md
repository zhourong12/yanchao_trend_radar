# Security

Shared or public deployments must set `REQUIRE_FEEDBACK_TOKEN=true` and a long random `FEEDBACK_API_TOKEN`, terminate TLS at a trusted reverse proxy, and restrict `CORS_ORIGINS`.

The built-in token is an MVP control for a trusted internal deployment. For multi-user production use, replace it with SSO/OIDC plus role-based authorization and move state to a managed database with backups.

Do not report credentials or sensitive business data in public issues. Rotate a token immediately if it is exposed.
