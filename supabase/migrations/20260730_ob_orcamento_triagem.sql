-- ============================================================
-- Fase 1.6 -- Follow-up: reativacao e triagem
-- Revisao 4 (Opcao B) -- escrita exclusiva por RPC SECURITY DEFINER.
-- Sem INSERT/UPDATE direto para authenticated em nenhuma das 2
-- tabelas. Testada com sucesso em branch Supabase de teste
-- (fase16-triagem-teste, apagado após os testes) em 2026-07-30:
-- isolamento comercial/admin, histórico sem UPDATE/DELETE,
-- atomicidade das RPCs, rollback -- todos os testes passaram.
-- AINDA NÃO APLICADA EM PRODUÇÃO.
-- ============================================================

create table public.ob_orcamento_triagem (
  id uuid primary key default gen_random_uuid(),
  orcamento_id text not null references public.ob_orcamentos(id),
  reativado boolean not null default false,
  reativado_em timestamptz,
  reativado_por uuid references public.ob_profiles(id),
  classificacao text,
  classificado_em timestamptz,
  classificado_por uuid references public.ob_profiles(id),
  nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ob_orcamento_triagem_orcamento_unico unique (orcamento_id),

  constraint ob_orcamento_triagem_classificacao_valida check (
    classificacao is null or classificacao in (
      'ainda_em_negociacao','contactar_novamente','sem_resposta',
      'nao_adjudicado','duplicado','cancelado','aprovado','faturado'
    )
  ),

  constraint ob_orcamento_triagem_classificacao_consistente check (
    (classificacao is null and classificado_em is null and classificado_por is null)
    or
    (classificacao is not null and classificado_em is not null and classificado_por is not null)
  ),

  constraint ob_orcamento_triagem_reativacao_consistente check (
    (reativado = false and reativado_em is null and reativado_por is null)
    or
    (reativado = true and reativado_em is not null and reativado_por is not null)
  )
);

create index ob_orcamento_triagem_orcamento_idx on public.ob_orcamento_triagem (orcamento_id);
create index ob_orcamento_triagem_reativado_idx on public.ob_orcamento_triagem (reativado) where reativado = true;

create table public.ob_orcamento_triagem_historico (
  id uuid primary key default gen_random_uuid(),
  orcamento_id text not null references public.ob_orcamentos(id),
  acao text not null check (acao in ('reativado','desativado','classificado','estado_confirmado')),
  classificacao text check (
    classificacao is null or classificacao in (
      'ainda_em_negociacao','contactar_novamente','sem_resposta',
      'nao_adjudicado','duplicado','cancelado','aprovado','faturado'
    )
  ),
  st_anterior text,
  st_novo text,
  nota text,
  autor_id uuid not null references public.ob_profiles(id),
  criado_em timestamptz not null default now(),

  constraint ob_orcamento_triagem_historico_estado_coerente check (
    (acao = 'estado_confirmado' and st_anterior is not null and st_novo is not null
      and st_novo in ('Aprovado','Faturado','Cancelado'))
    or
    (acao <> 'estado_confirmado' and st_anterior is null and st_novo is null)
  )
);

create index ob_orcamento_triagem_historico_orcamento_idx on public.ob_orcamento_triagem_historico (orcamento_id, criado_em desc);

alter table public.ob_orcamento_triagem enable row level security;
alter table public.ob_orcamento_triagem_historico enable row level security;

create policy ob_orcamento_triagem_select on public.ob_orcamento_triagem
  for select to authenticated
  using (exists (select 1 from public.ob_orcamentos o where o.id = orcamento_id and public.ob_can_see(o.owner_id)));

create policy ob_orcamento_triagem_historico_select on public.ob_orcamento_triagem_historico
  for select to authenticated
  using (exists (select 1 from public.ob_orcamentos o where o.id = orcamento_id and public.ob_can_see(o.owner_id)));

-- GRANTs minimos (Opcao B): so SELECT direto. Todas as escritas por RPC.
revoke all on public.ob_orcamento_triagem, public.ob_orcamento_triagem_historico from anon;
revoke all on public.ob_orcamento_triagem, public.ob_orcamento_triagem_historico from authenticated;
grant select on public.ob_orcamento_triagem, public.ob_orcamento_triagem_historico to authenticated;

-- ------------------------------------------------------------
-- RPCs SECURITY DEFINER -- unica via de escrita
-- ------------------------------------------------------------

create or replace function public.fu_reativar_simples(p_orcamento_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select owner_id into v_owner from public.ob_orcamentos where id = p_orcamento_id;
  if v_owner is null then raise exception 'orçamento não encontrado'; end if;
  if not public.ob_can_see(v_owner) then raise exception 'sem permissão para este orçamento'; end if;

  insert into public.ob_orcamento_triagem (orcamento_id, reativado, reativado_em, reativado_por)
  values (p_orcamento_id, true, now(), auth.uid())
  on conflict (orcamento_id) do update
    set reativado = true, reativado_em = now(), reativado_por = auth.uid(),
        classificacao = null, classificado_em = null, classificado_por = null,
        updated_at = now();

  insert into public.ob_orcamento_triagem_historico (orcamento_id, acao, autor_id)
  values (p_orcamento_id, 'reativado', auth.uid());
end; $$;

create or replace function public.fu_classificar_e_reativar(p_orcamento_id text, p_classificacao text, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if p_classificacao not in ('contactar_novamente','ainda_em_negociacao') then
    raise exception 'classificação % inválida nesta ação', p_classificacao;
  end if;
  select owner_id into v_owner from public.ob_orcamentos where id = p_orcamento_id;
  if v_owner is null then raise exception 'orçamento não encontrado'; end if;
  if not public.ob_can_see(v_owner) then raise exception 'sem permissão para este orçamento'; end if;

  insert into public.ob_orcamento_triagem (orcamento_id, classificacao, classificado_em, classificado_por, reativado, reativado_em, reativado_por, nota)
  values (p_orcamento_id, p_classificacao, now(), auth.uid(), true, now(), auth.uid(), p_nota)
  on conflict (orcamento_id) do update
    set classificacao = p_classificacao, classificado_em = now(), classificado_por = auth.uid(),
        reativado = true, reativado_em = now(), reativado_por = auth.uid(),
        nota = coalesce(p_nota, public.ob_orcamento_triagem.nota), updated_at = now();

  insert into public.ob_orcamento_triagem_historico (orcamento_id, acao, classificacao, nota, autor_id)
  values (p_orcamento_id, 'classificado', p_classificacao, p_nota, auth.uid());
  insert into public.ob_orcamento_triagem_historico (orcamento_id, acao, autor_id)
  values (p_orcamento_id, 'reativado', auth.uid());
end; $$;

create or replace function public.fu_classificar(p_orcamento_id text, p_classificacao text, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if p_classificacao not in ('sem_resposta','nao_adjudicado','duplicado','cancelado','aprovado','faturado') then
    raise exception 'classificação % inválida nesta ação', p_classificacao;
  end if;
  select owner_id into v_owner from public.ob_orcamentos where id = p_orcamento_id;
  if v_owner is null then raise exception 'orçamento não encontrado'; end if;
  if not public.ob_can_see(v_owner) then raise exception 'sem permissão para este orçamento'; end if;

  insert into public.ob_orcamento_triagem (orcamento_id, classificacao, classificado_em, classificado_por)
  values (p_orcamento_id, p_classificacao, now(), auth.uid())
  on conflict (orcamento_id) do update
    set classificacao = p_classificacao, classificado_em = now(), classificado_por = auth.uid(),
        nota = coalesce(p_nota, public.ob_orcamento_triagem.nota), updated_at = now();

  insert into public.ob_orcamento_triagem_historico (orcamento_id, acao, classificacao, nota, autor_id)
  values (p_orcamento_id, 'classificado', p_classificacao, p_nota, auth.uid());
end; $$;

create or replace function public.fu_desativar_followup(p_orcamento_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_classificacao text;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select owner_id into v_owner from public.ob_orcamentos where id = p_orcamento_id;
  if v_owner is null then raise exception 'orçamento não encontrado'; end if;
  if not public.ob_can_see(v_owner) then raise exception 'sem permissão para este orçamento'; end if;

  select classificacao into v_classificacao from public.ob_orcamento_triagem where orcamento_id = p_orcamento_id;

  update public.ob_orcamento_triagem
  set reativado = false, reativado_em = null, reativado_por = null,
      classificacao = case when v_classificacao in ('contactar_novamente','ainda_em_negociacao') then null else classificacao end,
      classificado_em = case when v_classificacao in ('contactar_novamente','ainda_em_negociacao') then null else classificado_em end,
      classificado_por = case when v_classificacao in ('contactar_novamente','ainda_em_negociacao') then null else classificado_por end,
      updated_at = now()
  where orcamento_id = p_orcamento_id;

  insert into public.ob_orcamento_triagem_historico (orcamento_id, acao, autor_id)
  values (p_orcamento_id, 'desativado', auth.uid());
end; $$;

create or replace function public.fu_confirmar_estado(p_orcamento_id text, p_st_novo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_st_anterior text;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if p_st_novo not in ('Aprovado','Faturado','Cancelado') then
    raise exception 'estado % inválido', p_st_novo;
  end if;
  select owner_id, st into v_owner, v_st_anterior from public.ob_orcamentos where id = p_orcamento_id;
  if v_owner is null then raise exception 'orçamento não encontrado'; end if;
  if not public.ob_can_see(v_owner) then raise exception 'sem permissão para este orçamento'; end if;

  update public.ob_orcamentos set st = p_st_novo where id = p_orcamento_id;

  insert into public.ob_orcamento_triagem_historico (orcamento_id, acao, st_anterior, st_novo, autor_id)
  values (p_orcamento_id, 'estado_confirmado', v_st_anterior, p_st_novo, auth.uid());
end; $$;

revoke all on function public.fu_reativar_simples(text) from public;
revoke all on function public.fu_classificar_e_reativar(text, text, text) from public;
revoke all on function public.fu_classificar(text, text, text) from public;
revoke all on function public.fu_desativar_followup(text) from public;
revoke all on function public.fu_confirmar_estado(text, text) from public;

grant execute on function public.fu_reativar_simples(text) to authenticated;
grant execute on function public.fu_classificar_e_reativar(text, text, text) to authenticated;
grant execute on function public.fu_classificar(text, text, text) to authenticated;
grant execute on function public.fu_desativar_followup(text) to authenticated;
grant execute on function public.fu_confirmar_estado(text, text) to authenticated;

-- ------------------------------------------------------------
-- ROLLBACK
-- ------------------------------------------------------------
-- drop function if exists public.fu_confirmar_estado(text, text);
-- drop function if exists public.fu_desativar_followup(text);
-- drop function if exists public.fu_classificar(text, text, text);
-- drop function if exists public.fu_classificar_e_reativar(text, text, text);
-- drop function if exists public.fu_reativar_simples(text);
-- drop table if exists public.ob_orcamento_triagem_historico;
-- drop table if exists public.ob_orcamento_triagem;
-- Isolado: nenhuma FK de fora aponta para estas duas tabelas.
-- ob_orcamentos e os registos reais ficam completamente intocados.
