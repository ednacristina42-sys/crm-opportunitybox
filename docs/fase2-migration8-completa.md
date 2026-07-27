# Fase 2 — Migration #8 completa (análise, sem execução) + requisitos da Fase 4

**Nada foi executado.** Sem SQL corrido, sem RLS alterada, sem deploy, sem avanço para
a migration #7. Confirmado também: não preparo nem publico nenhuma página interina de
troca de password — fica tudo integrado na Fase 4, como pediste.

---

## 1. SQL completo da migration #8 — `ob_orcamentos_tighten_rls`

```sql
-- Pré-condição obrigatória: migration #7 concluída e validada (577 orçamentos
-- todos com owner_id preenchido, zero nulos). Não corre sem essa validação.

begin;

drop policy if exists ob_orcamentos_open on public.ob_orcamentos;

create policy ob_orcamentos_select on public.ob_orcamentos
  for select
  using ( ob_can_see(owner_id) );

create policy ob_orcamentos_insert on public.ob_orcamentos
  for insert
  with check (
    created_by = auth.uid()
    and (ob_is_admin() or owner_id = auth.uid())
  );

create policy ob_orcamentos_update on public.ob_orcamentos
  for update
  using ( ob_can_see(owner_id) )
  with check ( ob_can_see(owner_id) );

create policy ob_orcamentos_delete on public.ob_orcamentos
  for delete
  using ( ob_is_admin() );

commit;
```

Quatro políticas novas, uma por operação — sem política `ALL` genérica, para ficar
explícito e fácil de auditar o que cada papel pode fazer em cada operação.

---

## 2. Comparação: política atual vs. proposta

| | **Atual (`ob_orcamentos_open`)** | **Proposta (4 políticas)** |
|---|---|---|
| Quem pode ler | Qualquer pedido com a chave anon, sem sessão nenhuma | Só sessão autenticada; admin vê tudo, comercial só o que lhe pertence (`owner_id`) |
| Quem pode criar | Qualquer pedido com a chave anon | Só autenticado; comercial só pode criar para si próprio; admin pode criar para qualquer pessoa |
| Quem pode editar | Qualquer pedido com a chave anon, qualquer linha | Só autenticado; comercial só edita o que é seu; admin edita tudo |
| Quem pode reatribuir (`owner_id`) | Qualquer pedido com a chave anon | Comercial **não pode** reatribuir a um colega (bloqueado pelo `WITH CHECK`); só admin |
| Quem pode apagar fisicamente | Qualquer pedido com a chave anon | Só admin — nenhum comercial, nem no próprio registo |
| Acesso anónimo (sem login nenhum) | Total | Zero — `ob_can_see(owner_id)` avalia sempre `false` sem sessão |
| Nº de políticas | 1 (`ALL`, `USING(true)`) | 4 (uma por operação) |

---

## 3. Testes positivos e negativos

Contas: Paulo (admin), Rui (comercial, 220 orçamentos), Humberto (comercial, 106
orçamentos). Executados via API REST com o `access_token` de sessão de cada um —
nenhum destes testes precisa do CRM estar ligado ao Supabase Auth, correm à parte.

### Positivos — devem ter sucesso

| # | Quem | Ação | Resultado esperado |
|---|---|---|---|
| P1 | Paulo | `GET /rest/v1/ob_orcamentos` | 577 linhas |
| P2 | Paulo | `PATCH` num orçamento do Rui | sucesso |
| P3 | Paulo | `POST` novo orçamento com `owner_id` = Humberto | sucesso |
| P4 | Paulo | `DELETE` num orçamento (de teste, não real) | sucesso |
| P5 | Rui | `GET /rest/v1/ob_orcamentos` | 220 linhas, todas `vendedor="Rui Mota"` |
| P6 | Rui | `PATCH` num orçamento próprio (ex: campo `obs`) | sucesso |
| P7 | Rui | `POST` novo orçamento com `owner_id` = ele próprio | sucesso |
| P8 | Humberto | `GET /rest/v1/ob_orcamentos` | 106 linhas, todas `vendedor="Humberto Estrelinha"` |
| P9 | Humberto | `PATCH` num orçamento próprio | sucesso |

### Negativos — devem ser bloqueados

| # | Quem | Ação | Resultado esperado |
|---|---|---|---|
| N1 | Rui | `GET /rest/v1/ob_orcamentos?id=eq.<id-do-Humberto>` | `[]` (bloqueio à linha, não só à lista) |
| N2 | Rui | `PATCH` num orçamento do Humberto | 0 linhas afetadas / 403 |
| N3 | Rui | `DELETE` num orçamento próprio | bloqueado — nenhum comercial apaga fisicamente |
| N4 | Rui | `POST` novo orçamento com `owner_id` = Humberto | bloqueado pelo `WITH CHECK` do INSERT |
| N5 | Rui | `PATCH` num orçamento próprio a mudar `owner_id` para Humberto | bloqueado pelo `WITH CHECK` do UPDATE (não consegue "ver" o novo dono) |
| N6 | *(sem login, só chave anon)* | `GET /rest/v1/ob_orcamentos` | `[]` — fecha o acesso anónimo que existia antes |
| N7 | *(sem login, só chave anon)* | `POST` novo orçamento | bloqueado — `created_by = auth.uid()` nunca é verdade sem sessão |
| N8 | Humberto | `GET /rest/v1/ob_orcamentos?id=eq.<id-do-Rui>` | `[]` |

**Critério de aprovação:** os 9 positivos têm de ter sucesso E os 8 negativos têm de
ser bloqueados — qualquer desvio nos dois sentidos é motivo para reverter (secção 4)
antes de insistir.

---

## 4. Rollback

```sql
begin;
drop policy if exists ob_orcamentos_select on public.ob_orcamentos;
drop policy if exists ob_orcamentos_insert on public.ob_orcamentos;
drop policy if exists ob_orcamentos_update on public.ob_orcamentos;
drop policy if exists ob_orcamentos_delete on public.ob_orcamentos;
create policy ob_orcamentos_open on public.ob_orcamentos for all using (true) with check (true);
commit;
```
Restaura o comportamento anterior por completo. Não apaga nem altera nenhum dado —
é só a troca das políticas, nos dois sentidos.

---

## 5. Funcionalidades obrigatórias da Fase 4 (autenticação real no CRM)

Login, sessão, recuperação e troca de password, tudo dentro do próprio `index.html`,
sem solução interina separada — como confirmaste. Lista do que essa fase tem de
entregar, para o acesso real poder ser liberado às 3 contas:

1. **Substituir por completo o login falso** — remover `LOGIN_PASSWORDS` e
   `loginComSenha()` (comparação de string no browser); o ecrã de login passa a
   chamar `supabase.auth.signInWithPassword({ email, password })`.
2. **Sessão real** — `CU`/`_adminUser` deixam de vir do array `USERS` local; passam a
   ser derivados da sessão Supabase Auth + da linha correspondente em `ob_profiles`
   (`role`, `department`, `manager_id`, `active`).
3. **Persistência e refresh automático da sessão** — usar o comportamento por omissão
   do `supabase-js` (guarda a sessão, renova o token sozinho), para a pessoa não ter
   de fazer login todos os dias.
4. **Logout real** — `supabase.auth.signOut()`, com o token a deixar de ser aceite
   pela API a partir desse momento (já validado no plano de testes da secção 2 do
   ficheiro `fase2-ficha-testes-migration8-passwords.md`).
5. **Troca de password no primeiro acesso** — depois do login com a password
   temporária, ecrã/fluxo a chamar `supabase.auth.updateUser({ password })`.
6. **"Esqueci-me da password"** — `supabase.auth.resetPasswordForEmail(email)` +
   uma rota/ecrã dentro do próprio CRM que recebe o link de recuperação e trata o
   token (chama `updateUser`).
7. **Todas as queries ao Supabase passam a usar o cliente autenticado** — hoje várias
   partes do `index.html` usam `CRM_SB_KEY` (chave anon fixa) diretamente; têm de
   passar a usar a sessão da pessoa logada, para a RLS ter alguém real para avaliar.
8. **Tratamento de "conta sem perfil"** — se alguém tiver `auth.users` mas não
   `ob_profiles` (ex: convite aceite sem `ob_role` nos metadados), o CRM tem de dar um
   erro claro em vez de falhar silenciosamente.
9. **Tratamento de conta desativada/banida** — mensagem clara em vez de um erro
   genérico, para quando `active=false` (depois de essa verificação ser ligada às
   funções, já proposto e ainda não aplicado) ou a conta estiver banida no Supabase
   Auth.
10. **Decisão separada, não técnica:** só depois disto tudo validado é que faz
    sentido decidir tirar o site do modo de manutenção — não faz parte da Fase 4
    em si, mas é o que a torna útil na prática.

Nenhum destes 10 pontos foi implementado — é a lista do que falta, para quando a Fase
4 for autorizada a começar.

---

## Resumo

| Pedido | Estado |
|---|---|
| SQL completo da migration #8 | ✅ Secção 1 |
| Comparação atual vs. proposta | ✅ Secção 2 |
| Testes positivos e negativos | ✅ Secção 3 |
| Rollback | ✅ Secção 4 |
| Lista de funcionalidades obrigatórias da Fase 4 | ✅ Secção 5 |
| SQL executado | ❌ Nenhum |
| RLS alterada | ❌ Nenhuma |
| Deploy | ❌ Nenhum |
| Migration #7 | ❌ Continua bloqueada |
