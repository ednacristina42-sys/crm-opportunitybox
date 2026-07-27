# Fase 2 — Plano de perfis, permissões e RLS (aguarda aprovação)

Projeto Supabase: `ddzlbmnmsdyodouqxbjx`. Estado: **nada neste documento além do que já
estava aplicado antes deste pedido foi executado.** Três migrações da base do Fase 2
(`ob_profiles_roles_and_helpers`, `ob_normalized_crm_tables`, `ob_orcamentos_add_owner_columns`)
já estavam em produção quando este pedido de pausa chegou — estão descritas na secção
"Estado atual" e há ajustes propostos para as alinhar com este documento. Todo o resto
abaixo é proposta, não execução.

---

## 0. Estado atual (já aplicado, antes desta pausa)

| Objeto | O que existe hoje |
|---|---|
| `ob_user_role` (enum) | `admin`, `manager`, `comercial`, `financeiro` |
| `ob_profiles` | tabela de perfis (id→auth.users, full_name, email, role, department, manager_id, active) + RLS (cada um vê o próprio perfil; admin vê tudo; gestor vê a sua equipa via `manager_id`) |
| `ob_current_role()`, `ob_is_admin()`, `ob_manages(id)`, `ob_can_see(owner_id)` | funções auxiliares `SECURITY DEFINER` com `search_path` fixo (evita o aviso de segurança que a auditoria da Fase 1 encontrou noutras funções) |
| `ob_clientes`, `ob_leads`, `ob_tasks`, `ob_visitas` | tabelas novas e vazias, com RLS já ativa usando `assigned_user_id` (ver nota de nomenclatura abaixo) |
| `ob_orcamentos` | ganhou as colunas `assigned_user_id` e `created_by` (nullable). **A política antiga (`ob_orcamentos_open`, aberta) não foi tocada** — os 577 orçamentos continuam acessíveis como estavam. |

**Nada foi apagado, nenhuma conta real foi criada, nenhuma política antiga foi alterada.**

### Discrepância de nomenclatura a corrigir

Usei `assigned_user_id` nas tabelas novas. O pedido usa `owner_id`. Proponho alinhar tudo
para `owner_id` (mais curto e é o termo que vais usar no dia a dia) — ver migração #1 e #2
na secção 5. Não retifiquei sozinho porque implicava mais uma migração sem aprovação.

---

## 1. Matriz de funções e permissões

| Pessoa | Função (`role`) | Nota |
|---|---|---|
| Edna Faria | `admin` | Proprietária — já tem conta Supabase Auth (`ednacristina42@gmail.com`) |
| Paulo Faria | `admin` | Proprietário. É também comercial: isto **não** exige um segundo valor de `role` — ownership (`owner_id` num orçamento/lead/cliente) é independente do `role` da pessoa. Paulo fica `role='admin'` e pode simultaneamente ser `owner_id` dos seus próprios negócios. Continua a aparecer nas listas de "comercial responsável". |
| Rui Mota | `comercial` | |
| Humberto Estrelinha | `comercial` | |
| André | `comercial` | falta apelido/email |
| Andreia | **por definir** | ver secção 6 |

Capacidades gerais por `role` (independente da tabela — o detalhe fica na matriz RLS da secção 4):

| Capacidade | admin | manager (gestor) | comercial | financeiro |
|---|:---:|:---:|:---:|:---:|
| Ver todos os registos da empresa | ✅ | ❌ (só a sua equipa) | ❌ | módulos financeiros apenas |
| Ver/editar registos da equipa que gere (`manager_id`) | ✅ | ✅ | ❌ | ❌ |
| Ver/editar apenas os próprios registos | ✅ | ✅ | ✅ | ✅ (só financeiro) |
| Criar registos | ✅ | ✅ | ✅ | ✅ |
| Apagar definitivamente (DELETE físico) | ✅ | ❌ | ❌ | ❌ |
| Gerir utilizadores/perfis/roles | ✅ | ❌ | ❌ | ❌ |
| Configurações globais do CRM | ✅ | ❌ | ❌ | ❌ |

Hoje ninguém tem `role='manager'` nem `role='financeiro'` — os papéis existem no enum para
quando forem precisos, mas `ob_manages()` devolve sempre `false` até existir um `manager_id`
apontado para alguém, portanto o comportamento por omissão é **fechado**, nunca aberto.

---

## 2. Fluxo de convite e criação de contas

**Não crio nenhuma conta agora.** O mecanismo fica pronto para quando tiveres os e-mails —
e, respondendo à tua pergunta do fim: sim, o fluxo é desenhado precisamente para que **tu
(Edna) consigas criar utilizadores sozinha**, sem precisares de mim.

### Como vai funcionar

1. **Convite** — Supabase Auth tem um fluxo nativo de "invite by email": a pessoa recebe um
   link seguro por email e define a própria password. Ninguém — nem eu, nem tu — vê ou
   define a password de outra pessoa.
2. **Criação automática do perfil** — uma função/trigger (`ob_handle_new_user`, ver migração
   #6 na secção 5, ainda por aprovar) copia `full_name`/`role`/`department` dos metadados do
   convite para uma linha nova em `ob_profiles`, assim que a pessoa confirma a conta. Não é
   preciso nenhum passo manual extra depois do convite.
3. **Quem pode convidar, já hoje, sem esperar pela Fase 4**:
   - **Opção imediata (recomendada):** tu ou o Paulo vão a
     `Supabase Dashboard → Authentication → Users → Invite user`, colocam o email e, em
     "User Metadata", adicionam `full_name`, `role` (`admin`/`comercial`/`manager`/`financeiro`)
     e `department`. A conta e o perfil aparecem automaticamente (depois da migração #6 estar
     aprovada e aplicada).
   - **Opção futura (Fase 4):** um ecrã "Novo utilizador" dentro do próprio CRM, que faz a
     mesma chamada por trás através de uma Edge Function (nunca expondo a `service_role key`
     ao browser).
4. **Eu só entro em ação se pedires explicitamente** — por exemplo, se preferires que eu
   envie os convites por vocês termos os emails corretos à mão. Caso contrário, a partir do
   momento em que a migração #6 for aprovada, isto é 100% self-service para ti.

### O que preciso de ti, quando quiseres avançar

Para cada pessoa: nome completo, email, `role`, `department` (opcional), gestor (opcional,
`manager_id`). Nenhuma conta é criada sem isto.

---

## 3. Estratégia de associação dos orçamentos antigos

Os 577 orçamentos têm uma coluna `vendedor` (texto livre, ex: "Paulo Faria", "Rui Mota") —
não há hoje nenhuma referência a um utilizador real. Proposta, em 4 passos, **nenhum deles
executado ainda**:

1. **Passo 1 — só leitura, sem risco.** Correr
   `select vendedor, count(*) from ob_orcamentos group by vendedor order by 2 desc;`
   para ver exatamente que nomes existem no campo `vendedor` e quantos orçamentos cada um tem.
   Posso correr isto já, é 100% seguro (`SELECT`), e ajuda a decidir os emails/contas da
   secção 2 — mas só o farei se confirmares, porque disseste para não executar mais nada sem
   aprovação.
2. **Passo 2 — mapeamento revisto por vocês.** Com os `ob_profiles` já criados (secção 2),
   construo uma tabela de correspondência `vendedor` (texto) → `ob_profiles.id`, e mostro-a
   para revisão **antes** de tocar em qualquer orçamento. Nomes ambíguos ou não reconhecidos
   ficam de fora da correspondência.
3. **Passo 3 — aplicar só o que for aprovado.**
   `UPDATE ob_orcamentos SET owner_id = <id> WHERE vendedor = '<nome>'` — um `UPDATE` por
   nome confirmado, nunca em bloco às cegas. Tudo o que não tiver correspondência aprovada
   fica com `owner_id = NULL` — nunca adivinho.
4. **Passo 4 — lista administrativa de pendentes.** Uma vista (`view`) só de leitura,
   visível apenas a admin:
   ```sql
   create view public.ob_orcamentos_sem_dono as
   select * from public.ob_orcamentos where owner_id is null;
   ```
   para vocês corrigirem manualmente os casos sem correspondência — na Fase 4 isto vira um
   ecrã no CRM; até lá dá para consultar diretamente no Supabase.

**Garantia:** a coluna `vendedor` original nunca é apagada nem sobrescrita — fica sempre
como registo histórico, independentemente de `owner_id` ser preenchido.

---

## 4. Proposta completa de RLS (matriz select / insert / update / delete)

Legenda: **admin** vê/edita tudo em todas as tabelas abaixo — omitido da coluna "condição"
por ser sempre verdade; as colunas mostram a condição para os outros papéis.

### Tabelas novas (`ob_clientes`, `ob_leads`, `ob_tasks`, `ob_visitas`) — já em produção, ajuste de nome pendente

| Operação | admin | manager | comercial |
|---|---|---|---|
| SELECT | tudo | `owner_id` reporta a mim (`manager_id`) | `owner_id = auth.uid()` |
| INSERT | qualquer `created_by` | `created_by = auth.uid()` | `created_by = auth.uid()` |
| UPDATE | tudo | registos da equipa | apenas os próprios (`owner_id = auth.uid()`) |
| DELETE | ✅ | ❌ | ❌ (proposto: também remover a exceção atual em `ob_tasks_delete` que hoje permite a quem criou apagar a própria tarefa — ver migração #4) |

### `ob_orcamentos` — proposta para quando a Fase 3 (associação) estiver concluída e aprovada

| Operação | admin | manager | comercial |
|---|---|---|---|
| SELECT | tudo | orçamentos da equipa | `owner_id = auth.uid()` |
| INSERT | qualquer | `created_by = auth.uid()` | `created_by = auth.uid()`, `owner_id = auth.uid()` por omissão |
| UPDATE | tudo | orçamentos da equipa | apenas os próprios |
| DELETE | ✅ (ver secção 5, eliminação lógica) | ❌ | ❌ — nunca DELETE físico, conforme pedido |

**Não aplicado agora.** A política `ob_orcamentos_open` (aberta) mantém-se até esta proposta
ser aprovada **e** a associação da secção 3 estar concluída — apertar antes disso deixaria
todos os 577 orçamentos (a maioria ainda sem `owner_id`) invisíveis para os comerciais.

### Tabelas antigas ainda por rever (`ob_stock`, `ob_despesas`, `ob_crm_dados`) — só proposta, Fase 4/5

| Tabela | SELECT proposto | INSERT/UPDATE proposto | Observação |
|---|---|---|---|
| `ob_stock` | qualquer utilizador autenticado (dado operacional, não pessoal) | apenas admin | simples — não há "dono" de stock |
| `ob_despesas` | admin, `financeiro`, ou o próprio (`user_id = auth.uid()`, coluna a criar) | idem | **risco identificado:** há uma política `anon insert` usada por um webhook do Make.com (o único registo existente tem `origem: "Make Webhook (teste)"`). Apertar isto parte essa automação até ser migrada para uma credencial própria — ver secção 7 |
| `ob_crm_dados` | a descontinuar | a descontinuar | esta tabela deixa de ter sentido assim que os blocos (`ob-clients`, `ob-leads`, etc.) forem migrados para `ob_clientes`/`ob_leads` na Fase 3 — proposta é aposentá-la, não dar-lhe RLS nova |

---

## 5. Lista exata das próximas migrations (nenhuma aplicada — a aguardar aprovação)

Numeradas na ordem em que seriam aplicadas. Cada uma é independente e reversível
(down-script incluído).

**#1 — `ob_orcamentos_rename_owner_and_audit_columns`**
```sql
alter table public.ob_orcamentos rename column assigned_user_id to owner_id;
alter table public.ob_orcamentos add column if not exists updated_by uuid references public.ob_profiles(id);
```
*Down:* `alter table public.ob_orcamentos rename column owner_id to assigned_user_id; alter table public.ob_orcamentos drop column if exists updated_by;`

**#2 — `ob_new_tables_rename_owner_and_audit_columns`** (em `ob_clientes`, `ob_leads`, `ob_tasks`, `ob_visitas`)
```sql
alter table public.ob_clientes rename column assigned_user_id to owner_id;
alter table public.ob_clientes add column if not exists updated_by uuid references public.ob_profiles(id);
-- repetir para ob_leads, ob_tasks, ob_visitas
```
*Down:* inverso, coluna a coluna.

**#3 — `ob_policies_rename_owner_references`** — recriar as policies das 5 tabelas acima
substituindo `assigned_user_id` por `owner_id` no texto das condições (necessário depois de #1/#2).
*Down:* recriar com o nome antigo.

**#4 — `ob_tasks_restrict_delete_to_admin`**
```sql
drop policy if exists ob_tasks_delete on public.ob_tasks;
create policy ob_tasks_delete on public.ob_tasks for delete using ( ob_is_admin() );
```
*Down:* recriar a policy com a condição antiga (`ob_is_admin() or created_by = auth.uid()`).

**#5 — `ob_soft_delete_columns`** (preparar, não ativar comportamento ainda)
```sql
alter table public.ob_orcamentos add column if not exists deleted_at timestamptz;
alter table public.ob_orcamentos add column if not exists deleted_by uuid references public.ob_profiles(id);
-- repetir para ob_clientes, ob_leads, ob_tasks, ob_visitas
```
*Down:* `drop column` nas 5 tabelas. **Só entra em vigor** (isto é, só as políticas de SELECT
passam a filtrar `deleted_at is null`) numa migração #5b separada, depois de aprovada.

**#6 — `ob_handle_new_user_trigger`** (mecanismo de convite da secção 2)
```sql
create or replace function public.ob_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.raw_user_meta_data->>'ob_role' is not null then
    insert into public.ob_profiles (id, full_name, email, role, department)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
      new.email,
      (new.raw_user_meta_data->>'ob_role')::ob_user_role,
      new.raw_user_meta_data->>'department'
    ) on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
create trigger ob_on_auth_user_created
  after insert on auth.users
  for each row execute function public.ob_handle_new_user();
```
*Down:* `drop trigger ob_on_auth_user_created on auth.users; drop function public.ob_handle_new_user();`

**#7 — `ob_orcamentos_owner_backfill`** (Fase 3 — só depois do mapeamento da secção 3 estar aprovado nome a nome)
```sql
-- um UPDATE por vendedor confirmado, gerado a partir da lista aprovada — não corrido em bloco
update public.ob_orcamentos set owner_id = '<uuid-do-perfil>' where vendedor = '<nome exato>';
```
*Down:* `update public.ob_orcamentos set owner_id = null where owner_id = '<uuid>';`

**#8 — `ob_orcamentos_tighten_rls`** (só depois de #7 estar concluído e aprovado)
```sql
drop policy if exists ob_orcamentos_open on public.ob_orcamentos;
create policy ob_orcamentos_select on public.ob_orcamentos for select using ( ob_can_see(owner_id) );
create policy ob_orcamentos_insert on public.ob_orcamentos for insert with check ( created_by = auth.uid() );
create policy ob_orcamentos_update on public.ob_orcamentos for update using ( ob_can_see(owner_id) ) with check ( ob_can_see(owner_id) );
-- sem policy de DELETE físico — eliminação passa a ser lógica (deleted_at), só admin
```
*Down:* recriar `ob_orcamentos_open` com `using (true) with check (true)`.

Nenhuma destas será executada sem a tua confirmação, migração a migração ou em bloco — como preferires.

---

## 6. A decisão pendente — Andreia / criares utilizadores tu própria

Resposta direta: **sim**, o desenho da secção 2 é exatamente para isso. Depois da migração
#6 (trigger de criação automática de perfil) estar aprovada e aplicada, convidar alguém —
incluindo a Andreia, quando decidires o departamento e permissões dela — é um passo que fazes
sozinha no `Supabase Dashboard → Authentication → Users → Invite user`, sem precisares de
mim. Eu preparo o mecanismo; quem carrega no botão de convidar és tu (ou o Paulo).

Não preciso da decisão sobre a Andreia agora — só quando quiseres convidá-la.

---

## 7. Riscos, testes e plano de rollback

### Riscos identificados

| Risco | Impacto | Mitigação |
|---|---|---|
| Webhook Make.com escreve em `ob_despesas` via `anon insert` | Apertar a policy dessa tabela (Fase 4/5) parte essa automação silenciosamente | Antes de tocar em `ob_despesas`, localizar o cenário Make.com e migrá-lo para autenticação própria (ex: chamar via Edge Function com segredo dedicado) |
| Orçamentos com `owner_id = null` depois da Fase 3 | Se a RLS for apertada (migração #8) antes de todos os registos terem dono, ficam invisíveis para comerciais (mas continuam visíveis para admin) | Nunca aplicar #8 sem a "lista de pendentes" (secção 3, passo 4) estar vazia ou explicitamente aceite por vocês |
| `manager_id` por preencher | Papel `manager` fica sem efeito prático até alguém ter reports diretos | Comportamento fecha por omissão (não abre acidentalmente) — sem risco de exposição |
| Nomenclatura `assigned_user_id` → `owner_id` | Renomear depois de haver código a depender do nome antigo seria mais arriscado | Fazer a renomeação agora (migrações #1–#3), antes da Fase 4 escrever qualquer query contra estas colunas |
| Integrações que já usam a `anon key` diretamente (ClickUp, TocOnline edge function, Make.com) | Podem depender de tabelas cuja RLS vai mudar | Levantar todas as integrações ativas antes de tocar em `ob_stock`/`ob_despesas`/`ob_crm_dados` (Fase 4/5) |

### Plano de testes (antes de qualquer política ficar "apertada" em produção)

1. Criar 2–3 contas de teste descartáveis (ex: alias de email tipo `ednacristina42+comercialA@gmail.com`,
   se o teu provedor suportar "+alias" — não usa emails reais de colegas) com `role='comercial'`.
2. Repetir os 7 cenários que descreveste na primeira mensagem desta auditoria: comercial A cria
   cliente → comercial B não vê → comercial B tenta aceder por URL/ID direto → admin vê tudo →
   permissões de edição/eliminação → logout fecha sessão → chave nunca exposta.
3. Correr `get_advisors(type="security")` depois de cada lote de migrações — já usámos isto na
   Fase 1 para confirmar que as novas funções não têm o aviso de "search_path mutável" que as
   funções antigas tinham.
4. Só depois de 1–3 passarem é que uma migração de aperto (#8, e o equivalente para as tabelas
   antigas) é aplicada a sério.

### Plano de rollback

- Todas as migrações #1–#6 são aditivas ou têm down-script pronto (secção 5) — reverter é
  correr o "Down" correspondente, sem perda de dados.
- A migração #7 (associar orçamentos) só define `owner_id`; reverter é pôr `owner_id = null`
  outra vez — nunca mexe em `vendedor` nem em nenhum outro campo do orçamento.
- A migração #8 (apertar `ob_orcamentos`) tem down-script que restaura a policy aberta
  original — mantém-se disponível mesmo depois de aplicada, para reversão de emergência.
- Independentemente de tudo isto, o backup completo da Fase 1
  (`backups/2026-07-27-pre-security-migration/`) continua a ser a rede de segurança de
  último recurso.
