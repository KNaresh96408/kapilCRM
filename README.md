# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## CRM inbound mail webhook setup

External incoming emails are ingested through the Cloud Function endpoint `mailInbound` and written into Firestore at `mailboxes/{uid}/messages`.

### Required cloud secret

Set a strong shared token for the inbound webhook:

- `MAIL_INBOUND_TOKEN`

The inbound provider must send this token using one of:

- `x-mail-inbound-token` header (recommended)
- `x-inbound-token` header
- `Authorization: Bearer <token>`
- `token` in query/body

### Provider mapping

Point your inbound provider webhook URL to:

- `https://<region>-<project>.cloudfunctions.net/mailInbound`

The endpoint accepts common payload fields (`from`, `to`, `subject`, `text`, `html`, `attachments`) and resolves internal recipients from `Users.email`.

### Reply behavior (bounce prevention)

Outbound mail now uses a virtual plus-alias reply address on top of `SMTP_USER`:

- format: `SMTP_USER+kpuid_<firebaseUid>@domain`

This allows replies to route through one real mailbox while preserving the target CRM user, so separate Google Workspace mailbox per user is not required.

Example: if `SMTP_USER` is `support@kapilpower.com`, replies go to addresses like `support+kpuid_abc123@kapilpower.com` and are mapped back to uid `abc123` during inbound ingestion.

> Note: `SMTP_USER` itself must be a real mailbox, and your inbound forwarding/webhook must preserve recipient `to` address.

## Forgot password (OTP) flow

The app now uses Cloud Functions for password reset:

- `passwordForgotRequest` → sends OTP details to admin mailbox `loan@kapilpower.com` (for manual user verification)
- `passwordForgotReset` → verifies OTP and updates Firebase Auth password

User flow: user enters email → clicks Send OTP → user contacts K Naresh (Admin) for OTP → user enters OTP + new password.

### Required secret

- `PASSWORD_OTP_SECRET` (long random string)

Example secret format: 32+ random characters.

### Reliability notes

- OTP validity: 10 minutes
- Request rate limit: 3 OTP requests per 15 minutes per email
- OTP attempts are limited and tracked server-side
