-- Segurança — fechar RLS/grants da tabela de backup interno criada em
-- 12/09/2026 durante a atualização dos orçamentos 743–786
-- (public.ob_orcamentos_backup_20260912).
--
-- Auditoria só de leitura (2026-09-14) confirmou:
--   - a tabela existe e tem 11 registos (ORC-2026-001 + ORC-743..752-2026OB);
--   - RLS estava DESATIVADO (relrowsecurity = false), sem nenhuma policy;
--   - anon e authenticated tinham, por omissão do schema public, todos os
--     privilégios (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES)
--     — exatamente o "RLS Disabled in Public" (ERROR) assinalado pelo
--     Security Advisor;
--   - nenhuma FK, trigger, view ou função depende desta tabela — é só um
--     backup interno, sem uso pela aplicação.
--
-- Esta migration não apaga a tabela nem altera nenhum registo: só fecha o
-- acesso de anon/authenticated e ativa RLS sem policies (o que nega tudo a
-- quem não for dono/service_role), deixando o acesso restrito a
-- service_role.

begin;

alter table public.ob_orcamentos_backup_20260912
  enable row level security;

revoke all
  on table public.ob_orcamentos_backup_20260912
  from public, anon, authenticated;

grant all
  on table public.ob_orcamentos_backup_20260912
  to service_role;

commit;
