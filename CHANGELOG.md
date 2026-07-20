# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Unreleased]

### Added

- Fundação do **Opportunity AI OS** (`opportunity-ai-os/`): app React 18 + TypeScript
  (Vite), autenticação básica via Supabase Auth (email/password), rota de health
  check, shell inicial protegido por sessão, testes automatizados (Vitest +
  Testing Library), lint (ESLint + Prettier).
- Estrutura `supabase/migrations/` com convenção de nomenclatura e regras de
  migration documentadas (sem migrations reais ainda).
- `supabase/config.toml` para desenvolvimento local com Supabase CLI.
- Workflow de CI (`.github/workflows/ci.yml`): typecheck, lint, testes e build,
  filtrado a `opportunity-ai-os/**` e `supabase/**`.
- Documentação: `README.md`, `CONTRIBUTING.md`, `docs/LOCAL_DEV.md`,
  `docs/STAGING.md`, `docs/PRODUCTION.md`, `docs/ROLLBACK.md`,
  `docs/DISASTER_RECOVERY.md`.
- `.gitignore` corrigido para deixar de ignorar silenciosamente o
  `package.json`/`package-lock.json` de subprojetos.

### Notes

- Nenhuma alteração ao CRM atual (`ob-business-os-v2.html`), ao `netlify.toml` ou
  a `projeto-modulo-orcamento/`.
- Nenhuma ligação ao Supabase real feita nesta fase.
