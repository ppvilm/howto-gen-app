# howto-web

React + Vite + Tailwind 3 frontend for the HowTo GraphQL server. Includes Apollo Client and GraphQL Code Generator for typed hooks.

## Setup

1. Copy envs

cp .env.example .env

2. Install deps

npm install --workspace=howto-web

3. Generate GraphQL types/hooks (requires the server schema at `../howto-server/graphql/schema.graphql`)

npm run codegen --workspace=howto-web

4. Start dev server

npm run dev --workspace=howto-web

Open http://localhost:5173 and login or sign up.

## Notes
- Auth: stores JWT in `localStorage` under `howto_token` and sends `Authorization: Bearer <token>`.
- Configure GraphQL endpoint via `VITE_GRAPHQL_URL` (default `http://localhost:4000/graphql`).
- Operations live in `src/graphql/operations.graphql`; generated hooks output to `src/generated/graphql.ts`.

