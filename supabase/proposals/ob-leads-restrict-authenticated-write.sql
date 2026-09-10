-- ============================================================
-- Fecha escrita AUTENTICADA genérica em ob-leads.
-- PROPOSTA, NAO APLICADA — depende da Edge Function crm-lead-ops
-- (ver ob-leads-write-via-edge-function-design.md) estar
-- implementada e testada ANTES de aplicar isto, para não haver
-- janela sem nenhum caminho de escrita.
--
-- Continuação de 2b06037 (ob_leads_remove_anon_write), que já tinha
-- removido 'ob-leads' das policies anon equivalentes. Esta proposta
-- faz o mesmo às policies authenticated.
--
-- Nomes exatos (confirmados por leitura direta de pg_policies antes
-- de propor esta alteração):
--   ob_crm_dados_insert_comercial  (INSERT, roles={authenticated})
--   ob_crm_dados_update_comercial  (UPDATE, roles={authenticated})
--
-- Depois desta alteração: nenhum cliente PostgREST (anon nem
-- authenticated, nenhum papel, incluindo admin) consegue fazer
-- INSERT/UPDATE direto em ob_crm_dados para chave='ob-leads'. Só
-- service_role (usado pela nova crm-lead-ops e pela crm-lead-intake,
-- já existente) continua a poder escrever — rolbypassrls=true,
-- confirmado em pg_roles, RLS nunca se aplica a essa role.
--
-- NAO tocado: ob_crm_dados_select_comercial (leitura continua igual
-- — crmHidratarLeadsCanonico()/obLerRemotoComVersao() não precisam
-- de mudar), nem as chaves ob-clients/ob-crm-atividades/
-- ob-crm-historico nestas duas policies (mantêm exatamente o acesso
-- de escrita que já tinham).
-- ============================================================

alter policy ob_crm_dados_insert_comercial on public.ob_crm_dados
  with check (
    (chave = ANY (ARRAY['ob-crm-atividades'::text, 'ob-crm-historico'::text, 'ob-clients'::text]))
    and (ob_is_admin() OR (ob_current_role() = 'comercial'::ob_user_role))
  );

alter policy ob_crm_dados_update_comercial on public.ob_crm_dados
  using (
    (chave = ANY (ARRAY['ob-crm-atividades'::text, 'ob-crm-historico'::text, 'ob-clients'::text]))
    and (ob_is_admin() OR (ob_current_role() = 'comercial'::ob_user_role))
  )
  with check (
    (chave = ANY (ARRAY['ob-crm-atividades'::text, 'ob-crm-historico'::text, 'ob-clients'::text]))
    and (ob_is_admin() OR (ob_current_role() = 'comercial'::ob_user_role))
  );

-- ------------------------------------------------------------
-- ROLLBACK (se algum dia for preciso reverter esta proposta
-- específica — restaura exatamente o estado anterior a ela)
-- ------------------------------------------------------------
-- alter policy ob_crm_dados_insert_comercial on public.ob_crm_dados
--   with check (
--     (chave = ANY (ARRAY['ob-leads'::text, 'ob-crm-atividades'::text, 'ob-crm-historico'::text, 'ob-clients'::text]))
--     and (ob_is_admin() OR (ob_current_role() = 'comercial'::ob_user_role))
--   );
-- alter policy ob_crm_dados_update_comercial on public.ob_crm_dados
--   using (
--     (chave = ANY (ARRAY['ob-leads'::text, 'ob-crm-atividades'::text, 'ob-crm-historico'::text, 'ob-clients'::text]))
--     and (ob_is_admin() OR (ob_current_role() = 'comercial'::ob_user_role))
--   )
--   with check (
--     (chave = ANY (ARRAY['ob-leads'::text, 'ob-crm-atividades'::text, 'ob-crm-historico'::text, 'ob-clients'::text]))
--     and (ob_is_admin() OR (ob_current_role() = 'comercial'::ob_user_role))
--   );


-- ------------------------------------------------------------
-- TESTES A CORRER DEPOIS DE APLICAR (mesmo padrão já usado em
-- 2b06037, agora com role authenticated + JWT real de comercial/admin)
-- ------------------------------------------------------------
-- - BEGIN; SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uuid de um comercial real>","role":"authenticated"}';
--   INSERT ... ON CONFLICT(chave) DO UPDATE em ob-leads -> deve negar (42501).
--   UPDATE direto em ob-leads -> deve afetar 0 linhas.
--   SELECT em ob-leads -> deve continuar a funcionar (policy não tocada).
--   UPDATE em ob-clients (controlo) -> deve continuar a afetar linhas.
--   ROLLBACK;
-- - Confirmar crm-lead-ops (service_role) continua a escrever normalmente.
-- - Confirmar conteúdo de ob-leads inalterado (hash/updated_at antes/depois).
