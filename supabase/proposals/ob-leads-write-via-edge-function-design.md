# Proteger `ob-leads` contra escrita genérica autenticada — desenho técnico

**Estado: PROPOSTA, NÃO APLICADA. Nenhum código, policy ou dado foi alterado
nesta etapa.** Este documento + os dois ficheiros irmãos
(`ob-leads-restrict-authenticated-write.sql` e o rascunho
`supabase/functions/crm-lead-ops/index.ts.draft`) são só para revisão.

## 1. Risco confirmado

A correção anterior (`2b06037`, migration `ob_leads_remove_anon_write`) fechou
a escrita **anónima** em `ob-leads`. Falta o mesmo problema para
`authenticated`:

- `ob_crm_dados_insert_comercial` (INSERT, `roles={authenticated}`) e
  `ob_crm_dados_update_comercial` (UPDATE, `roles={authenticated}`) só
  verificam `chave = ANY(['ob-leads','ob-crm-atividades','ob-crm-historico','ob-clients'])
  AND (ob_is_admin() OR ob_current_role()='comercial')`. Nenhuma das duas
  policies restringe **quais linhas** dentro dessa chave, nem exige que o
  `updated_at` do pedido bata certo com o valor atual — isso é só uma
  convenção do código (`obSbPushLeadsSeguro()`), não uma regra da base de
  dados.
- Confirmado por leitura direta do código atual (`index.html`,
  `obSbPushLeadsSeguro()`, linhas ~30246-30318, branch
  `preview-financeiro-real-completo`): a proteção por `updated_at` é um
  `.eq('updated_at', versao.updated_at)` **escrito no JavaScript que corre no
  browser**. Nada a nível de RLS obriga um cliente a incluir essa condição.

**Consequência prática:** qualquer sessão `authenticated` válida com papel
`comercial` ou `admin` — mesmo de uma aba/deploy antigo que nunca correu o
código corrigido, ou de um pedido manual (curl/Postman/DevTools) com um
token ainda não expirado — pode:

- `POST /rest/v1/ob_crm_dados?on_conflict=chave` com
  `{chave:'ob-leads', dados:[...qualquer coisa...], updated_at:...}` →
  avaliado só contra `ob_crm_dados_insert_comercial` → **substitui o array
  inteiro sem condição nenhuma** (upsert por `on_conflict` não lê o estado
  anterior).
- `PATCH /rest/v1/ob_crm_dados?chave=eq.ob-leads` (sem `&updated_at=eq....`
  no URL) com `Authorization: Bearer <sessão válida>` → avaliado só contra
  `ob_crm_dados_update_comercial` → **substitui o array inteiro**, sem
  verificação de concorrência nenhuma a nível de base de dados.

Isto é exatamente o mecanismo já documentado como causa raiz do incidente de
09-10/09 (seeds fictícios reaparecidos, estados reais revertidos) — a
correção de código resolveu-o para o app atual, mas não fechou a porta a
nível de RLS para qualquer OUTRO cliente autenticado que fale diretamente
com `/rest/v1/ob_crm_dados`.

## 2. `obSbPushLeadsSeguro()` hoje — como grava e dependências

(Código lido em `index.html:30169-30318`, branch
`preview-financeiro-real-completo` — não alterado nesta etapa.)

- `crmRegistarOperacaoLead(tipo, id)` — acumula `{tipo:'upsert'|'delete', id}`
  em `window._crmOperacoesLeadsPendentes`. 4 pontos de chamada reais:
  `crmDrop()` (kanban), `crmSaveLead()` (criar/editar), `crmDeleteLead()`
  (apagar), e o fluxo de "marcar como Ganho" (~linha 17364).
- `obSbPush('ob-leads')` — debounce de 2.5s, chama `obSbPushLeadsSeguro()`.
- `obSbPushLeadsSeguro()`:
  1. Exige sessão autenticada real (`crmSBClient()` + `CU.id`) — sem isso,
     bloqueia por inteiro, fila fica para a próxima tentativa.
  2. Lê o remoto fresco via `obLerRemotoComVersao('ob-leads')`
     (`select dados,updated_at ... .maybeSingle()`, RLS `authenticated`
     aplica-se — usa `ob_crm_dados_select_comercial`, que **não** é tocada
     por esta proposta).
  3. Aplica as operações pendentes sobre esse array remoto
     (`crmAplicarOperacaoLeadSobreRemoto`, reduce puro, local).
  4. Grava: `.upsert(...)` se a linha ainda não existir, ou
     `.update({dados,updated_at}).eq('chave','ob-leads').eq('updated_at', versao.updated_at)`
     caso já exista — **é aqui que a proteção por versão vive hoje, e é só
     uma condição no `WHERE` do lado do cliente.**
  5. 0 linhas devolvidas = conflito → tenta mais 1 vez com leitura fresca;
     nunca força.
  6. Sucesso → sincroniza `crmLeads`/`leads`/`localStorage['ob-leads']` com o
     array **confirmado pelo Supabase** (não com o calculado localmente).

Dependências diretas: `crmSBClient()`, `CU`/`cu.id`, a fila
`window._crmOperacoesLeadsPendentes`, `crmAplicarOperacaoLeadSobreRemoto()`,
`obLerRemotoComVersao()`, e o cliente `supabase-js` autenticado a falar
diretamente com a tabela.

## 3. Desenho da solução mínima

Duas metades, as duas necessárias — uma sem a outra não resolve:

### 3a. Base de dados — fechar a escrita direta, manter a leitura

Remover `'ob-leads'` do array de chaves em **`ob_crm_dados_insert_comercial`**
e **`ob_crm_dados_update_comercial`** (mesmo padrão já aplicado ao `anon` em
`2b06037`, via `ALTER POLICY`). Ver
`ob-leads-restrict-authenticated-write.sql`.

- `ob_crm_dados_select_comercial` **não é tocada** — leitura direta de
  `ob-leads` por `authenticated` continua a funcionar exactamente como hoje
  (hidratação/`crmHidratarLeadsCanonico()` não precisa de mudar).
- Depois desta alteração, **nenhum** cliente PostgREST — nem `anon`, nem
  `authenticated` de qualquer papel, incluindo admin — consegue fazer
  INSERT/UPDATE direto em `ob_crm_dados` para `chave='ob-leads'`. Só
  `service_role` (que ignora RLS por `rolbypassrls=true`, já confirmado)
  continua a poder escrever.

### 3b. Nova Edge Function — único caminho de escrita

Nova função, ex. `crm-lead-ops` (nome a confirmar), no mesmo padrão de
`crm-lead-intake` (já existe e já usa `service_role` — fica intocada):

- `verify_jwt: true` — o gateway do Supabase já rejeita tokens inválidos ou
  expirados antes de a função correr (cobre sozinho o caso "aba com sessão
  expirada", sem precisar de código extra).
- Recebe `{ operacao: 'create'|'update'|'delete', id, lead }` — nunca o array
  inteiro. Para `create`/`update`, `lead` é o objeto do lead tal como o
  frontend já o tem localmente (mesmo shape que hoje vai para
  `crmAplicarOperacaoLeadSobreRemoto`); para `delete`, só o `id`.
- Verifica o papel do autor: extrai o `sub` do JWT do pedido, consulta
  `ob_profiles` com `service_role` (o mesmo padrão de
  `crmSBClient`/`ob_is_admin()`, só que em código em vez de RLS) e exige
  `role IN ('admin','comercial')` — replica exatamente a condição que hoje
  vive em `ob_crm_dados_update_comercial`.
- Lê `ob_crm_dados` para `chave='ob-leads'` com `service_role` (mesmo
  `lerBlob()` já usado em `crm-lead-intake`), aplica só a operação pedida
  (porta server-side a mesma lógica de `crmAplicarOperacaoLeadSobreRemoto` —
  substituir por id ou acrescentar; remover por id), e grava com o mesmo
  padrão de "ler-aplicar-gravar com retry" já usado em
  `gravarLeadComProtecaoDeCorrida()` — 2 tentativas, nunca força. Como a
  leitura e a escrita acontecem as duas dentro da função (não há round-trip
  ao browser entre elas), a janela de corrida fica mais curta do que hoje,
  não mais larga.
- Regista a operação em `ob-crm-atividades` (mesmo padrão já existente em
  `crm-lead-intake`) — mantém histórico/auditoria.
- Devolve o lead final confirmado (ou o array completo, a decidir) para o
  frontend sincronizar `crmLeads`/`localStorage`.

`crm-lead-intake` fica **completamente intocada** — já usa `service_role`,
já não depende de nenhuma policy `authenticated`/`anon`, esta proposta não
lhe muda nada.

## 4. Funções/policies a alterar (resumo)

| Item | Ação |
|---|---|
| `ob_crm_dados_insert_comercial` | `ALTER POLICY` — remove `'ob-leads'` do `with_check` |
| `ob_crm_dados_update_comercial` | `ALTER POLICY` — remove `'ob-leads'` do `using`/`with_check` |
| `ob_crm_dados_select_comercial` | Sem alteração |
| Nova edge function `crm-lead-ops` | A criar (rascunho anexo, não implantada) |
| `crm-lead-intake` | Sem alteração |
| `obSbPushLeadsSeguro()` | A reescrever (ver secção 5) |
| `crmRegistarOperacaoLead`, `crmDrop`, `crmSaveLead`, `crmDeleteLead`, fluxo "Ganho" | Sem alteração nos pontos de chamada — continuam a só registar `{tipo,id}` |
| `obLerRemotoComVersao('ob-leads')` / hidratação | Sem alteração — leitura direta continua permitida |

## 5. Impacto no código atual

- `obSbPushLeadsSeguro()` deixa de fazer `sb.from('ob_crm_dados').upsert/update(...)`
  diretamente. Passa a, para cada operação pendente, chamar
  `sb.functions.invoke('crm-lead-ops', { body: { operacao, id, lead } })` —
  o cliente `supabase-js` já anexa automaticamente o `Authorization` da
  sessão atual, sem código extra de auth.
- Múltiplas operações pendentes no mesmo ciclo de debounce (hoje reduzidas
  numa única escrita) passam a ser N chamadas sequenciais à função — cada
  uma individualmente segura (mesmo padrão do `crm-lead-intake`), só deixa
  de ser uma única escrita atómica para o lote inteiro. Impacto esperado:
  irrelevante em uso normal (raramente há mais de 1 operação pendente ao
  mesmo tempo neste CRM).
- `obLerRemotoComVersao()`, `crmHidratarLeadsCanonico()`, e os 4 pontos de
  chamada de `crmRegistarOperacaoLead()` **não mudam**.
- Erros de rede/HTTP da função devem manter o mesmo contrato atual (falha →
  operações voltam para a fila, nada fica só local sem tentativa futura).

## 6. Plano de implementação e testes (para quando for aprovado)

1. Implementar `crm-lead-ops` (a partir do rascunho anexo), deploy.
2. Testar a função isoladamente (sessão real comercial/admin) — create,
   update, delete, incluindo o caso de conflito de concorrência (duas
   chamadas quase simultâneas).
3. Testar rejeição: token inválido/expirado (gateway `verify_jwt`), sessão
   válida mas papel fora de `admin`/`comercial`.
4. Só depois: aplicar o `ALTER POLICY` das duas policies (secção 3a) — pela
   ordem certa, para nunca haver uma janela em que a escrita antiga já não
   funcione e a nova função ainda não exista.
5. Reescrever `obSbPushLeadsSeguro()` para usar a função, testar os 4 fluxos
   reais (`crmDrop`, `crmSaveLead` criar/editar, `crmDeleteLead`, "Ganho").
6. Teste de regressão do bloqueio: repetir exatamente os pedidos
   POST/PATCH diretos usados nos testes anteriores (`BEGIN...ROLLBACK`, role
   `authenticated` com JWT de um `comercial`/`admin` real) e confirmar 0
   linhas afetadas / erro, tal como já feito para `anon` em `2b06037`.
7. Confirmar `ob-crm-atividades` a registar as operações da nova função.
8. Confirmar que o lead de teste atual não é tocado em nenhum passo.
