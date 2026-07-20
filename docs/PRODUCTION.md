# Produção

**Estado na Fase 1: nenhuma alteração feita.** O CRM atual (`ob-business-os-v2.html`,
publicado via Netlify) continua a ser o único sistema em produção. O Opportunity AI OS
não tem ainda deploy nenhum.

## Processo de publicação pretendido (futuro)

1. `git clone` do repositório.
2. Configurar `.env` de produção (nunca commitado; valores geridos na plataforma de deploy).
3. `npm install`
4. Correr migrations do Supabase (`supabase/migrations/`) — só depois de validadas em staging.
5. `npm run build`
6. Deploy do build (`dist/`) para a plataforma de hosting.
7. Smoke tests em produção.

## Regras

- Produção só é alterada depois de validação em staging.
- Nenhum deploy automático em produção sem aprovação humana explícita.
- Nenhuma credencial real (incluindo `service_role`) chega ao frontend ou ao repositório.
- Toda alteração de schema em produção segue o checklist obrigatório de release
  (ver `CONTRIBUTING.md`).

## Rollback

Ver `docs/ROLLBACK.md`.
