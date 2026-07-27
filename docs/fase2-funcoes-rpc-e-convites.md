# Fase 2 — Análise das funções RPC + procedimento de convite

Só documentação e preparação, conforme pedido. **Nada foi executado**: nenhum
`REVOKE`/`GRANT`, nenhuma conta real, nenhum convite enviado.

---

## 1. Funções RPC expostas — análise completa (aguarda aprovação, nada alterado)

### O que descobri sobre os grants (não assumido — verificado)

Consultei `information_schema.role_table_grants`: `anon` e `authenticated` têm hoje
`SELECT/INSERT/UPDATE/DELETE` ao nível da **tabela** em `ob_profiles`, `ob_clientes`,
`ob_leads`, `ob_tasks`, `ob_visitas` — isto é o grant por omissão que o Supabase aplica
a todo o schema `public` quando um projeto é criado (`GRANT ALL ... TO anon,
authenticated`). **É a RLS, não o grant de tabela, que faz o trabalho de isolamento** —
por isso as funções auxiliares (`ob_can_see`, `ob_is_admin`, `ob_manages`) têm de ser
executáveis por quem quer que a política vá avaliar, senão a política parte com erro
em vez de devolver "sem linhas".

### Funções, uma a uma

| Função | O que devolve | Onde é usada nas políticas RLS | Quem precisa de `EXECUTE` |
|---|---|---|---|
| `ob_is_admin()` | `boolean` — se o **próprio** utilizador autenticado (`auth.uid()`) é admin | Diretamente em `ob_profiles_select/update/admin_all`, `ob_clientes_delete`, `ob_leads_delete`, `ob_visitas_delete`, `ob_tasks_delete`; indiretamente dentro de `ob_can_see()` | **`authenticated` — obrigatório.** `anon`: nunca é dono de nada (`auth.uid()` é `null` para pedidos anónimos), a função devolve sempre `false`; mas como as tabelas têm grant de tabela para `anon` (ver acima), o Postgres tem de conseguir *avaliar* a política também para `anon` — sem `EXECUTE`, um pedido anónimo a estas tabelas passa de "0 linhas" (comportamento atual) a **erro 500 de permissão** |
| `ob_current_role()` | o `role` (enum) do próprio utilizador | **Não é usada por nenhuma política hoje** — só existe para o futuro ecrã do CRM perguntar "quem sou eu" | `authenticated` — para o Fase 4 usar; `anon` não tem uso real, mas revogar não muda risco (devolve `null` para anon de qualquer forma) |
| `ob_manages(target_id uuid)` | `boolean` — se o utilizador autenticado é `manager_id` de `target_id` | Dentro de `ob_can_see()` (chamada indireta) | Mesma lógica de `ob_is_admin()`: `authenticated` obrigatório; `anon` só evita o erro 500 |
| `ob_can_see(owner_id uuid)` | `boolean` — `owner_id = eu` OU sou admin OU giro essa pessoa | Diretamente em `ob_clientes_select/update`, `ob_leads_select/update`, `ob_tasks_select/update`, `ob_visitas_select/update` | **`authenticated` — obrigatório**, é a função mais usada de todas. `anon`: mesma ressalva do erro 500 |
| `ob_handle_new_user()` | `trigger` (não é uma função "normal" — só corre dentro do gatilho `AFTER INSERT ON auth.users`) | N/A — não é chamada por nenhuma política | **Nenhum papel precisa de `EXECUTE` direto.** Chamar isto via RPC diretamente (`POST /rest/v1/rpc/ob_handle_new_user`) falha de qualquer forma com um erro do Postgres ("trigger functions can only be called as triggers"), porque não existe `NEW` fora do contexto do gatilho — o aviso do linter é um falso-positivo de baixo risco, mas é a única onde revogar é seguro e sem efeito colateral nas políticas |

### Proposta (não aplicada) — `REVOKE`/`GRANT`

```sql
-- Única alteração com risco verdadeiramente zero: a função de trigger nunca
-- precisa de ser chamada diretamente por ninguém.
revoke execute on function public.ob_handle_new_user() from anon, authenticated;

-- NÃO proponho revogar anon nas restantes (ob_is_admin, ob_manages, ob_can_see,
-- ob_current_role) — o ganho de segurança é ~zero (já devolvem sempre
-- false/null para anon, porque auth.uid() é null) e o efeito colateral é trocar
-- "0 linhas" por um erro 500 em qualquer pedido anónimo a estas 5 tabelas, o
-- que é pior para depuração e não fecha nenhuma porta real.
```

### Impacto nas políticas RLS

- Revogar só `ob_handle_new_user`: **zero impacto** — nenhuma política a usa.
- Se no futuro quisermos mesmo revogar `anon` nas outras 3 funções, isso só é seguro
  **depois** de `ob_stock`/`ob_despesas`/`ob_crm_dados`/`ob_orcamentos` deixarem de
  aceitar pedidos anónimos (Fase 4/5) — antes disso, convém não mexer, porque parte do
  site (`Design`, sincronizações, etc.) ainda depende de acesso `anon` nalgumas tabelas
  antigas e um erro 500 é mais difícil de diagnosticar do que uma resposta vazia.

**Recomendação:** aplicar só a linha do `ob_handle_new_user` (risco zero, sem
dependência de mais nada) numa próxima ronda, se aprovares; deixar as restantes 3
como estão até à Fase 4/5. Não apliquei nada disto ainda — fica a aguardar a tua
decisão.

---

## 2. Procedimento exato de convite (preparado — nenhuma conta criada)

### 2.1 Onde inserir o e-mail

`https://supabase.com/dashboard/project/ddzlbmnmsdyodouqxbjx` → **Authentication** →
**Users** → botão **"Invite user"** (canto superior direito) → campo *Email*.

### 2.2 Metadados a enviar no convite

O ecrã de convite do Supabase tem um campo **"User Metadata"** (JSON). Preencher
assim, por pessoa (exemplo para o Rui):

```json
{
  "full_name": "Rui Mota",
  "ob_role": "comercial",
  "department": "Comercial"
}
```

Isto é o que o trigger `ob_handle_new_user()` (já aplicado) lê para criar a linha em
`ob_profiles` automaticamente assim que a pessoa aceitar o convite e confirmar a conta.
Sem o campo `ob_role` no metadata, o trigger não cria nenhum perfil (fica só a conta em
`auth.users`, sem `ob_profiles` — não é um erro, é o comportamento previsto para não
criar perfis "a monte" sem se saber o papel).

**Nota importante:** o trigger **não lê** `manager_id` do metadata — ver ponto 2.4.

### 2.3 Valores válidos para `ob_role`

Exatamente 4, sensível a maiúsculas/minúsculas (o enum é `ob_user_role`):

- `admin`
- `manager`
- `comercial`
- `financeiro`

Para os 3 já confirmados: **Paulo Faria → `admin`**, **Rui Mota → `comercial`**,
**Humberto Estrelinha → `comercial`**.

### 2.4 Como definir o superior/gestor (`manager_id`)

**Hoje, isto não faz parte do convite** — é um passo manual a seguir, feito por um
admin, depois do perfil já existir:

```sql
update public.ob_profiles
set manager_id = '<uuid-do-gestor>'
where id = '<uuid-da-pessoa>';
```

Corre-se no **SQL Editor** do Supabase Studio (que liga como superutilizador,
não passa pela RLS, por isso funciona mesmo sendo `ob_profiles_admin_all` restrita a
admin). Para Paulo/Rui/Humberto: **não é preciso nenhum `manager_id`** — ninguém tem
hoje `role = 'manager'`, e Paulo já vê tudo por ser `admin`, independentemente de
`manager_id`.

### 2.5 Como confirmar que o trigger criou corretamente `ob_profiles`

Depois da pessoa aceitar o convite e definir password:

```sql
select id, full_name, email, role, department, manager_id, active, created_at
from public.ob_profiles
where email = '<email da pessoa>';
```

Esperado: **exatamente 1 linha**, `role` igual ao que foi posto no convite,
`created_at` recente. Se não aparecer nenhuma linha, o motivo mais provável é o
`ob_role` ter faltado ou vindo mal escrito no metadata do convite (ver 2.3) — nesse
caso o convite tem de ser reenviado, ou o perfil criado manualmente com um `INSERT`
avulso.

### 2.6 Como corrigir um perfil com o papel errado

```sql
update public.ob_profiles set role = '<novo_role>' where email = '<email>';
```

Também no SQL Editor do Supabase Studio (superutilizador, ignora RLS) — ou, se
preferires fazê-lo autenticada como admin através da API normal, a política
`ob_profiles_admin_all` já permite isto a qualquer conta com `role='admin'` (Edna ou
Paulo). Não apaga nem afeta nenhum registo que essa pessoa já possua (`owner_id`
mantém-se).

### 2.7 Como desativar o acesso sem eliminar o histórico

Duas camadas, e é importante saberes que só uma delas bloqueia acesso de facto **hoje**:

**A. Revogação real, disponível já hoje:** `Authentication → Users → (pessoa) → menu
"..." → Ban user`. Isto impede login imediatamente, sem apagar `auth.users`, sem
apagar `ob_profiles`, sem tocar em nenhum registo que a pessoa possua — exatamente
"sem eliminar o histórico".

**B. `ob_profiles.active = false` — hoje é só um sinalizador, não bloqueia nada.**
Preciso de ser direto sobre isto: a coluna `active` existe (criada na Fase 2 inicial),
mas nenhuma das funções (`ob_is_admin`, `ob_can_see`, `ob_manages`) verifica `active`
hoje — pôr `active=false` não impede a pessoa de continuar a aceder enquanto a conta
não estiver banida em A. Não é um bug novo desta ronda, é uma lacuna que ainda não
fechei porque implicava alterar as funções sem estar no lote aprovado. Proposta para
uma próxima ronda (SQL pronto, **não aplicado**):

```sql
create or replace function public.ob_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and active from public.ob_profiles where id = auth.uid()), false)
$$;
-- e o mesmo ajuste (` and active`) em ob_current_role() e ob_manages()/ob_can_see()
-- via a subquery que já usam de ob_profiles.
```

Até essa migração ser aprovada, **usar sempre a opção A (Ban user) para revogação
real** — `active=false` por si só não é suficiente.

---

## 3. Emails confirmados (2026-07-27) — pacote pronto, convites ainda não enviados

**Nota técnica:** não existe, entre as ferramentas disponíveis nesta sessão, nenhum
acesso de administração ao Supabase Auth (criar/convidar utilizadores). O envio tem de
ser feito manualmente por um admin humano no Supabase Dashboard — não é uma escolha de
cautela, é uma limitação real de acesso. Os payloads abaixo estão prontos a colar.

| Pessoa | Email | Metadata do convite |
|---|---|---|
| Paulo Faria | `paulofaria@opportunitybox.pt` | `{"full_name":"Paulo Faria","ob_role":"admin","department":"Direcção"}` |
| Rui Mota | `ruimota@opportunitybox.pt` | `{"full_name":"Rui Mota","ob_role":"comercial","department":"Comercial"}` |
| Humberto Estrelinha | `humberto@opportunitybox.pt` | `{"full_name":"Humberto Estrelinha","ob_role":"comercial","department":"Comercial"}` |

Estado: **convites não enviados**. Assim que confirmares que os 3 aceitaram, corro a
verificação da secção 2.5 para cada um antes de avançarmos para o plano de teste
(`fase2-plano-teste-3-contas.md`) e, mais tarde, a migration #7.

---

## Resumo

| Pedido | Estado |
|---|---|
| Funções expostas, o que devolvem, quem precisa | ✅ Secção 1 |
| Comandos REVOKE/GRANT propostos | ✅ Secção 1 — só `ob_handle_new_user` recomendado; resto fica como está por agora |
| Impacto nas políticas RLS | ✅ Secção 1 |
| Procedimento de convite (7 pontos) | ✅ Secção 2 |
| Emails confirmados e pacote de convite pronto | ✅ Secção 3 — Paulo, Rui, Humberto |
| Contas reais criadas | ❌ Nenhuma |
| Convites enviados | ❌ Nenhum — ação manual pendente (sem ferramenta de admin Auth disponível) |
| REVOKE/GRANT aplicado | ❌ Nenhum |
