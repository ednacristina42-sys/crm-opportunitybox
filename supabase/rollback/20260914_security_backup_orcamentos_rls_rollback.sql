-- ROLLBACK DE EMERGÊNCIA — segurança da tabela de backup
-- public.ob_orcamentos_backup_20260912
-- NÃO aplicar normalmente.
-- Serve exclusivamente para restaurar o estado anterior caso a migration
-- 20260914093000_security_backup_orcamentos_rls.sql cause algum problema
-- inesperado. Restaura exatamente o estado apurado na auditoria de
-- 2026-09-14 (antes da migration): RLS desativado e os mesmos privilégios
-- de anon/authenticated/public. Não apaga a tabela nem altera registos.

begin;

alter table public.ob_orcamentos_backup_20260912
  disable row level security;

grant all
  on table public.ob_orcamentos_backup_20260912
  to public, anon, authenticated;

commit;
