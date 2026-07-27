# Fase 2 — Ficha de utilizadores, checklist de testes, migration #8 e passwords

Preparação pura, nada executado: sem SQL corrido, sem contas criadas, sem RLS
alterada, sem avanço para a migration #7.

---

## 1. Ficha final dos três utilizadores

| Campo | Paulo Faria | Rui Mota | Humberto Estrelinha |
|---|---|---|---|
| Email | `paulofaria@opportunitybox.pt` | `ruimota@opportunitybox.pt` | `humberto@opportunitybox.pt` |
| `full_name` | Paulo Faria | Rui Mota | Humberto Estrelinha |
| `role` | `admin` | `comercial` | `comercial` |
| `department` | Direcção | Comercial | Comercial |
| `manager_id` previsto | *(vazio)* | *(vazio)* | *(vazio)* |
| Porquê `manager_id` vazio | É `admin` — vê tudo independentemente de ter gestor | Ninguém tem hoje `role='manager'`; não há a quem atribuir | Idem |
| Orçamentos antigos previstos (migration #7) | 251 | 220 | 106 |

Se no futuro alguém ficar com `role='manager'` e Rui/Humberto passarem a reportar-lhe,
o `manager_id` é definido com o `UPDATE` isolado já documentado (secção 2.4 do
ficheiro `fase2-funcoes-rpc-e-convites.md`) — não interfere com nada disto.

---

## 2. Checklist de testes reais — por papel

Corre-se com as 3 contas reais, depois de `ob_profiles` estar confirmado (não antes).
Usa o próprio browser/Postman com o `access_token` de sessão de cada pessoa — não é
preciso nenhuma alteração ao CRM para estes testes, porque usam a API REST do
Supabase diretamente.

### Checklist — Comercial (Rui e Humberto, cada um em separado)

- [ ] Login com email + password temporária funciona
- [ ] Cria um cliente de teste em `ob_clientes` (`owner_id`/`created_by` = o próprio) — sucesso
- [ ] `GET /rest/v1/ob_clientes` — só vê os próprios registos, não os do colega
- [ ] `GET /rest/v1/ob_clientes?id=eq.<id-do-colega>` — devolve `[]` (bloqueio ao nível da linha, não só da lista)
- [ ] Edita um registo próprio — sucesso
- [ ] Tenta editar um registo do colega (`PATCH`) — bloqueado
- [ ] Tenta apagar fisicamente um registo, mesmo sendo próprio (`DELETE`) — bloqueado (sem DELETE físico para não-admin, em nenhuma das 5 tabelas)
- [ ] Tenta reatribuir `owner_id` de um registo próprio para outra pessoa — bloqueado (a política `WITH CHECK` exige que também consiga "ver" o novo dono)
- [ ] `GET /rest/v1/ob_orcamentos` (depois da migration #7 e #8) — só vê os orçamentos próprios (220 para o Rui, 106 para o Humberto)
- [ ] Logout — o token deixa de ser aceite em pedidos seguintes

### Checklist — Admin (Paulo e Edna, cada um em separado)

- [ ] Login funciona
- [ ] `GET /rest/v1/ob_clientes` — vê os registos de teste do Rui **e** do Humberto
- [ ] `GET /rest/v1/ob_orcamentos` (pós #7/#8) — vê os 577, não só os 251 próprios
- [ ] Edita um registo de outra pessoa — sucesso
- [ ] Apaga fisicamente um registo de teste — sucesso (só admin tem esta permissão; nota: a eliminação lógica com `deleted_at`/`deleted_by` já existe como coluna mas ainda não está a ser aplicada por nenhuma política — hoje "apagar" para o admin continua a ser `DELETE` físico, até essa migração adicional ser aprovada)
- [ ] Consegue corrigir o `role`/`department` de outro utilizador em `ob_profiles`
- [ ] Consegue consultar `ob_profiles` de toda a gente (não só o próprio)

**Limpeza:** qualquer cliente/lead de teste criado durante estes testes deve ser
apagado por um admin no final, para não poluir dados reais — o `DELETE` físico feito
por um admin é exatamente para isto que serve.

---

## 3. Análise completa da migration #8 — `ob_orcamentos_tighten_rls`

**Não corrida.** Só pode acontecer depois de: (a) migration #7 concluída e validada
por ti, e (b) confirmação expressa adicional — o pedido de hoje é só a análise.

### Pré-condição obrigatória

Todos os 577 orçamentos têm de ter `owner_id` preenchido (resultado esperado da
migration #7, já validado na prévia: 251+220+106=577, zero órfãos). Se por alguma
razão sobrar algum `owner_id` nulo nessa altura, essa linha fica visível **só para
admin** depois desta migração (comportamento seguro por omissão, não um bug) — mas o
ideal é confirmar zero nulos antes de avançar.

### SQL exato (preparado, não corrido)

```sql
drop policy if exists ob_orcamentos_open on public.ob_orcamentos;

create policy ob_orcamentos_select on public.ob_orcamentos
  for select using ( ob_can_see(owner_id) );

create policy ob_orcamentos_insert on public.ob_orcamentos
  for insert with check (
    created_by = auth.uid()
    and (ob_is_admin() or owner_id = auth.uid())
  );

create policy ob_orcamentos_update on public.ob_orcamentos
  for update using ( ob_can_see(owner_id) ) with check ( ob_can_see(owner_id) );

create policy ob_orcamentos_delete on public.ob_orcamentos
  for delete using ( ob_is_admin() );
```

Nota sobre o `INSERT`: um comercial só consegue criar um orçamento atribuído a si
próprio (`owner_id = auth.uid()`); um admin pode criar e atribuir a qualquer pessoa.
Isto está mais refinado do que a versão inicial que tínhamos esboçado (que só exigia
`created_by = auth.uid()`, sem restringir a quem o orçamento ficava atribuído).

Nota sobre o `UPDATE`: a condição `WITH CHECK (ob_can_see(owner_id))` aplica-se ao
**novo** valor da linha — isto impede, de propósito, que um comercial "ofereça" ou
"roube" um orçamento reatribuindo `owner_id` para outra pessoa que ele não gere,
porque teria de conseguir "ver" esse novo dono para a alteração ser aceite.

### Tabelas afetadas

Só `ob_orcamentos` — política, não estrutura nem dados. As 577 linhas não são tocadas
por esta migração (isso já aconteceu, ou não, na #7).

### Impacto esperado

- **Este é o corte real.** Antes desta migração, `ob_orcamentos_open` permite acesso
  total via chave anon, sem sessão nenhuma. Depois, só quem tiver sessão Supabase Auth
  válida (e, dentro disso, só aos orçamentos que lhe pertencem, salvo admin) consegue
  ler ou escrever.
- **Isto quebra, de propósito, o acesso `anon`** que hoje o `index.html` usa para
  sincronizar orçamentos (`_ORC_SB_URL`/`_ORC_SB_KEY`, sem login). Não é um efeito
  secundário indesejado — é o objetivo desta migração. Mas confirma que o CRM só deve
  ficar sem esta dependência **depois** da Fase 4 (login real integrado no `index.html`)
  estar pronta, senão a sincronização de orçamentos do site (ainda em manutenção)
  passa a falhar silenciosamente assim que voltar ao ar.

### Risco

**Alto**, pelas razões acima — é a primeira migração de todas que efetivamente fecha
uma porta que hoje está aberta. Por isso o pedido de aprovação expressa adicional (já
combinado) faz todo o sentido, independentemente desta análise estar pronta.

### Teste a executar depois

Usar as contas reais (secção 2 acima), mas contra dados reais em vez de registos de
teste, já que sabemos os números exatos esperados:

```
Paulo (admin):     GET /rest/v1/ob_orcamentos → 577 linhas
Rui (comercial):    GET /rest/v1/ob_orcamentos → 220 linhas, todas com vendedor="Rui Mota"
Humberto (comercial): GET /rest/v1/ob_orcamentos → 106 linhas, todas com vendedor="Humberto Estrelinha"
```

Qualquer desvio destes números é motivo para reverter imediatamente (ver rollback) e
investigar antes de tentar de novo.

### Rollback

```sql
drop policy if exists ob_orcamentos_select on public.ob_orcamentos;
drop policy if exists ob_orcamentos_insert on public.ob_orcamentos;
drop policy if exists ob_orcamentos_update on public.ob_orcamentos;
drop policy if exists ob_orcamentos_delete on public.ob_orcamentos;
create policy ob_orcamentos_open on public.ob_orcamentos for all using (true) with check (true);
```
Restaura o comportamento anterior por completo, sem tocar em nenhum dado.

---

## 4. Como cada utilizador poderá alterar a password temporária — confirmação honesta

Preciso de ser direto aqui: **hoje, "no CRM" isto ainda não é possível**, porque o
`index.html` (o ficheiro que o Netlify publica) **não está ligado ao Supabase Auth**
para o login principal — o login que lá existe é o mecanismo antigo e inseguro
(`LOGIN_PASSWORDS`) que identificámos na auditoria inicial, completamente
independente das contas que estamos a criar agora. Ligar o CRM a sessões reais do
Supabase Auth é precisamente o trabalho da **Fase 4** ("adaptar o CRM"), que ainda não
começou nem foi autorizada.

### O que existe, mecanicamente, sem depender da Fase 4

O Supabase Auth já suporta nativamente, e não depende de nenhum código do CRM:

- `supabase.auth.updateUser({ password: novaPassword })` — muda a password de quem já
  está autenticado (precisa de sessão ativa, ou seja, de ter feito login primeiro com
  a temporária).
- `supabase.auth.resetPasswordForEmail(email)` — envia um email com um link de
  recuperação; ao clicar, a pessoa é levada para uma página que trata o token e chama
  `updateUser`.

O problema é que **nenhuma destas chama nenhuma página nossa hoje**, porque não existe
nenhuma página (nem dentro nem fora do CRM) preparada para isso.

### As opções reais, agora

1. **Interina, sem construir nada novo (recomendada para já):** tu, como admin, envias
   um "Reset password" a partir do próprio Dashboard (`Authentication → Users →
   pessoa → Send password recovery`, se essa opção existir na tua versão, ou
   simplesmente defines outra password temporária e voltas a entregar) sempre que for
   preciso, até a Fase 4 estar pronta. Não implica nenhum código novo nem deploy.
2. **Uma página mínima e isolada** (não faz parte do `index.html`/`main` nem toca em
   produção) só com um formulário "mudar password", usando `supabase-js` e as duas
   chamadas acima — eu posso preparar o código, mas **publicá-la é um deploy**, e
   disseste explicitamente para não fazer deploy nenhum agora. Fica só como opção,
   não avanço com isto sem pedires.
3. **Definitiva (Fase 4):** o ecrã de login do `index.html` passa a ser o do Supabase
   Auth a sério, com "mudar password no primeiro acesso" e "esqueci-me da password"
   integrados — parte do trabalho maior de substituir o login falso, ainda por
   autorizar.

**Resumo direto à tua pergunta:** hoje, a forma real de cada um mudar a password
temporária é através de um novo "Send password recovery"/reset feito por um admin no
Dashboard, ou tu definires outra diretamente — não existe ainda nenhum caminho "dentro
do CRM" para eles próprios o fazerem, e construir esse caminho é trabalho de Fase 4.

---

## Resumo

| Pedido | Estado |
|---|---|
| 1. Ficha final dos 3 utilizadores | ✅ Secção 1 |
| 2. Checklist de testes admin/comercial | ✅ Secção 2 |
| 3. Análise completa da migration #8 | ✅ Secção 3 — SQL, impacto, risco, teste, rollback |
| 4. Como mudar a password temporária | ✅ Secção 4 — resposta honesta: não existe ainda "no CRM", só via Dashboard até à Fase 4 |
| SQL executado | ❌ Nenhum |
| Contas criadas | ❌ Nenhuma |
| RLS alterada | ❌ Nenhuma |
| Migration #7 | ❌ Continua bloqueada |
