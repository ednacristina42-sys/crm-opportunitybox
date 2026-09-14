-- ============================================================
-- Rollback de 20260914150000_ob_crm_atividades_canonico.sql
-- Remove só a tabela nova (public.ob_crm_atividades) e as suas
-- policies/índices associados. NÃO toca em public.ob_crm_dados --
-- a chave 'ob-crm-atividades' (blob original) nunca foi alterada por
-- esta migração, por isso não há nada a restaurar nela.
-- Isolado: nenhuma FK de fora aponta para ob_crm_atividades.
-- ============================================================

drop policy if exists ob_crm_atividades_select on public.ob_crm_atividades;

drop index if exists public.ob_crm_atividades_owner_idx;
drop index if exists public.ob_crm_atividades_orc_num_idx;
drop index if exists public.ob_crm_atividades_lead_id_idx;
drop index if exists public.ob_crm_atividades_ts_idx;

drop table if exists public.ob_crm_atividades;
