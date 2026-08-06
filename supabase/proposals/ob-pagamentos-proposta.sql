-- =====================================================================
-- PROPOSTA (NÃO APLICADA) — Modelo de pagamentos por orçamento
-- Ficheiro: supabase/proposals/ob-pagamentos-proposta.sql
-- Projeto:  Opportunitybox CRM (ref ddzlbmnmsdyodouqxbjx)
-- Estado:   PROPOSTA. NADA foi executado na base de dados. Sem migration,
--           sem deploy, sem alteração ao index.html. Aplicar só com
--           autorização explícita, em branch/staging e com testes.
--
-- Objetivo: registar pagamentos ligados ao orçamento (owner_id FIÁVEL),
--   suportando sinal, pagamentos parciais, pagamento total e estorno
--   auditável, com o livro-razão em modo APPEND-ONLY.
--   valor_restante = val (total do orçamento) - soma(pagamentos).
--
-- Fase 1 (esta proposta):
--   - APENAS admin/financeiro podem REGISTAR ou ESTORNAR pagamentos.
--   - O comercial NÃO regista pagamento nem sinal (fica para fase futura).
--   - O comercial vê apenas cobranças dos SEUS orçamentos (owner_id) e pode
--     registar "contacto de cobrança" reutilizando as atividades já existentes
--     (crmAtividades) — fora do âmbito deste SQL.
--   - obPodeVerFinanceiro() NÃO é alterado por esta proposta.
--
-- Factos base confirmados na BD:
--   - ob_orcamentos.owner_id (uuid) + RLS SELECT = ob_can_see(owner_id).
--   - ob_orcamentos.val = total; sinal/saldo existem mas estão a 0 (não usados).
--   - TES_RECEBER é um blob em ob_crm_dados (sem owner/nif/orcamento_id) — NÃO é fonte.
--   - Proibido ligar cobrança a comercial pelo NOME do cliente.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) TABELA — livro-razão de pagamentos (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.ob_pagamentos (
  id             uuid primary key default gen_random_uuid(),
  orcamento_id   text not null references public.ob_orcamentos(id) on delete cascade,
  owner_id       uuid not null,                    -- copiado do orçamento pelo servidor (nunca do cliente)
  cliente        text,                             -- snapshot do nome p/ auditoria (fonte real = orçamento)
  valor          numeric(12,2) not null check (valor <> 0),   -- >0 recebido, <0 estorno
  tipo           text not null default 'parcial'
                   check (tipo in ('sinal','parcial','total','estorno')),
  metodo         text check (metodo in ('transferencia','mbway','multibanco','dinheiro','cheque','outro')),
  data_pagamento date not null default current_date,
  notas          text,
  estorna_id     uuid references public.ob_pagamentos(id),    -- preenchido quando tipo='estorno'
  created_at     timestamptz not null default now(),
  created_by     uuid not null default auth.uid()
);
comment on table public.ob_pagamentos is
  'Livro-razao de pagamentos por orcamento (append-only). Correcoes via linha de estorno. owner_id copiado do orcamento pelo servidor.';


-- ---------------------------------------------------------------------
-- 2) ÍNDICES
-- ---------------------------------------------------------------------
create index if not exists ob_pagamentos_orc_idx     on public.ob_pagamentos(orcamento_id);
create index if not exists ob_pagamentos_owner_idx   on public.ob_pagamentos(owner_id);
create index if not exists ob_pagamentos_estorna_idx on public.ob_pagamentos(estorna_id);


-- ---------------------------------------------------------------------
-- 3) VISTA — saldo por orçamento (respeita RLS via security_invoker; PG15+)
-- ---------------------------------------------------------------------
create or replace view public.ob_orcamento_saldos with (security_invoker = true) as
  select o.id                            as orcamento_id,
         o.owner_id,
         o.cli                           as cliente,
         o.nif,
         o.val                           as valor_total,
         coalesce(p.recebido,0)          as valor_recebido,
         (o.val - coalesce(p.recebido,0)) as valor_restante,
         o.st                            as estado_orc
  from public.ob_orcamentos o
  left join (
    select orcamento_id, sum(valor) as recebido
    from public.ob_pagamentos
    group by orcamento_id
  ) p on p.orcamento_id = o.id
  where o.deleted_at is null;


-- ---------------------------------------------------------------------
-- 4) GATE DE PERMISSÃO — quem pode registar/estornar (Fase 1: admin/financeiro)
--    NB: confirmar que ob_profiles.role usa estes valores ('financeiro','direcao').
-- ---------------------------------------------------------------------
create or replace function public.ob_pode_registar_pagamento()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('admin','financeiro','direcao')
       from public.ob_profiles where id = auth.uid()),
    false);
$$;


-- ---------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------
alter table public.ob_pagamentos enable row level security;

-- Ver: dono/admin/gestor (helper existente) OU quem tem permissão financeira
-- (garante que financeiro/admin veem TODOS os pagamentos).
drop policy if exists ob_pagamentos_select on public.ob_pagamentos;
create policy ob_pagamentos_select on public.ob_pagamentos
  for select
  using ( public.ob_can_see(owner_id) or public.ob_pode_registar_pagamento() );

-- Inserção direta PROIBIDA — só através dos RPC (SECURITY DEFINER).
drop policy if exists ob_pagamentos_no_insert on public.ob_pagamentos;
create policy ob_pagamentos_no_insert on public.ob_pagamentos
  for insert with check (false);

-- Sem policies de UPDATE/DELETE  =>  UPDATE/DELETE proibidos (append-only).


-- ---------------------------------------------------------------------
-- 6) RPCs
-- ---------------------------------------------------------------------

-- 6.1 Registar pagamento (sinal | parcial | total). owner_id vem do orçamento.
create or replace function public.ob_pagamento_registar(
  p_orcamento_id text,
  p_valor        numeric,
  p_tipo         text default 'parcial',
  p_metodo       text default null,
  p_data         date default current_date,
  p_notas        text default null
) returns public.ob_pagamentos
language plpgsql security definer set search_path = public as $$
declare
  v_orc   public.ob_orcamentos;
  v_receb numeric;
  v_row   public.ob_pagamentos;
begin
  if not public.ob_pode_registar_pagamento() then
    raise exception 'sem_permissao: apenas admin/financeiro podem registar pagamentos';
  end if;
  if p_tipo not in ('sinal','parcial','total') then
    raise exception 'tipo_invalido: use sinal|parcial|total (estorno e via ob_pagamento_estornar)';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'valor_invalido: o valor tem de ser > 0';
  end if;

  select * into v_orc from public.ob_orcamentos
    where id = p_orcamento_id and deleted_at is null;
  if not found then
    raise exception 'orcamento_inexistente: %', p_orcamento_id;
  end if;
  if v_orc.owner_id is null then
    raise exception 'orcamento_sem_owner: %', p_orcamento_id;
  end if;

  select coalesce(sum(valor),0) into v_receb
    from public.ob_pagamentos where orcamento_id = p_orcamento_id;

  if v_receb + p_valor > coalesce(v_orc.val,0) then
    raise exception 'excede_total: recebido % + % ultrapassa total %', v_receb, p_valor, v_orc.val;
  end if;

  insert into public.ob_pagamentos(
    orcamento_id, owner_id, cliente, valor, tipo, metodo, data_pagamento, notas, created_by)
  values(
    v_orc.id, v_orc.owner_id, v_orc.cli, p_valor, p_tipo, p_metodo,
    coalesce(p_data, current_date), p_notas, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- 6.2 Estornar pagamento (linha compensatória; NÃO apaga nada).
create or replace function public.ob_pagamento_estornar(
  p_pagamento_id uuid,
  p_notas        text default null
) returns public.ob_pagamentos
language plpgsql security definer set search_path = public as $$
declare
  v_orig public.ob_pagamentos;
  v_row  public.ob_pagamentos;
begin
  if not public.ob_pode_registar_pagamento() then
    raise exception 'sem_permissao: apenas admin/financeiro podem estornar';
  end if;

  select * into v_orig from public.ob_pagamentos where id = p_pagamento_id;
  if not found then
    raise exception 'pagamento_inexistente: %', p_pagamento_id;
  end if;
  if v_orig.tipo = 'estorno' then
    raise exception 'nao_estornar_estorno: a linha indicada ja e um estorno';
  end if;
  if exists (select 1 from public.ob_pagamentos where estorna_id = p_pagamento_id) then
    raise exception 'ja_estornado: este pagamento ja foi estornado';
  end if;

  insert into public.ob_pagamentos(
    orcamento_id, owner_id, cliente, valor, tipo, metodo, data_pagamento, notas, estorna_id, created_by)
  values(
    v_orig.orcamento_id, v_orig.owner_id, v_orig.cliente, -v_orig.valor, 'estorno', v_orig.metodo,
    current_date, coalesce(p_notas, 'Estorno do pagamento '||p_pagamento_id::text), p_pagamento_id, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- 6.3 Leitura: cobranças em aberto do utilizador autenticado (RLS aplica-se).
create or replace function public.ob_minhas_cobrancas()
returns setof public.ob_orcamento_saldos
language sql stable security invoker set search_path = public as $$
  select * from public.ob_orcamento_saldos
  where valor_restante > 0
  order by valor_restante desc;
$$;


-- ---------------------------------------------------------------------
-- 7) GRANTS / REVOKES
-- ---------------------------------------------------------------------
-- Tabela: leitura filtrada por RLS; escrita direta proibida (só via RPC).
grant  select                     on public.ob_pagamentos to authenticated;
revoke insert, update, delete     on public.ob_pagamentos from authenticated, anon;

-- Vista de saldos: leitura para autenticados (RLS via security_invoker).
grant  select on public.ob_orcamento_saldos to authenticated;

-- RPCs: execução por autenticados (a permissão fina é feita DENTRO das funções).
grant execute on function public.ob_pagamento_registar(text,numeric,text,text,date,text) to authenticated;
grant execute on function public.ob_pagamento_estornar(uuid,text)                          to authenticated;
grant execute on function public.ob_minhas_cobrancas()                                     to authenticated;
grant execute on function public.ob_pode_registar_pagamento()                              to authenticated;

revoke execute on function public.ob_pagamento_registar(text,numeric,text,text,date,text) from anon;
revoke execute on function public.ob_pagamento_estornar(uuid,text)                          from anon;

-- NOTA de aplicação: as funções SECURITY DEFINER devem ser OWNED por um papel
-- que ignore RLS (tipicamente 'postgres'), para o INSERT interno passar apesar
-- da policy "no_insert". Confirmar o owner ao aplicar.


-- ---------------------------------------------------------------------
-- 8) TESTES (executar em BRANCH/STAGING; nunca direto em produção)
-- ---------------------------------------------------------------------
-- (a) Restante inicial:
--     select valor_total, valor_recebido, valor_restante
--       from ob_orcamento_saldos where orcamento_id = '<ID>';
--     -- esperado: recebido=0, restante=valor_total
-- (b) Registo (sessão financeiro/admin):
--     select ob_pagamento_registar('<ID>', 100, 'sinal', 'transferencia');
--     -- restante desce 100; 1 linha nova em ob_pagamentos
-- (c) Excesso do total:
--     select ob_pagamento_registar('<ID>', 999999, 'total');   -- deve falhar: excede_total
-- (d) Estorno:
--     select ob_pagamento_estornar('<PAGAMENTO_ID>');
--     -- cria linha -valor; restante volta a subir; original fica "estornado"
-- (e) Duplo estorno:
--     select ob_pagamento_estornar('<PAGAMENTO_ID>');          -- deve falhar: ja_estornado
-- (f) Append-only:
--     update ob_pagamentos set valor = 1 where id = '<X>';     -- deve falhar (sem policy update)
--     delete from ob_pagamentos where id = '<X>';              -- deve falhar (sem policy delete)
-- (g) Permissão / RLS (JWT de comercial A):
--     select ob_pagamento_registar('<ID>', 50, 'parcial');    -- deve falhar: sem_permissao
--     select * from ob_pagamentos;                             -- só linhas visíveis a A
--     select * from ob_orcamento_saldos;                       -- só orçamentos de A
-- (h) Anti-spoof: os RPC não recebem owner_id; impossível forjar dono.


-- ---------------------------------------------------------------------
-- 9) ROLLBACK (aditivo — ob_orcamentos e dados existentes ficam INTACTOS)
-- ---------------------------------------------------------------------
-- drop function if exists public.ob_minhas_cobrancas();
-- drop function if exists public.ob_pagamento_estornar(uuid,text);
-- drop function if exists public.ob_pagamento_registar(text,numeric,text,text,date,text);
-- drop view     if exists public.ob_orcamento_saldos;
-- drop function if exists public.ob_pode_registar_pagamento();
-- drop table    if exists public.ob_pagamentos;
-- -- ob_orcamentos NÃO é alterada por esta proposta (nenhuma coluna nova).


-- =====================================================================
-- FIM DA PROPOSTA — NADA FOI APLICADO À BASE DE DADOS.
-- Sem migration, sem deploy, sem alteração ao index.html.
-- =====================================================================
