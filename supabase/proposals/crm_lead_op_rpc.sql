-- ============================================================
-- RPC transacional para ob-leads — substitui o read->upsert
-- incondicional do rascunho anterior por um CAS real.
--
-- Corrige os 2 pontos pedidos na revisão:
--  1) Concorrência: SELECT ... FOR UPDATE bloqueia a linha ob-leads
--     até ao fim da transação — duas chamadas concorrentes a este
--     RPC nunca leem o mesmo snapshot; a segunda espera pela
--     primeira, lê já o resultado da primeira, e só depois aplica a
--     sua própria operação. Sem UPDATE incondicional nenhum.
--  2) Auditoria: escrita em ob-crm-atividades por INSERT..ON
--     CONFLICT DO UPDATE com concatenação jsonb dentro do próprio
--     SET (`jsonb_build_array(...) || ob_crm_dados.dados`) — o valor
--     antigo é lido e o novo escrito no mesmo comando, sob o lock de
--     linha implícito do upsert. Nenhum read-modify-write em código
--     de aplicação.
--
-- Só chamável por service_role (revoke de public/anon/authenticated)
-- — o único chamador previsto é a Edge Function crm-lead-ops, que já
-- valida o JWT do utilizador e passa o seu id verificado como
-- p_actor_id. O RPC volta a verificar o papel desse actor por conta
-- própria (defesa em profundidade — não confia cegamente em quem o
-- chama, mesmo sendo só service_role).
-- ============================================================

create or replace function public.crm_lead_op(
  p_operacao text,
  p_id bigint,
  p_lead jsonb default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_papel public.ob_user_role;
  v_dados jsonb;
  v_sem_id jsonb;
  v_novo jsonb;
  v_ts timestamptz := now();
  v_atividade jsonb;
  v_autor text;
begin
  if p_operacao not in ('create','update','delete') then
    raise exception 'operacao invalida: %', p_operacao using errcode = '22023';
  end if;
  if p_id is null then
    raise exception 'id obrigatorio' using errcode = '22023';
  end if;
  if p_operacao <> 'delete' then
    if p_lead is null or (p_lead ? 'id') is false then
      raise exception 'lead (com id) obrigatorio para create/update' using errcode = '22023';
    end if;
    if (p_lead->>'id')::bigint <> p_id then
      raise exception 'id do lead nao corresponde a p_id' using errcode = '22023';
    end if;
  end if;

  if p_actor_id is null then
    raise exception 'actor obrigatorio' using errcode = '42501';
  end if;
  select role, full_name into v_papel, v_autor from public.ob_profiles where id = p_actor_id;
  if v_papel is null or v_papel not in ('admin', 'comercial') then
    raise exception 'ator sem permissao (precisa admin ou comercial)' using errcode = '42501';
  end if;

  -- 1) Bloqueia a linha ob-leads até ao commit/rollback desta
  -- transação. Qualquer outra chamada concorrente a este RPC (ou
  -- qualquer outro UPDATE dessa linha) espera aqui.
  select dados into v_dados from public.ob_crm_dados where chave = 'ob-leads' for update;
  if not found then
    insert into public.ob_crm_dados (chave, dados, updated_at)
      values ('ob-leads', '[]'::jsonb, v_ts)
      on conflict (chave) do nothing;
    select dados into v_dados from public.ob_crm_dados where chave = 'ob-leads' for update;
  end if;
  v_dados := coalesce(v_dados, '[]'::jsonb);

  -- Remove o id alvo do array (serve para create/update/delete —
  -- create/update fazem "substitui se existir, acrescenta senão").
  select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_sem_id
  from jsonb_array_elements(v_dados) elem
  where (elem->>'id')::bigint is distinct from p_id;

  if p_operacao = 'delete' then
    v_novo := v_sem_id;
  else
    v_novo := v_sem_id || jsonb_build_array(p_lead);
  end if;

  update public.ob_crm_dados set dados = v_novo, updated_at = v_ts where chave = 'ob-leads';

  -- 2) Auditoria atómica — upsert com concatenação no próprio SET,
  -- sem leitura prévia em código de aplicação.
  v_atividade := jsonb_build_object(
    'leadId', p_id, 'orcId', null, 'ts', v_ts,
    'tipo', case p_operacao when 'delete' then 'apagado' when 'create' then 'criado' else 'editado' end,
    'texto', 'Lead ' || p_operacao || ' via crm-lead-ops',
    'autor', coalesce(v_autor, 'desconhecido'),
    'resultado', null
  );
  insert into public.ob_crm_dados (chave, dados, updated_at)
    values ('ob-crm-atividades', jsonb_build_array(v_atividade), v_ts)
    on conflict (chave) do update
    set dados = jsonb_build_array(v_atividade) || coalesce(public.ob_crm_dados.dados, '[]'::jsonb),
        updated_at = v_ts;

  return v_novo;
end;
$$;

revoke all on function public.crm_lead_op(text, bigint, jsonb, uuid) from public;
revoke all on function public.crm_lead_op(text, bigint, jsonb, uuid) from anon;
revoke all on function public.crm_lead_op(text, bigint, jsonb, uuid) from authenticated;
grant execute on function public.crm_lead_op(text, bigint, jsonb, uuid) to service_role;
