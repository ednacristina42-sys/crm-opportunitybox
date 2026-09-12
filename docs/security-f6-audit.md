# F6 — Auditoria de segurança (hardening dos avisos restantes)

Auditoria estática apenas — nenhuma alteração foi aplicada ao Supabase.
Dados recolhidos por introspeção **só de leitura** (catálogo do Postgres +
`get_advisors`) no projeto `Opportunitybox CRM` (`ddzlbmnmsdyodouqxbjx`), em
2026-09-12.

## Resumo executivo

O achado mais grave desta ronda é o **`public.v_toc_plano`**: é uma view
`SECURITY DEFINER` (assinalada como `ERROR` pelo linter de segurança do
Supabase) com `anon` a ter grants completos (incluindo `SELECT`), que expõe
dados pessoais de clientes (telefone, email, contacto, código postal,
localidade) lidos de `ob_crm_dados`. Como a view corre com os privilégios do
seu dono (`postgres`), ela **contorna** o fecho de acesso anónimo que o F2/F3
já aplicou diretamente à tabela `ob_crm_dados` — ou seja, mesmo depois do
F2/F3, um pedido não autenticado a `v_toc_plano` continua, na prática, a
conseguir ler estes dados. **Não foi alterada nesta ronda**, por instrução
explícita — fica documentada para decisão numa fase seguinte.

Os restantes achados (`isp_*`, `user_company()`) parecem pertencer a um
**produto/tenant diferente** que partilha este mesmo projeto Supabase (ver
secções próprias) — não ao Opportunitybox CRM — pelo que não são alterados
aqui.

---

## 1. `public.v_toc_plano`

- **Tipo:** view (não é função) — a distinção SECURITY DEFINER/INVOKER
  aplica-se aqui ao **dono da view**, não a uma propriedade de função.
- **Dono:** `postgres`. `reloptions` não define `security_invoker` → usa o
  comportamento por omissão do Postgres/Supabase (a view corre com os
  privilégios do dono, **não** do utilizador que a consulta).
- **Confirmado pelo linter oficial (`get_advisors`, nível `ERROR`):**
  `public.v_toc_plano` está definida com a propriedade `SECURITY DEFINER`.
- **Grants atuais:** `anon`, `authenticated`, `service_role` e `postgres`
  têm **todos** os privilégios (`SELECT`, `INSERT`, `UPDATE`, `DELETE`,
  `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`) — confirmado via
  `aclexplode(pg_class.relacl)`. `INSERT`/`UPDATE`/`DELETE` numa view sem
  regras `INSTEAD OF` falham em runtime, mas o `SELECT` é totalmente
  funcional para `anon`.
- **Tabelas que lê:** só leitura, de `public.ob_crm_dados` (chaves
  `'toc-snapshot'` e `'ob-clients'`). Não escreve em nada.
- **Confirmado que contém dados de cliente:** sim — colunas `w_tel`
  (telefone/telemóvel), `w_email`, `w_cont` (nome de contacto), `w_cp`
  (código postal) e `w_loc` (localidade), todas derivadas de
  `ob_crm_dados`.
- **Chamada por:** nem trigger, nem policy, nem o frontend do CRM (sem
  ocorrências em `index.html`). Não há evidência de quem a consome — é
  provavelmente uma view de apoio a um processo externo de reconciliação
  com o TOConline (o nome sugere isso), mantida fora do fluxo normal da
  app.
- **Risco de revogar/alterar:** **baixo para o CRM** (a app não a usa), mas
  **desconhecido para quem quer que a consuma externamente** — antes de
  fechar `anon`/mudar para `security_invoker`, é preciso confirmar que
  nenhum processo externo depende do acesso anónimo atual.
- **Recomendação:** **restringir com prioridade alta**, numa fase própria
  (não nesta migration): (a) `revoke all on public.v_toc_plano from anon,
  public;` e (b) recriar a view com `security_invoker = true` (Postgres
  15+/Supabase suporta esta opção em `CREATE VIEW ... WITH
  (security_invoker = true)`), para que volte a respeitar a RLS de
  `ob_crm_dados` como qualquer consulta direta já respeita depois do F2/F3.
  **Não alterada nesta ronda**, conforme pedido.

---

## 2. `public.user_company()`

```sql
CREATE OR REPLACE FUNCTION public.user_company()
 RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$function$
```

- **SECURITY DEFINER.**
- **search_path:** já **fixo** (`search_path=public`) — não está na lista
  de funções com search_path mutável do linter.
- **Grants atuais:** `EXECUTE` concedido a `anon`, `authenticated`,
  `service_role`, `postgres` — confirmado pelo linter
  (`anon_security_definer_function_executable` e
  `authenticated_security_definer_function_executable`).
- **Tabelas que lê:** `public.profiles` — **uma tabela distinta de
  `public.ob_profiles`** (confirmado: ambas existem como tabelas
  separadas no catálogo). Não escreve em nada.
- **Chamada por:** nenhuma trigger, nenhuma policy do Opportunitybox e
  nenhuma ocorrência em `index.html`. A tabela `public.profiles` (não
  `ob_profiles`) e a própria função (nome genérico, sem prefixo `ob_`)
  sugerem fortemente que pertence a **outro produto/tenant** que partilha
  este projeto Supabase — não ao Opportunitybox CRM.
- **Risco de revogar EXECUTE:** desconhecido a partir daqui — se
  pertencer mesmo a outro produto ativo, revogar sem coordenar podia
  partir esse produto. Zero risco conhecido para o Opportunitybox (não é
  chamada por ele).
- **Recomendação:** **não mexer agora.** Confirmar primeiro, junto de quem
  gere os outros projetos hospedados neste mesmo Supabase, se `profiles`/
  `user_company()` ainda estão em uso; só depois decidir entre manter,
  restringir grants ou mudar para `security invoker`. **Fora do âmbito
  desta migration**, conforme pedido.

---

## 3. `public.isp_get_tenant_id()`

```sql
CREATE OR REPLACE FUNCTION public.isp_get_tenant_id()
 RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT tenant_id FROM isp_profiles WHERE id = auth.uid()
$function$
```

- **SECURITY DEFINER.**
- **search_path:** **mutável** (sem `SET search_path`) — confirmado pelo
  linter (`function_search_path_mutable`). A referência a `isp_profiles`
  não está qualificada com esquema, o que combinado com search_path
  mutável é exatamente o padrão de risco que este aviso existe para
  apanhar (uma sessão podia, em teoria, manipular o `search_path` e fazer
  a função resolver `isp_profiles` para uma tabela diferente).
- **Grants atuais:** `EXECUTE` concedido a `anon`, `authenticated`,
  `service_role` — confirmado pelo linter
  (`anon_security_definer_function_executable`).
- **Tabelas que lê:** `isp_profiles` (não `ob_*`). Não escreve em nada.
- **Chamada por:** nenhuma trigger nem policy do Opportunitybox visível
  aqui, nenhuma ocorrência em `index.html`. O prefixo `isp_` e a tabela
  `isp_profiles` (confirmada como tabela própria, distinta de
  `ob_profiles`) indicam que pertence a outro produto — muito
  provavelmente o "ISP Manager", outro site alojado na mesma conta.
- **Risco de revogar EXECUTE:** desconhecido — se o outro produto estiver
  ativo, revogar `anon`/`authenticated` sem coordenar quebra-o. Risco de
  **corrigir só o search_path**, mantendo os grants exatamente como
  estão: **baixo** (não muda comportamento nem permissões, só fixa a
  resolução de nomes).
- **Recomendação:** **corrigir o search_path é seguro e não muda nada
  visível** (grants/lógica inalterados); ainda assim, **não incluído**
  nesta migration de F6, porque não é claramente Opportunitybox/
  infraestrutura interna (é doutro tenant) — o pedido do F6 restringe a
  migration a "funções que o audit confirme que pertencem ao
  Opportunitybox ou infraestrutura interna". Corrigir isto pertence a
  quem gere esse outro produto, coordenado à parte.

---

## 4. `public.isp_is_tenant_member(uuid)`

```sql
CREATE OR REPLACE FUNCTION public.isp_is_tenant_member(tid uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (SELECT 1 FROM isp_profiles WHERE id = auth.uid() AND tenant_id = tid)
$function$
```

- **SECURITY DEFINER**, **search_path mutável** (mesmo aviso do linter),
  mesma tabela `isp_profiles`, mesmos grants (`anon`, `authenticated`,
  `service_role`).
- **Chamada por:** provavelmente por policies do produto "isp" (não
  visíveis nas migrations deste repositório) — não pelo Opportunitybox.
- **Risco / recomendação:** exatamente os mesmos de `isp_get_tenant_id()`
  acima — search_path seguro de corrigir isoladamente, mas fora do âmbito
  desta migration por não ser claramente Opportunitybox/infraestrutura
  interna.

---

## 5. `public.isp_handle_new_user()`

```sql
CREATE OR REPLACE FUNCTION public.isp_handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.raw_user_meta_data->>'tenant_id' IS NOT NULL THEN
    INSERT INTO isp_profiles (id, tenant_id, full_name, email, role)
    VALUES (...) ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$
```

- **SECURITY DEFINER**, **plpgsql**, **search_path mutável** (confirmado
  pelo linter).
- **Grants atuais:** `EXECUTE` para `anon`, `authenticated`,
  `service_role` (o próprio linter assinala que é chamável mesmo por
  `anon` via RPC — embora na prática só faça sentido correr como trigger).
- **Tabelas que escreve:** `isp_profiles` (insert). Lê `NEW` (a linha
  recém-inserida em `auth.users`).
- **Chamada por trigger:** **sim** — `on_isp_user_created`, `AFTER INSERT
  ON auth.users`. Corre em paralelo com o trigger próprio do
  Opportunitybox (`ob_on_auth_user_created` → `ob_handle_new_user()`) na
  mesma tabela `auth.users` — ambos disparam em todo o registo de
  utilizador, cada um só faz algo se o metadata correspondente
  (`tenant_id` vs. `ob_role`) estiver presente.
- **Risco de revogar EXECUTE direto (via RPC):** **baixo para o
  Opportunitybox** (nunca a chama), mas revogar de `anon`/`authenticated`
  não afeta o disparo automático via trigger (triggers não passam pelas
  mesmas verificações de `GRANT EXECUTE` que uma chamada RPC direta) — ou
  seja, dá para fechar o acesso RPC direto sem quebrar o registo de
  utilizador do outro produto.
- **Recomendação:** corrigir search_path é seguro isoladamente; mesma
  decisão do isp_get_tenant_id/isp_is_tenant_member — **fora do âmbito
  desta migration** (pertence a outro produto), a coordenar à parte.

---

## 6. `public.set_updated_at()`

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end;
$function$
```

- **SECURITY INVOKER** (não é `SECURITY DEFINER` — `prosecdef = false`).
- **search_path:** **mutável** (sem `SET search_path`) — confirmado pelo
  linter. Como não referencia nenhuma tabela/função por nome (só
  `NEW.updated_at` e `now()`, ambos resolvidos sem depender de
  `search_path`), o risco prático de search_path mutável aqui é mínimo —
  mas corrigir custa zero e elimina o aviso.
- **Grants atuais:** `EXECUTE` para `anon`, `authenticated`,
  `service_role` — irrelevante na prática, porque só é invocada pelo
  Postgres como trigger `BEFORE UPDATE`, nunca via RPC direto (o linter
  não a assinala em `anon_security_definer_function_executable` nem em
  `authenticated_security_definer_function_executable` precisamente
  porque **não é** `SECURITY DEFINER`).
- **Tabelas onde está associada (via trigger `BEFORE UPDATE`):**
  `public.ob_orcamentos`, `public.ob_stock`, `public.ob_profiles`,
  `public.ob_clientes`, `public.ob_leads`, `public.ob_tasks` — claramente
  infraestrutura interna do Opportunitybox, usada em 6 tabelas centrais.
- **Chamada por:** só por trigger (nunca por policy, nunca pelo
  frontend).
- **Risco de revogar EXECUTE:** não aplicável/perigoso — não deve ser
  revogado (é preciso para o Postgres poder invocar o trigger), mas isso
  nunca foi pedido.
- **Recomendação:** **fixar `search_path = public` é seguro e
  recomendado.** Não muda comportamento (a função não depende de
  resolução de nomes fora do já implícito), não muda SECURITY
  DEFINER/INVOKER, não muda grants. **Incluída na migration desta
  ronda.**

---

## 7. `public.ob_colaboradores_touch()`

```sql
CREATE OR REPLACE FUNCTION public.ob_colaboradores_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $function$
```

- **SECURITY INVOKER** (`prosecdef = false`).
- **search_path:** **mutável** — confirmado pelo linter. Mesmo padrão
  trivial do `set_updated_at()` (só mexe em `NEW`/`now()`), risco prático
  mínimo, mas seguro e barato de corrigir.
- **Grants atuais:** `EXECUTE` para `anon`, `authenticated`,
  `service_role` — irrelevante na prática pela mesma razão de
  `set_updated_at()` (só corre via trigger).
- **Tabelas onde está associada:** só `public.ob_colaboradores` (trigger
  `ob_colaboradores_touch_trg`, `BEFORE UPDATE`).
- **Chamada por:** só por trigger.
- **Risco de revogar EXECUTE:** não aplicável (não deve ser revogado; não
  foi pedido).
- **Recomendação:** **fixar `search_path = public` é seguro e
  recomendado**, pelas mesmas razões do `set_updated_at()`. **Incluída na
  migration desta ronda.**

---

## 8. Funções `fu_*` (`fu_classificar`, `fu_classificar_e_reativar`,
`fu_confirmar_estado`, `fu_desativar_followup`, `fu_reativar_simples`)

- **SECURITY DEFINER**, `plpgsql`, todas com **`search_path=public` já
  fixo** — **não aparecem** na lista do linter de search_path mutável.
  Nada a corrigir aqui.
- **Grants atuais:** `EXECUTE` só para `authenticated` e `service_role`
  — **`anon` já não tem acesso** (confirmado via `aclexplode`). O linter
  assinala-as em
  `authenticated_security_definer_function_executable`, mas isso é
  **esperado/por desenho**: são exatamente as RPCs que o frontend chama
  autenticado para o fluxo de Follow-up (ver abaixo).
- **Tabelas que leem/escrevem:** operam sobre `public.ob_orcamentos`
  (classificação, reativação e confirmação de estado do
  follow-up/triagem, ver `20260730_ob_orcamento_triagem.sql`).
- **Chamada por:** **frontend**, diretamente — confirmado em
  `index.html`: `sb.rpc('fu_reativar_simples', ...)`, `sb.rpc('fu_classificar'|
  'fu_classificar_e_reativar', ...)`, `sb.rpc('fu_desativar_followup', ...)`,
  `sb.rpc('fu_confirmar_estado', ...)`. Não são chamadas por trigger nem
  por policy.
- **Risco de revogar EXECUTE:** **alto** — revogar de `authenticated`
  quebraria por completo o fluxo de Follow-up/Pipeline (reativação,
  classificação e confirmação de estado dos orçamentos) na app em
  produção. Não deve ser tocado.
- **Recomendação:** **manter exatamente como está.** Já não têm nem o
  problema de search_path nem o de exposição a `anon` — este grupo já
  está no estado seguro-e-funcional que os outros ainda não estão.
  Confirma-se aqui, por já estarem corrigidas, porque não entram na
  migration desta ronda.

---

## Tabela-resumo

| Objeto | DEFINER/INVOKER | search_path | grants (anon/auth/service) | Recomendação | Nesta migration? |
|---|---|---|---|---|---|
| `v_toc_plano` (view) | efetivamente DEFINER (dono) | n/a | anon:✓ auth:✓ service:✓ | restringir grants + `security_invoker=true`, fase própria | Não |
| `user_company()` | DEFINER | já fixo | anon:✓ auth:✓ service:✓ | confirmar se ainda em uso (outro tenant) antes de mexer | Não |
| `isp_get_tenant_id()` | DEFINER | **mutável** | anon:✓ auth:✓ service:✓ | fixar search_path seria seguro, mas é doutro tenant — coordenar à parte | Não |
| `isp_is_tenant_member(uuid)` | DEFINER | **mutável** | anon:✓ auth:✓ service:✓ | idem | Não |
| `isp_handle_new_user()` | DEFINER | **mutável** | anon:✓ auth:✓ service:✓ | idem | Não |
| `set_updated_at()` | INVOKER | **mutável** | anon:✓ auth:✓ service:✓ (irrelevante, só trigger) | fixar search_path — seguro | **Sim** |
| `ob_colaboradores_touch()` | INVOKER | **mutável** | anon:✓ auth:✓ service:✓ (irrelevante, só trigger) | fixar search_path — seguro | **Sim** |
| `fu_*` (5 funções) | DEFINER | já fixo | auth:✓ service:✓ (anon já revogado) | manter como está | Não (já corrigidas) |

## Outros achados do linter (fora do pedido, só a registar)

- **`rls_enabled_no_policy` (INFO, 5 tabelas):** `ob_crm_dados_backup_20260901`,
  `ob_orcamentos_backup_20260901`, `ob_orcamentos_bkp_20260808`,
  `ob_uni_atividades_backup_20260811`, `ob_uni_items_backup_20260811` têm
  RLS ativo sem nenhuma policy — isto é **seguro por omissão** (RLS sem
  policy nega tudo a quem não for dono/superuser), não é uma falha
  exploravel. Ficam a registo como possível limpeza futura (tabelas de
  backup antigas), sem qualquer ação nesta ronda.
- **`auth_leaked_password_protection` (WARN):** proteção contra passwords
  comprometidas (HaveIBeenPwned) desativada na conta Auth — confirmado,
  fora do âmbito desta migration por instrução explícita.

## Metodologia

Consultas de **só leitura** ao catálogo do Postgres
(`pg_proc`/`pg_class`/`pg_trigger`/`aclexplode`/`pg_views`) e à ferramenta
oficial de advisórios de segurança da Supabase (`get_advisors`, tipo
`security`), no projeto `ddzlbmnmsdyodouqxbjx`. Nenhuma escrita, nenhuma
migration, nenhum DDL foi executado — só `SELECT`.
