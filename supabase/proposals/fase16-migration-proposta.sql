-- ============================================================
-- Fase 1.6 -- Follow-up: reativacao e triagem
-- PROPOSTA, NAO APLICADA. Nome de ficheiro sugerido quando for
-- aprovada: supabase/migrations/20260730_ob_orcamento_triagem.sql
-- Revisao 3 -- corrige: validacao real de datas (nao so formato),
-- constraint de consistencia da classificacao, GRANTs explicitos
-- de reforco (auditados contra a base real), nada de "to_date" a
-- correr sobre string nao validada.
-- ============================================================


-- ------------------------------------------------------------
-- 1) TABELA 1: estado ATUAL de triagem/reativacao (1 linha por orcamento)
-- ------------------------------------------------------------

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

  constraint ob_orcamento_triagem_orcamento_unico
    unique (orcamento_id),

  constraint ob_orcamento_triagem_classificacao_valida check (
    classificacao is null
    or classificacao in (
      'ainda_em_negociacao',
      'contactar_novamente',
      'sem_resposta',
      'nao_adjudicado',
      'duplicado',
      'cancelado',
      'aprovado',
      'faturado'
    )
  ),

  -- NOVA (ponto 2 do pedido): classificacao e os seus metadados tem
  -- de aparecer/desaparecer em bloco -- nunca uma classificacao sem
  -- data/autor, nem data/autor orfaos sem classificacao.
  constraint ob_orcamento_triagem_classificacao_consistente check (
    (classificacao is null and classificado_em is null and classificado_por is null)
    or
    (classificacao is not null and classificado_em is not null and classificado_por is not null)
  ),

  -- Bidirecional: reativado=true exige reativado_em/reativado_por
  -- preenchidos; reativado=false exige que estejam ambos vazios.
  constraint ob_orcamento_triagem_reativacao_consistente check (
    (reativado = false and reativado_em is null and reativado_por is null)
    or
    (reativado = true and reativado_em is not null and reativado_por is not null)
  )
);

comment on table public.ob_orcamento_triagem is
  'Estado atual de reativacao/classificacao de follow-up por orcamento. Uma linha por orcamento_id. Historico completo fica em ob_orcamento_triagem_historico.';

create index ob_orcamento_triagem_orcamento_idx
  on public.ob_orcamento_triagem (orcamento_id);

create index ob_orcamento_triagem_reativado_idx
  on public.ob_orcamento_triagem (reativado)
  where reativado = true;


-- ------------------------------------------------------------
-- 2) TABELA 2: historico (append-only via policies -- sem UPDATE/DELETE)
-- ------------------------------------------------------------

create table public.ob_orcamento_triagem_historico (
  id uuid primary key default gen_random_uuid(),

  orcamento_id text not null references public.ob_orcamentos(id),

  acao text not null check (
    acao in ('reativado', 'desativado', 'classificado', 'estado_confirmado')
  ),

  classificacao text check (
    classificacao is null
    or classificacao in (
      'ainda_em_negociacao',
      'contactar_novamente',
      'sem_resposta',
      'nao_adjudicado',
      'duplicado',
      'cancelado',
      'aprovado',
      'faturado'
    )
  ),

  st_anterior text,
  st_novo text,

  nota text,
  autor_id uuid not null references public.ob_profiles(id),
  criado_em timestamptz not null default now(),

  constraint ob_orcamento_triagem_historico_estado_coerente check (
    (
      acao = 'estado_confirmado'
      and st_anterior is not null
      and st_novo is not null
      and st_novo in ('Aprovado', 'Faturado', 'Cancelado')
    )
    or
    (
      acao <> 'estado_confirmado'
      and st_anterior is null
      and st_novo is null
    )
  )
);

comment on table public.ob_orcamento_triagem_historico is
  'Log de auditoria de todas as acoes de follow-up (reativacao, desativacao, classificacao, confirmacao de estado). As policies RLS nao permitem UPDATE nem DELETE a nenhum utilizador autenticado da aplicacao.';

create index ob_orcamento_triagem_historico_orcamento_idx
  on public.ob_orcamento_triagem_historico (orcamento_id, criado_em desc);


-- ------------------------------------------------------------
-- 3) ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.ob_orcamento_triagem enable row level security;
alter table public.ob_orcamento_triagem_historico enable row level security;

-- ---- ob_orcamento_triagem: SELECT, INSERT, UPDATE. SEM DELETE. ----

create policy ob_orcamento_triagem_select
  on public.ob_orcamento_triagem
  for select
  to authenticated
  using (
    exists (
      select 1 from public.ob_orcamentos o
      where o.id = orcamento_id and public.ob_can_see(o.owner_id)
    )
  );

create policy ob_orcamento_triagem_insert
  on public.ob_orcamento_triagem
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.ob_orcamentos o
      where o.id = orcamento_id and public.ob_can_see(o.owner_id)
    )
    and (reativado = false or reativado_por = auth.uid())
    and (classificacao is null or classificado_por = auth.uid())
  );

-- USING: pode alterar a linha se ainda consegue ver o orcamento hoje.
-- WITH CHECK: depois da alteracao, tem de continuar a poder ver o
-- orcamento, e reativado_por/classificado_por (quando preenchidos)
-- tem de ser sempre o proprio auth.uid() -- ninguem pode reatribuir
-- a autoria da reativacao/classificacao a outro perfil.
create policy ob_orcamento_triagem_update
  on public.ob_orcamento_triagem
  for update
  to authenticated
  using (
    exists (
      select 1 from public.ob_orcamentos o
      where o.id = orcamento_id and public.ob_can_see(o.owner_id)
    )
  )
  with check (
    exists (
      select 1 from public.ob_orcamentos o
      where o.id = orcamento_id and public.ob_can_see(o.owner_id)
    )
    and (reativado = false or reativado_por = auth.uid())
    and (classificacao is null or classificado_por = auth.uid())
  );

-- Sem "create policy ... for delete" nesta tabela, para nenhuma role.


-- ---- ob_orcamento_triagem_historico: SELECT + INSERT apenas ----

create policy ob_orcamento_triagem_historico_select
  on public.ob_orcamento_triagem_historico
  for select
  to authenticated
  using (
    exists (
      select 1 from public.ob_orcamentos o
      where o.id = orcamento_id and public.ob_can_see(o.owner_id)
    )
  );

create policy ob_orcamento_triagem_historico_insert
  on public.ob_orcamento_triagem_historico
  for insert
  to authenticated
  with check (
    autor_id = auth.uid()
    and exists (
      select 1 from public.ob_orcamentos o
      where o.id = orcamento_id and public.ob_can_see(o.owner_id)
    )
  );

-- Nenhuma policy de update/delete. Garantia: nenhum utilizador
-- autenticado da aplicacao, incluindo admin, altera ou apaga uma
-- linha do historico atraves das policies normais. Nao e garantia
-- absoluta ao nivel da base: o dono do projeto Supabase ou codigo
-- com a service_role key contorna RLS por definicao do Postgres.


-- ------------------------------------------------------------
-- 4) GRANTS -- reforco explicito alem do default (ponto 3 do pedido)
-- ------------------------------------------------------------
-- Auditoria real feita (so leitura) contra a base "Opportunitybox
-- CRM" em 2026-07-30: as default privileges do schema public
-- (pg_default_acl, dono "postgres") concedem TODOS os privilegios de
-- tabela (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) a
-- anon, authenticated e service_role em qualquer tabela nova criada
-- por "postgres" -- confirmado que e exatamente esse o padrao ja em
-- vigor em ob_orcamentos, ob_tasks, ob_leads, ob_clientes e
-- ob_crm_dados (todas com o mesmo conjunto de 7 privilegios para
-- anon e para authenticated). Ou seja: "anon recebe zero privilegios"
-- NAO e verdade ao nivel do GRANT -- anon recebe o mesmo pacote
-- completo que authenticated. A protecao real em todo o sistema e
-- inteiramente feita pela RLS: como todas as policies existentes sao
-- "to authenticated" (nunca "to public" nem "to anon"), o anon fica
-- sem nenhuma policy aplicavel e portanto sem acesso a nenhuma linha,
-- apesar do GRANT nominal.
--
-- Opcao A (nao fazer nada) reproduziria fielmente esse padrao.
-- Recomendo em vez disso um reforco (Opcao B) so nestas 2 tabelas
-- novas, como camada adicional independente da RLS -- para que,
-- mesmo num cenario hipotetico de bug futuro numa policy, IN,SERT/
-- DELETE continuem bloqueados ao nivel do proprio GRANT:

revoke all on public.ob_orcamento_triagem from anon;
revoke all on public.ob_orcamento_triagem_historico from anon;

revoke delete, truncate on public.ob_orcamento_triagem from authenticated;
revoke delete, truncate, update on public.ob_orcamento_triagem_historico from authenticated;

grant select, insert, update on public.ob_orcamento_triagem to authenticated;
grant select, insert on public.ob_orcamento_triagem_historico to authenticated;

-- Nota: isto faz estas 2 tabelas terem um padrao de GRANT diferente
-- do resto do schema (mais restrito, nunca mais aberto) -- assinalo
-- isto por transparencia, ja que muda a consistencia com as tabelas
-- existentes. Se preferir manter tudo identico ao padrao atual
-- (Opcao A), estas 6 linhas de revoke/grant nao entram na migration
-- final e a RLS acima e a unica linha de defesa, como em todo o
-- resto do sistema.


-- ------------------------------------------------------------
-- 5) ROLLBACK COMPLETO
-- ------------------------------------------------------------
-- drop table if exists public.ob_orcamento_triagem_historico;
-- drop table if exists public.ob_orcamento_triagem;
-- Isolado: nenhuma FK de fora aponta para estas duas tabelas.
-- ob_orcamentos e os 577 registos reais ficam completamente intocados.


-- ------------------------------------------------------------
-- 6) RPCs TRANSACIONAIS PROPOSTAS -- NAO CRIAR AINDA
-- (inalterado da revisao 2 -- ver texto da resposta para detalhe)
-- ------------------------------------------------------------
-- fu_reativar_simples(p_orcamento_id text)
-- fu_classificar_e_reativar(p_orcamento_id text, p_classificacao text)
-- fu_desativar_followup(p_orcamento_id text)
-- fu_confirmar_estado(p_orcamento_id text, p_st_novo text)
-- Nenhuma foi criada.


-- ------------------------------------------------------------
-- 7) VALIDACAO REAL DE DATAS (ponto 1 do pedido) -- vistas + categoria
--    validacao_data. NAO usa to_date/to_char sobre string nao
--    validada: to_date('31/02/2026','DD/MM/YYYY') LEVANTA ERRO em
--    Postgres (nao devolve null nem faz "roll-over"), e a ordem de
--    avaliacao de AND/OR nao e garantida pelo Postgres (ver secao
--    4.2.14 "Expression Evaluation Rules" da documentacao) -- por
--    isso o formato e a validade de calendario sao verificados por
--    aritmetica pura (sem chamar to_date) dentro de um CASE aninhado,
--    que É a construcao com ordem de avaliacao garantida. Só depois
--    de o CASE confirmar "dt_valida = true" numa CTE MATERIALIZED
--    (fence de otimizacao real, nao apenas AND) é que to_date corre,
--    e nesse ponto já não pode falhar.
-- ------------------------------------------------------------

-- CTE partilhada pelas 3 consultas abaixo:
--
-- with orcamentos_pendentes as materialized (
--   select o.*,
--     case
--       when o.dt ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
--         case
--           when (split_part(o.dt,'/',2))::int between 1 and 12
--            and (split_part(o.dt,'/',1))::int between 1 and (
--              case (split_part(o.dt,'/',2))::int
--                when 2 then case
--                  when (split_part(o.dt,'/',3))::int % 4 = 0
--                   and ((split_part(o.dt,'/',3))::int % 100 <> 0
--                        or (split_part(o.dt,'/',3))::int % 400 = 0)
--                  then 29 else 28 end
--                when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30
--                else 31
--              end
--            )
--           then true else false
--         end
--       else false
--     end as dt_valida
--   from public.ob_orcamentos o
--   where o.st = 'Pendente'
-- )

with orcamentos_pendentes as materialized (
  select o.*,
    case
      when o.dt ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
        case
          when (split_part(o.dt,'/',2))::int between 1 and 12
           and (split_part(o.dt,'/',1))::int between 1 and (
             case (split_part(o.dt,'/',2))::int
               when 2 then case
                 when (split_part(o.dt,'/',3))::int % 4 = 0
                  and ((split_part(o.dt,'/',3))::int % 100 <> 0
                       or (split_part(o.dt,'/',3))::int % 400 = 0)
                 then 29 else 28 end
               when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30
               else 31
             end
           )
          then true else false
        end
      else false
    end as dt_valida
  from public.ob_orcamentos o
  where o.st = 'Pendente'
)
-- 7a) VISTA OPERACIONAL
select o.*, t.reativado, t.reativado_em, t.classificacao
from orcamentos_pendentes o
left join public.ob_orcamento_triagem t on t.orcamento_id = o.id
where
  case
    when o.dt_valida = true then
      case when to_date(o.dt, 'DD/MM/YYYY') >= date '2026-07-01' then true else false end
    else false
  end
  or coalesce(t.reativado, false) = true;


with orcamentos_pendentes as materialized (
  select o.*,
    case
      when o.dt ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
        case
          when (split_part(o.dt,'/',2))::int between 1 and 12
           and (split_part(o.dt,'/',1))::int between 1 and (
             case (split_part(o.dt,'/',2))::int
               when 2 then case
                 when (split_part(o.dt,'/',3))::int % 4 = 0
                  and ((split_part(o.dt,'/',3))::int % 100 <> 0
                       or (split_part(o.dt,'/',3))::int % 400 = 0)
                 then 29 else 28 end
               when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30
               else 31
             end
           )
          then true else false
        end
      else false
    end as dt_valida
  from public.ob_orcamentos o
  where o.st = 'Pendente'
)
-- 7b) CARTEIRA HISTORICA
select o.*, t.reativado, t.classificacao, t.classificado_em
from orcamentos_pendentes o
left join public.ob_orcamento_triagem t on t.orcamento_id = o.id
where o.dt_valida = true
  and case
        when to_date(o.dt, 'DD/MM/YYYY') < date '2026-07-01' then true else false
      end
  and coalesce(t.reativado, false) = false;


with orcamentos_pendentes as materialized (
  select o.*,
    case
      when o.dt ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
        case
          when (split_part(o.dt,'/',2))::int between 1 and 12
           and (split_part(o.dt,'/',1))::int between 1 and (
             case (split_part(o.dt,'/',2))::int
               when 2 then case
                 when (split_part(o.dt,'/',3))::int % 4 = 0
                  and ((split_part(o.dt,'/',3))::int % 100 <> 0
                       or (split_part(o.dt,'/',3))::int % 400 = 0)
                 then 29 else 28 end
               when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30
               else 31
             end
           )
          then true else false
        end
      else false
    end as dt_valida
  from public.ob_orcamentos o
  where o.st = 'Pendente'
)
-- 7c) CATEGORIA validacao_data (nunca some silenciosamente)
select o.id, o.num, o.cli, o.vendedor, o.dt, 'validacao_data' as categoria
from orcamentos_pendentes o
where o.dt_valida = false;
