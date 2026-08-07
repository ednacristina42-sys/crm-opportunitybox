-- ============================================================================
-- MIGRATION: ob_colaboradores — fonte oficial (relacional) dos colaboradores RH
-- Projeto Supabase: ddzlbmnmsdyodouqxbjx (Opportunitybox CRM)
--
-- OBJETIVO
--   Tabela relacional dedicada para os colaboradores (funcionários RH), com UUID
--   gerado no servidor, RLS real e soft-delete. NÃO usa ob_profiles (esse fica
--   exclusivo para login/perfis/permissões). Aditiva: não toca em ob_orcamentos,
--   ob_profiles nem em qualquer outra tabela.
--
-- SEGURANÇA
--   - Escrita apenas por admin (public.ob_is_admin()); nunca anónima.
--   - created_by / updated_by não falsificáveis (= auth.uid()).
--   - Leitura por qualquer utilizador autenticado (a lista da equipa é usada em
--     várias partes do CRM). anon sem acesso.
--   - Fluxo normal = soft-delete (deleted_at + deleted_by + ativo=false) por UPDATE.
--   - DELETE físico (apagar definitivo) permitido APENAS a admin, para a ação
--     irreversível exposta na interface com dupla confirmação.
--
-- NOTA DE APLICAÇÃO
--   Em produção foi aplicado em dois passos (migrations 20260807083849
--   'ob_colaboradores' + 20260807084230 'ob_colaboradores_delete_policy').
--   Este ficheiro consolida ambos: aplicado de uma vez reproduz o estado atual.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ob_colaboradores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id     text,                              -- ponte opcional p/ ids antigos (Date.now); nunca chave futura
  nome          text NOT NULL,
  departamento  text,
  funcao        text,
  email         text,
  telefone      text,
  nif           text,
  niss          text,
  iban          text,
  morada        text,
  admissao      date,
  contrato      text,
  salario       numeric,
  foto          text,                              -- url ou data-uri (base64)
  cor           text,
  ativo         boolean NOT NULL DEFAULT true,
  extra         jsonb   NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid                               -- quem desativou/apagou (= auth.uid())
);

-- legacy_id único quando não nulo (evita duplicar numa eventual importação)
CREATE UNIQUE INDEX IF NOT EXISTS ob_colaboradores_legacy_id_uidx
  ON public.ob_colaboradores (legacy_id) WHERE legacy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ob_colaboradores_ativo_idx
  ON public.ob_colaboradores (ativo) WHERE deleted_at IS NULL;

-- updated_at automático
CREATE OR REPLACE FUNCTION public.ob_colaboradores_touch()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS ob_colaboradores_touch_trg ON public.ob_colaboradores;
CREATE TRIGGER ob_colaboradores_touch_trg
  BEFORE UPDATE ON public.ob_colaboradores
  FOR EACH ROW EXECUTE FUNCTION public.ob_colaboradores_touch();

-- ---- RLS -------------------------------------------------------------------
ALTER TABLE public.ob_colaboradores ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer utilizador autenticado vê a equipa
DROP POLICY IF EXISTS ob_colaboradores_select ON public.ob_colaboradores;
CREATE POLICY ob_colaboradores_select ON public.ob_colaboradores
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: só admin; created_by não falsificável
DROP POLICY IF EXISTS ob_colaboradores_insert ON public.ob_colaboradores;
CREATE POLICY ob_colaboradores_insert ON public.ob_colaboradores
  FOR INSERT TO authenticated
  WITH CHECK ( public.ob_is_admin() AND created_by = auth.uid() );

-- UPDATE: só admin; updated_by não falsificável (cobre editar e soft-delete)
DROP POLICY IF EXISTS ob_colaboradores_update ON public.ob_colaboradores;
CREATE POLICY ob_colaboradores_update ON public.ob_colaboradores
  FOR UPDATE TO authenticated
  USING ( public.ob_is_admin() )
  WITH CHECK ( public.ob_is_admin() AND updated_by = auth.uid() );

-- DELETE físico (apagar definitivo): APENAS admin. Fluxo normal continua a ser
-- soft-delete via UPDATE; este DELETE serve a ação irreversível da interface.
DROP POLICY IF EXISTS ob_colaboradores_delete ON public.ob_colaboradores;
CREATE POLICY ob_colaboradores_delete ON public.ob_colaboradores
  FOR DELETE TO authenticated
  USING ( public.ob_is_admin() );

-- Grants mínimos (RLS filtra por linha; anon nunca entra por falta de policy)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ob_colaboradores TO authenticated;

COMMIT;
