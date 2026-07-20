# Contribuir

Este repositório trata o **Opportunity AI OS** como produto de produção. O GitHub é a
fonte oficial do código; o Supabase da proprietária é a fonte oficial de dados,
autenticação, storage e funções. Nenhuma ferramenta de desenvolvimento temporária
(Emergent, Claude Code, etc.) deve ser uma dependência crítica do sistema.

## Estratégia de branches

- `main` — produção, protegida. Nenhum commit direto.
- `develop` — integração e staging.
- `feature/nome-da-funcionalidade` — novas funcionalidades.
- `fix/nome-da-correcao` — correções.
- `migration/nome-da-migracao` — alterações ao schema do Supabase.

## Regras

- Toda alteração passa por pull request — nunca commit direto em `main`.
- Commits pequenos e descritivos.
- Cada PR deve indicar: o que muda, riscos, testes feitos, forma de rollback.
- Tags de versão para releases.
- Manter `CHANGELOG.md` atualizado (formato Keep a Changelog).
- Nunca reescrever o histórico de `main`; nunca force-push em branches protegidas.

## Migrations do Supabase

Ver `supabase/migrations/README.md`. Toda alteração de schema é um ficheiro de
migration versionado — nunca SQL manual direto na base de dados.

## Checklist obrigatório antes de cada release

- [ ] Build concluído
- [ ] TypeScript sem erros (`npm run typecheck`)
- [ ] Lint concluído (`npm run lint`)
- [ ] Testes unitários (`npm run test`)
- [ ] Testes de integração (quando aplicável)
- [ ] Testes de RLS (quando existirem tabelas com RLS)
- [ ] Migrations testadas em staging
- [ ] Backup confirmado (quando a migration afeta dados/estrutura existente)
- [ ] Variáveis de ambiente confirmadas (`.env.example` atualizado, nada hardcoded)
- [ ] Nenhuma credencial no código
- [ ] Smoke test em staging
- [ ] Plano de rollback documentado no PR
- [ ] Aprovação humana

## Ambientes

- **local** — máquina do programador, `.env` próprio, nunca aponta para produção.
- **staging** — integração/validação, ver `docs/STAGING.md`.
- **produção** — ver `docs/PRODUCTION.md`. Só alterada após validação em staging e
  aprovação humana.
