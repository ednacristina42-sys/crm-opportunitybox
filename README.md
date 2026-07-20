# crm-opportunitybox

Este repositório contém dois projetos distintos:

## 1. CRM atual (produção)

`ob-business-os-v2.html` — o CRM "OpportunityBox — Business OS" em produção, um
único ficheiro HTML servido via Netlify (ver `netlify.toml`). Este ficheiro **não é
tocado** pelo trabalho descrito abaixo. `projeto-modulo-orcamento/` é um projeto
companheiro existente, também fora do escopo abaixo.

## 2. Opportunity AI OS (fundação — Fase 1)

`opportunity-ai-os/` — a nova base do produto Opportunity AI OS, tratada desde o
início como produto de produção (não protótipo), seguindo estas prioridades:

1. publicação simples
2. segurança dos dados
3. estabilidade do Supabase
4. organização do GitHub
5. facilidade de exportação e continuidade fora de qualquer ferramenta de
   desenvolvimento temporária
6. rollback rápido em caso de problema

### Princípio fundamental

O **GitHub** é a fonte oficial do código. O **Supabase** da proprietária é a fonte
oficial dos dados, autenticação, storage e funções. Qualquer ferramenta de
desenvolvimento assistido por IA usada ao longo do projeto é apenas tooling
temporário — nada crítico depende exclusivamente dela.

### Estrutura desta fase

- **Stack**: React 18 + TypeScript (Vite), React Router, Supabase JS v2, Vitest +
  Testing Library, ESLint + Prettier.
- **Autenticação**: básica, via Supabase Auth (email/password), configurável só por
  variáveis de ambiente — nunca credenciais no código.
- **Health check**: rota `/health`, funciona mesmo sem Supabase configurado.
- **Migrations**: `supabase/migrations/` — estrutura e convenção prontas, sem
  migrations reais ainda (sem schema comercial na Fase 1).
- **CI**: `.github/workflows/ci.yml` — typecheck, lint, testes, build em cada PR.

Ver `opportunity-ai-os/README.md` (se existir) ou `docs/LOCAL_DEV.md` para arrancar
localmente, e `CONTRIBUTING.md` para a estratégia de branches e o checklist de
release.

### Ambientes

local → staging → produção. Ver `docs/STAGING.md`, `docs/PRODUCTION.md`,
`docs/ROLLBACK.md` e `docs/DISASTER_RECOVERY.md`.

### O que esta fase NÃO faz

- Não implementa módulos comerciais.
- Não migra dados reais.
- Não faz deploy em produção.
- Não altera o CRM atual nem o Supabase real.
