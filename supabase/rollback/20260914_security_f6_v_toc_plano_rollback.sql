-- ROLLBACK DE EMERGÊNCIA — F6 (public.v_toc_plano)
-- NÃO aplicar normalmente.
-- Serve exclusivamente para restaurar o estado anterior caso a migration
-- 20260914101500_security_f6_v_toc_plano.sql cause algum problema
-- inesperado. Reverte só o security_invoker (RESET, não um valor
-- arbitrário) e os grants — role a role, privilégio a privilégio,
-- conforme auditoria só de leitura de 2026-09-14
-- (information_schema.role_table_grants + pg_class.relacl/aclexplode),
-- reconfirmada antes desta correção:
--
--   - PUBLIC (pseudo-role): NENHUM privilégio (ausente das duas fontes) —
--     por isso este rollback NÃO concede nada a public;
--   - anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--     (sem MAINTAIN), nenhum grantable;
--   - authenticated: os mesmos 7 privilégios de anon, sem MAINTAIN,
--     nenhum grantable;
--   - service_role: os mesmos 7 privilégios, sem MAINTAIN, nenhum
--     grantable;
--   - postgres (dono): privilégios de dono, implícitos — não tocados pela
--     migration original nem por este rollback.
--
-- Nada na definição da view (SQL da query) é tocado, porque a migration
-- original também não a alterou.

begin;

alter view public.v_toc_plano
  reset (security_invoker);

grant delete, insert, references, select, trigger, truncate, update
  on public.v_toc_plano
  to anon, authenticated, service_role;

commit;
