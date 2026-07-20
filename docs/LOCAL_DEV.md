# Desenvolvimento local — Opportunity AI OS

## Pré-requisitos

- Node.js 20+
- npm 10+
- (Opcional, para trabalhar em migrations) [Supabase CLI](https://supabase.com/docs/guides/cli)

## Passos

```bash
git clone https://github.com/ednacristina42-sys/crm-opportunitybox.git
cd crm-opportunitybox/opportunity-ai-os

cp .env.example .env
# edite .env e preencha VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
# com os valores de um projeto Supabase de DESENVOLVIMENTO/STAGING — nunca produção.

npm install
npm run dev
```

A app fica disponível em `http://localhost:5173`.

- `/login` — formulário de autenticação (Supabase Auth, email/password)
- `/health` — health check (mostra ambiente e se o Supabase está configurado)
- `/` — shell inicial, protegido por sessão

## Comandos úteis

```bash
npm run typecheck   # tsc --noEmit
npm run lint         # ESLint
npm run test         # Vitest
npm run build        # build de produção (Vite)
```

## Base de dados local (opcional, Fase 2+)

```bash
supabase start        # sobe Postgres/Auth/Storage/Studio local
supabase db reset      # aplica as migrations em supabase/migrations/
```

Nunca aponte o `.env` local para o projeto Supabase de produção da proprietária.
