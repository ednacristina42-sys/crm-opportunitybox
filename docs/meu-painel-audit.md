# H — Meu Painel Real — Auditoria Completa

Data: 2026-09-14
Âmbito: `index.html` (branch `dev-seguranca-f2-f3-12set`), ecrã "Meu Painel" (`#page-meu-painel`, função `renderMeuPainel()`).
Método: leitura de código (Grep/Read) + consultas `SELECT` de confirmação ao Supabase (projeto `ddzlbmnmsdyodouqxbjx`). **Nenhuma escrita foi feita em `index.html` nem na base de dados.** Nenhum commit foi criado.

---

## 1. Como o ecrã é montado

- HTML: `#page-meu-painel`, linhas **7308-7423** de `index.html`.
- JS: `renderMeuPainel()`, linhas **30439-30632** (chamada por `goPage('meu-painel')` na linha **11859**, no boot em `crmEnterAppWithProfile()` via `safe(renderMeuPainel,'meu-painel')` na linha **21101**, e por `crmDeleteAtividade()` na linha 13755).
- `renderMeuPainel()` não faz queries — lê exclusivamente de variáveis já carregadas em memória: `CU`, `orcData`, `crmAtividades`, `TES_RECEBER`, `AG_FILTROS`/`agListaUnificada()`.
- Funções auxiliares chamadas: `obPodeVerFinanceiro()` (30368), `mpRenderLembretesHoje()` (31324), `agRenderTopHoje()`→`agObterTopHoje()` (32161/32057), `agRenderCentroUnificado()`→`agListaUnificada()`→`agListaCanonica()` (31836/31760/31727), `mp2RenderCarteira()` (32325), `mp2RenderRiscoResumo()` (32346), `mp2RenderProximosSete()` (32365), `fuOrcamentosAtivos()` (32738), `obOrcUltimaAtividade()` (32554), `fuPrioridade()` (32583), `tesEstaVencido()` (23487), `tocoMergeFaturasCacheReceber()` (24076).
- Identidade: `CU` é construído em `crmBuildCUFromProfile()` (linhas 2613-2626) a partir de uma leitura real de `ob_profiles` (`crmAuthLoadProfile()`, linhas 2540-2549, `SELECT id, full_name, email, role, department, manager_id, active FROM ob_profiles WHERE id = <auth.uid()>`). O gate `CRM_AUTH_GATE_ENABLED=true` (linha 2563) está fixo a `true` no ficheiro atual, pelo que o caminho legado (`loginComSenha`/`USERS`/`LOGIN_PASSWORDS`, linha 11546) está desativado na prática — `CU` vem sempre de `ob_profiles`.

---

## 2. Bloco A — Identidade do utilizador

| Campo no Meu Painel | Fonte | Confere com `ob_profiles`? |
|---|---|---|
| Nome (saudação, avatar) | `CU.name` = `profile.full_name` | Sim |
| Role/admin | `CU.role`/`CU.admin` = `profile.role==='admin'` | Sim |
| Departamento | `CU.dept` = `profile.department` | Sim |
| ID (uuid) | `CU.id` = `profile.id` | Sim (= `auth.users.id`) |

`crmBuildCUFromProfile()` também define `CU.color='#F5C400'` e `CU.online=true` de forma fixa (não vêm de `ob_profiles`, que não tem essas colunas) — são valores decorativos usados noutras UI (avatar/presença), não afetam os KPIs do Meu Painel.

**Classificação: ✅ REAL E CORRETO.**

---

## 3. Bloco B — Orçamentos

- `orcData` é carregado por `_sbOrcLoadAll()` (linha 17794-17856), `SELECT * FROM ob_orcamentos ORDER BY created_at DESC LIMIT 2000` — **sem** `.eq('owner_id', ...)`, isto é, depende inteiramente da RLS (`ob_can_see(owner_id)`) da sessão autenticada para restringir as linhas devolvidas a um comercial. Confirmado que o mapeamento de cada linha **inclui** `owner_id` (linha 17843: `owner_id: row.owner_id || null`).
- Em `renderMeuPainel()` (linhas 30443-30448), o corte "meus vs todos" é feito assim:
  ```js
  var nome=(typeof CU!=='undefined'&&CU)?CU.name:null;
  var minhas=function(v){ return isAdmin||!nome||v===nome; };
  var minhasOrc=orcAll.filter(function(o){ return minhas(o.vendedor); });
  ```
  ou seja, compara `CU.name` (texto vindo de `ob_profiles.full_name`) com `o.vendedor` (texto livre gravado no orçamento) — **não usa `o.owner_id === CU.id`**, apesar de `owner_id` já estar disponível no objeto. O mesmo padrão repete-se em `fuMinhasOrc()` (linha 32754-32758), `agListaCanonica()`/`agObterTopHoje()` (linha 32015, comparando `it.comercial===comercialAlvo`, onde `comercial:o.vendedor`), e em `mp2RenderProximosSete()` (linha 30445/32371).
- KPIs afetados por este padrão: "Valor em negociação", "Ticket médio", "Follow-ups hoje", "Clientes em risco", "Negócios em aberto" (pendentes), "Minha carteira", "Faça agora"/Top Hoje.
- **Confirmação com dados reais (SQL, só leitura)**: comparando `owner_id` (a fonte correta, confirmada nas rondas F6) com `vendedor` (texto):

  | Comercial (`ob_profiles.full_name`) | Orçamentos por `owner_id` | Orçamentos onde `vendedor` bate |
  |---|---|---|
  | Rui Mota | 315 | 315 |
  | Paulo Faria (admin) | 302 | 302 |
  | Humberto Estrelinha | 168 | 168 |
  | Edna Faria (admin) | 1 | **0** |
  | André Nolasco | 0 | 0 |

  O único registo de Edna Faria por `owner_id` (`ORC-719-2026OB`) tem `vendedor='Paulo Faria'` — um caso real de divergência entre o dono real (`owner_id`) e o texto `vendedor`. Não tem impacto visível para Edna porque ela é admin (`isAdmin` ignora o filtro), mas prova que a divergência **existe em produção** e não é apenas teórica: se um comercial (não-admin) tivesse um orçamento nestas condições, ele desapareceria silenciosamente do seu Meu Painel apesar de lhe pertencer segundo a RLS/`owner_id`.

**Classificação: 🐞 BUG ATUAL** (ver detalhe na secção "Bugs" abaixo — Bug B1).

---

## 4. Bloco C — Follow-up

- `_fuTriagemPorOrc` é carregado por `SELECT orcamento_id, reativado, classificacao FROM ob_orcamento_triagem` (linhas 32594-32615) — depende da RLS da tabela (que por sua vez usa `ob_can_see`, confirmado nas rondas F6) para restringir linhas.
- As ações do utilizador (`fu_classificar`, `fu_classificar_e_reativar`, `fu_confirmar_estado`, `fu_desativar_followup`, `fu_reativar_simples`) chamam sempre as RPCs correspondentes (linhas 32852-32892), que por sua vez validam `ob_can_see(v_owner)` no servidor.
- O card "Follow-ups hoje"/"Faça agora" no Meu Painel, porém, não itera diretamente `ob_orcamento_triagem` — deriva de `fuOrcamentosAtivos()` (sobre `orcData`) cruzado com `_fuTriagemPorOrc`, e o corte "meu vs todos" continua a ser feito por `o.vendedor===CU.name` (mesmo padrão do Bloco B).
- Conclusão: a leitura de base (RLS em `ob_orcamento_triagem`/`ob_orcamentos`) está correta, mas o filtro de exibição adicional no Meu Painel herda o mesmo bug de texto do Bloco B.

**Classificação: ✅ REAL E CORRETO** quanto à origem (RPCs/RLS corretas) · **🐞 BUG ATUAL** herdado do Bloco B quanto ao corte "meus" (mesmo Bug B1, não duplicado como bug novo).

---

## 5. Bloco D — Tarefas

- Confirmado (Grep) que `public.ob_tasks` **nunca** é referenciada em `index.html` — zero ocorrências de `ob_tasks` no ficheiro inteiro.
- O HTML do Meu Painel (`#page-meu-painel`, linhas 7308-7423) **não tem nenhuma secção chamada "Tarefas"**. As secções existentes são: KPIs (Follow-ups/Negociação/Ticket/Risco), "Faça agora", "Minha carteira", "Próximos 7 dias", "Carteira que precisa de atenção", "Todas as prioridades", "Lembretes de Hoje", "Financeiro", "Últimas actividades".
- O comentário antigo nas linhas 7302-7306 menciona cards placeholder de uma fase inicial ("Meta do mês, Valor vendido, Valor por faturar, Valor por cobrar, Agenda, IA recomenda") que **já não existem** no HTML atual (substituídos pelo "Meu Painel v2" de 14/08/2026) — o comentário ficou desatualizado, mas não há nenhum card fantasma renderizado.

**Classificação: não existe** — não há bloco de Tarefas no Meu Painel. Não é um bug (nada finge ser real), é uma funcionalidade que simplesmente não foi implementada aqui. Documentado como tal, sem inventar.

---

## 6. Bloco E — Design/Produção/Instalações

- Confirmado (Grep) que `renderMeuPainel()` e todas as suas funções auxiliares **não referenciam** `ob_uni_items`, `_sbUniItemUpsert`, `_uniInitFromSB`, nem as páginas `design-ficheiros`/`fabrica-producao`/`fabrica-instalacoes`.
- Essas páginas existem como ecrãs próprios e independentes (`#page-design-ficheiros`, `#page-fabrica-producao`, `#page-fabrica-instalacoes`), com acesso controlado por departamento no menu lateral (linhas 11477-11478, 11806), mas **não aparecem no Meu Painel** de forma alguma.

**Classificação: não existe** no Meu Painel. Não há, portanto, o risco descrito no enunciado (um comercial ver itens de produção de outra pessoa através do Meu Painel) — porque o Meu Painel simplesmente não mostra esses dados.

---

## 7. Bloco F — Financeiro

- Único card financeiro no Meu Painel: **"💳 Por cobrar"** (`#mp-cobrar-card`, HTML linhas 7401-7412; lógica linhas 30535-30569).
- Gate de acesso: `obPodeVerFinanceiro()` (linhas 30368-30379) — regra explícita em JS (não confia apenas na RLS):
  ```js
  if(role.indexOf('comercial')>=0 || dept.indexOf('comercial')>=0) return false; // comerciais NUNCA veem financeiro
  return u.admin===true; // só admin (fora da área comercial) vê
  ```
  Se `!podeVerFin`, a secção inteira `#mp-fin-section` fica `display:none` (linha 30545) — nenhum valor é sequer calculado ou enviado para o DOM.
- Fonte de dados: `TES_RECEBER` — carregado da chave `ob_crm_dados['ob-tes-receber']` (confirmado no Canonical Data Map anterior; ver também `tesHidratarCanonico()` por volta da linha 23942 e `tocoMergeFaturasCacheReceber()` linha 24076). **Não é filtrado por comercial/owner** — o próprio comentário do código (linhas 30538-30540) reconhece isto: "TES_RECEBER não tem dono por comercial (só cliente) — por isso este card respeita a MESMA regra já existente no resto do CRM (`obPodeVerFinanceiro`): um comercial nunca vê dados financeiros, mesmo agregados, aqui incluído." Ou seja, é uma vista agregada de **toda a empresa**, mas só é mostrada a quem já tem permissão para ver dados globais — comportamento coerente, não um bug.
- Navegação: botão "Abrir Cobranças" → `goPage('tesouraria'); setTimeout(function(){ tesMostrarTab('receber') }, 200)` (linha 7409). `goPage('tesouraria')` dispara internamente `setTimeout(tesRender, 50)` (linha 26641) — como 200ms > 50ms, a aba "receber" é sempre selecionada depois do render base estar pronto. Testado por leitura de código; não há indício de corrida/1º-clique-em-branco aqui.

**Classificação: ✅ REAL E CORRETO** (fonte correta dada a granularidade disponível — `ob_crm_dados['ob-tes-receber']` não tem coluna de comercial —, gate de permissão explícito e coerente, navegação sem bug aparente).

---

## 8. Bloco G — Segurança/permissões

### G1. Orçamentos/Follow-up — RLS server-side está correta
`ob_orcamentos` e `ob_orcamento_triagem` são lidas com `SELECT *` sem filtro explícito de `owner_id` no cliente — dependem inteiramente da RLS (`ob_can_see(owner_id)`, confirmada nas rondas F6). Isto está correto **desde que a sessão seja mesmo autenticada** (via `crmSBClient()`, que usa a `anon key` + sessão persistida — não a `service_role`). Confirmado que `crmSBClient()` (linhas 2506-2512) usa `CRM_SB_KEY` (chave anon) com `auth.persistSession=true`, nunca uma chave que faça bypass de RLS.

### G2. Financeiro — gate explícito em JS, correto e redundante com boas intenções
`obPodeVerFinanceiro()` replica em JS a regra "comercial nunca vê financeiro", mesmo que o admin flag esteja true (comentário no código cita nomes reais de contas com admin=true que são comerciais). Isto é defesa em profundidade coerente com a leitura pretendida — não é um bug.

### G3. 🐞 Privacidade real — `crmAtividades` (usado em "Lembretes de Hoje", "Últimas actividades" e "Próximos 7 dias") não tem RLS por utilizador

Verificação feita diretamente na base de dados (`pg_policies`, projeto `ddzlbmnmsdyodouqxbjx`, só leitura):

```
ob_crm_dados_select_comercial (SELECT):
  qual = (chave = ANY (ARRAY['ob-leads','ob-crm-atividades','ob-crm-historico','ob-clients']))
         AND (ob_is_admin() OR ob_current_role() = 'comercial')
```

Ou seja: **qualquer** utilizador autenticado com `role='comercial'` (não só o admin) pode ler a linha inteira `ob_crm_dados` com `chave='ob-crm-atividades'`. Essa linha é um **único blob JSON com as atividades de TODOS os comerciais da empresa** (confirmado no código: `crmAtividades` é uma única variável global, gravada/lida como um único JSON via `obSbPush('ob-crm-atividades', crmAtividades)` e lida de volta inteira em `obSbLerRemoto`/no boot sync, linhas 33390-33520 e 33597-33617). A RLS filtra por **role**, não por **owner/autor** — não existe (nesta tabela, para esta chave) nenhuma cláusula equivalente a `ob_can_see`.

Na prática: um comercial normal (ex. Rui Mota) recebe no browser, em memória (`crmAtividades`), as atividades/lembretes de **todos** os outros comerciais (ex. Humberto Estrelinha), e o Meu Painel só **filtra visualmente** essa lista com `a.autor===CU.name` (linhas 30578-30580, 31329, 32372, 32388) antes de desenhar os cards "Lembretes de Hoje" e "Últimas actividades". Os dados de outros comerciais estão acessíveis a qualquer momento via consola do browser (`crmAtividades`), apesar de nunca aparecerem desenhados no ecrã. O mesmo problema, pela mesma política, afeta `ob-leads` e `ob-clients` (pipeline e carteira de clientes completos ficam acessíveis a todo o departamento Comercial, não só ao dono) — mas isso extravasa o Meu Painel e não foi investigado a fundo aqui (fica registado como observação relacionada, não como parte formal desta auditoria de Meu Painel).

**Classificação: 🐞 BUG ATUAL** — ver Bug G1 abaixo. É diferente do Bug B1: aqui o problema está na política de RLS da tabela (nível de base de dados), não no filtro JS em si (o filtro JS até está correto — só que os dados que filtra já chegaram indevidamente ao browser).

### G4. Vista de admin/manager
Confirmado: para `CU.admin===true`, todos os `minhas()`/`isAdmin||!nome` deixam passar tudo (orçamentos, atividades, follow-ups) — o admin vê o Meu Painel com dados de toda a equipa, sem paginação por comercial. Não há hoje um "modo manager" distinto que mostre só a equipa gerida (`ob_manages`) — é tudo-ou-nada (comercial vê só o seu / admin vê tudo). Isto é uma limitação, não um bug de segurança (o admin já tem acesso global por direito).

---

## 9. Bloco H — Botões e navegação

| Card/botão | Destino (`goPage`) | Filtro aplicado no destino | 1º clique funciona? |
|---|---|---|---|
| KPI "Follow-ups hoje" | `comercial-followup` | `fuInitPage()` chamado no dispatcher de `goPage` (linha 11862) — sincronizado | Sim |
| KPI "Valor em negociação" | `comercial-orcamentos` | Não há hook dedicado no dispatcher para `comercial-orcamentos`; a tabela já está populada por `orcInitPage()` no boot | Sim (dados já em memória) |
| KPI "Clientes em risco" | `comercial-followup` | idem acima | Sim |
| "Minha carteira" → Pendentes/Em negociação | `comercial-orcamentos` | idem | Sim |
| "Minha carteira" → Risco/Reativação | `comercial-followup` | idem | Sim |
| "Ver clientes em risco" | `comercial-followup` | idem | Sim |
| "Ver todas as prioridades" | não navega — expande/colapsa secção in-page (`mp2ToggleTodas()`, linha 32304) | dados já renderizados, só CSS | Sim |
| Linha da tabela "Próximos 7 dias" | `cliOpenEdit(id)` ou `obAbrirLead(id)` | `obAbrirLead()` (linha 32424-32427) faz `goPage('comercial-pipeline')` e só 250ms depois `crmOpenEdit(id)` — padrão de `setTimeout` para esperar o DOM da página renderizar | Sim (250ms é suficiente na prática, mas é um padrão frágil comum a todo o ficheiro) |
| "Abrir Cobranças" (Financeiro) | `tesouraria` + `tesMostrarTab('receber')` a 200ms | `goPage('tesouraria')` dispara `tesRender` a 50ms internamente — 200>50, ordem correta | Sim |

### H1 — 🐞 KPIs do Meu Painel podem ficar desatualizados no 1º carregamento após login (sem precisar de 2º clique dentro do próprio painel, mas com dados errados até o utilizador sair e voltar)

Sequência confirmada em `crmEnterAppWithProfile()` (linhas 2635-2661):
1. `goPage(crmPaginaInicial())` — para um comercial, isto é `goPage('meu-painel')`, que chama `renderMeuPainel()` **de forma síncrona**, usando o `orcData`/`crmAtividades` que estiverem em memória **nesse instante** (herdados do `localStorage` de uma sessão anterior, possivelmente vazios ou desatualizados num browser novo).
2. **Só depois** (mesmo bloco, mas assíncrono) é chamado `_orcInitFromSB()` (linha 2652), que faz o `SELECT * FROM ob_orcamentos` real. Quando essa promise resolve, `_orcInitFromSB()` (linhas 17865-17876) faz `orcData = res.rows` e chama `orcRenderList()` — **mas não chama `renderMeuPainel()` outra vez**.

Resultado: um comercial que faz login e cai diretamente no Meu Painel (comportamento normal, ver `crmPaginaInicial()` linha 2630) vê KPIs calculados com dados desatualizados/vazios (cache local antiga ou array vazio num browser novo) até que **navegue manualmente para outro ecrã e volte** ao Meu Painel — só aí `goPage('meu-painel')` volta a chamar `renderMeuPainel()` com o `orcData` já atualizado do Supabase. Este é exactamente o padrão de bug "ecrã em branco/desatualizado no 1º carregamento, precisa de navegação extra para atualizar" já visto noutras partes deste código-base (ex.: Calendário/Gantt).

---

## 10. Tabela resumo

| Bloco | Estado | Fonte atual | Filtro utilizador | Problema | Correção |
|---|---|---|---|---|---|
| A. Identidade (nome/role/dept/avatar) | ✅ REAL E CORRETO | `ob_profiles` via `crmAuthLoadProfile`/`crmBuildCUFromProfile` | `auth.uid()` (RLS) | — | — |
| B. Orçamentos (KPIs Negociação/Ticket/Pendentes) | 🐞 BUG ATUAL | `ob_orcamentos` (`orcData`, `SELECT *` + RLS) | Texto `o.vendedor===CU.name` (deveria ser `o.owner_id===CU.id`) | Orçamento com `vendedor` dessincronizado do dono real fica invisível no Meu Painel do dono, mesmo pertencendo-lhe por `owner_id`/RLS. Confirmado 1 caso real em produção. | Trocar `o.vendedor===CU.name` por `o.owner_id===CU.id` em todos os locais (ver lista de linhas) |
| C. Follow-up (card "Follow-ups hoje"/"Faça agora") | ✅ base correta / 🐞 herda Bug B1 | `ob_orcamento_triagem` (RPCs `fu_*`, RLS) + `orcData` | RLS no servidor; corte "meus" no cliente = mesmo bug de B | Mesmo problema do Bloco B, propagado | Mesma correção do Bloco B |
| D. Tarefas | não existe | `ob_tasks` nunca é usada; sem secção "Tarefas" no Meu Painel | n/a | n/a — não é um bug, é ausência de funcionalidade | Implementar se for prioridade de produto (fora de âmbito desta auditoria) |
| E. Design/Produção/Instalações | não existe | `ob_uni_items` nunca é referenciada no Meu Painel | n/a | n/a | n/a |
| F. Financeiro ("Por cobrar") | ✅ REAL E CORRETO | `ob_crm_dados['ob-tes-receber']` (`TES_RECEBER`) | Gate de role via `obPodeVerFinanceiro()` (agregado da empresa, sem corte por comercial — correto pois a fonte não tem dono) | — | — |
| G. Segurança — RLS de `ob_orcamentos`/`ob_orcamento_triagem` | ✅ REAL E CORRETO | RLS `ob_can_see(owner_id)` | Server-side | — | — |
| G. Segurança — RLS de `ob_crm_dados['ob-crm-atividades']` | 🐞 BUG ATUAL | `ob_crm_dados` (blob único, todos os comerciais) | RLS só por **role**, não por autor/owner — qualquer comercial lê o blob inteiro no browser | "Lembretes de Hoje" e "Últimas actividades" só filtram visualmente; os dados de todos os colegas chegam ao browser de qualquer comercial | Adicionar RLS por owner nesta chave, ou migrar `crmAtividades` para uma tabela relacional com `owner_id`/RLS real (fora de âmbito — só documentar aqui) |
| H. Navegação — KPIs/Carteira/Risco/Cobranças | ✅ REAL E CORRETO | `goPage` + handlers síncronos existentes | — | — | — |
| H. Navegação — 1º carregamento após login | 🐞 BUG ATUAL | `crmEnterAppWithProfile()` → `renderMeuPainel()` síncrono antes de `_orcInitFromSB()` resolver | — | KPIs mostrados no login podem estar desatualizados até o utilizador sair e voltar ao Meu Painel | Chamar `renderMeuPainel()` (com guarda de página ativa) no fim de `_orcInitFromSB()`/`_uniInitFromSB()`/`crmHidratarLeadsCanonico()` |

---

## 11. BUGS QUE DEVEM SER CORRIGIDOS

### Bug B1 (prioridade alta) — Corte "meus orçamentos" por texto (`vendedor`) em vez de `owner_id`
- **Sintoma**: um comercial pode não ver, no seu Meu Painel, um orçamento que é legitimamente seu (segundo `owner_id`/RLS), porque o campo de texto `vendedor` não coincide com `CU.name`.
- **Causa**: comparação `o.vendedor===CU.name` (texto livre vs. nome de perfil) em vez de `o.owner_id===CU.id` (chave real).
- **Funções/linhas exatas**:
  - `renderMeuPainel()` — linhas 30443-30448 (`minhas`/`minhasOrc`)
  - `fuMinhasOrc()` — linhas 32748-32759
  - `agListaCanonica()`/`agObterTopHoje()` — linha 32015 (`it.comercial===comercialAlvo`, onde `comercial:o.vendedor`, linha 31690/32650/32667)
  - `mp2RenderProximosSete()` — linhas 32370-32372, 32384
- **Fonte atual (errada)**: `o.vendedor` (texto livre, editável, pode ficar dessincronizado do dono real).
- **Fonte correta**: `o.owner_id` (uuid, já vem no objeto `orcData` — linha 17843 — não precisa de nova query nem de migration) comparado com `CU.id`.
- **Impacto**: qualquer comercial cujo nome tenha mudado no perfil, ou cujo campo `vendedor` tenha sido preenchido de forma diferente do `full_name` atual, deixa de ver esses orçamentos nos KPIs/Follow-up/Carteira do Meu Painel — subcontagem silenciosa, sem erro visível. Confirmado 1 caso real em produção (`ORC-719-2026OB`, owner=Edna Faria, vendedor="Paulo Faria").
- **Correção recomendada (não implementada)**: substituir a comparação de nome por `o.owner_id===CU.id` (e, para managers, complementar com `ob_manages` se algum dia o Meu Painel ganhar uma vista de equipa). Aplicar a mesma troca a todas as funções listadas, de forma consistente.

### Bug G1 (prioridade alta — segurança/privacidade) — `ob_crm_dados['ob-crm-atividades']` sem RLS por dono
- **Sintoma**: um comercial recebe, no seu browser, as atividades/lembretes de **todos** os comerciais da empresa (não só os seus), mesmo que a UI do Meu Painel só desenhe os seus.
- **Causa**: a política RLS `ob_crm_dados_select_comercial` (tabela `public.ob_crm_dados`, confirmada via `pg_policies`) filtra por **role** (`comercial`/admin), não por **owner/autor** — porque a tabela guarda um único blob JSON por chave (`chave='ob-crm-atividades'`), partilhado por todos os comerciais, em vez de uma linha por utilizador/atividade.
- **Fonte de dados**: `public.ob_crm_dados` (chave `ob-crm-atividades`), lida por `obSbLerRemoto`/boot sync (linhas 33390-33520, 33610-33617).
- **Fonte correta**: uma tabela relacional (`ob_crm_atividades` ou similar, uma linha por atividade) com coluna `owner_id`/`autor_id` e RLS `ob_can_see(owner_id)`, análoga ao que já existe em `ob_orcamentos`/`ob_orcamento_triagem`.
- **Impacto**: privacidade entre comerciais — qualquer comercial pode, via consola do browser (`crmAtividades`) ou inspecionando o tráfego de rede, ver notas/lembretes/histórico de contacto de clientes de outros comerciais, mesmo que a interface do Meu Painel nunca desenhe isso no ecrã. Mesma exposição aplica-se a `ob-leads` e `ob-clients` (mesma política), o que extravasa o âmbito do Meu Painel mas partilha a causa raiz.
- **Correção recomendada (não implementada)**: migrar `crmAtividades` (e idealmente `ob-leads`/`ob-clients`) de um blob único em `ob_crm_dados` para tabelas relacionais dedicadas com `owner_id` e RLS `ob_can_see`, tal como já foi feito para `ob_orcamentos`/`ob_orcamento_triagem`. Não é uma correção pequena — é uma migração de dados/schema — pelo que deve ser tratada como item de segurança próprio, fora desta auditoria.

### Bug H1 (prioridade média) — KPIs desatualizados no 1º carregamento pós-login
- **Sintoma**: ao entrar no CRM, um comercial cai diretamente no Meu Painel (comportamento esperado) mas os KPIs mostrados podem refletir dados antigos (cache local) até o utilizador navegar para outro ecrã e voltar.
- **Causa**: `crmEnterAppWithProfile()` chama `goPage(crmPaginaInicial())` (que renderiza o Meu Painel de forma síncrona) **antes** de `_orcInitFromSB()` (assíncrono) terminar; quando este termina, não há nenhuma chamada de volta a `renderMeuPainel()`.
- **Função/linhas exatas**: `crmEnterAppWithProfile()`, linhas 2635-2661 (chamada de `goPage` na linha 2648, chamada de `_orcInitFromSB()` na linha 2652); `_orcInitFromSB()`, linhas 17865-17876 (não chama `renderMeuPainel`).
- **Fonte atual (errada)**: `orcData` no momento do primeiro `renderMeuPainel()` = cache de `localStorage` (`ob-orcamentos`), possivelmente vazia/desatualizada.
- **Fonte correta**: `orcData` já atualizado pelo `_sbOrcLoadAll()` — mas o painel teria de ser re-renderizado depois de essa promise resolver.
- **Impacto**: qualquer comercial (ou admin) que faça login e observe o Meu Painel nos primeiros instantes pode ver contagens/valores errados (tipicamente subestimados ou a zero num browser novo) até sair e voltar à página. Não é um erro visível (sem mensagem de erro), por isso é silencioso e facilmente confundido com "não tenho pendências".
- **Correção recomendada (não implementada)**: no fim de `_orcInitFromSB()` (e idealmente também de `_uniInitFromSB()`/`crmHidratarLeadsCanonico()`), verificar se a página ativa é `meu-painel` e, nesse caso, chamar `renderMeuPainel()` novamente — mesmo padrão já usado para `orcRenderList()`.

---

## 12. MELHORIAS FUTURAS — NÃO SÃO BUGS

- **Bloco D (Tarefas)** não existe no Meu Painel. Se for um requisito de produto, precisa de ser desenhado e implementado de raiz — hoje `ob_tasks` está vazia e sem nenhuma UI ligada a ela em lado nenhum do ficheiro.
- **Bloco E (Design/Produção/Instalações)** não aparece no Meu Painel. Se a intenção for dar visibilidade cross-departamento a partir do painel pessoal, seria preciso desenhar isso de propósito (com filtro por `owner_id`/`assignee` dentro do `payload` jsonb de `ob_uni_items`, para não repetir o mesmo tipo de fuga descrita no Bug G1).
- **Bloco G — vista de manager**: hoje o Meu Painel é "tudo ou nada" (comercial vê só o seu, admin vê tudo). Não há uma vista intermédia para `role='manager'` que mostre a equipa gerida via `ob_manages()`, apesar dessa função já existir e ser usada noutros pontos do sistema (RLS). Não é um bug — é uma funcionalidade que ainda não foi construída para este ecrã especificamente.
- **`mp-cobrar-card` / classe `mp-placeholder`**: o JS ainda faz `cobrarCard.classList.remove('mp-placeholder')` (linha 30564), mas o elemento já nasce no HTML sem essa classe (linha 7404) — resíduo inofensivo (no-op) de uma versão anterior do painel (antes da reformulação "Meu Painel v2" de 14/08/2026). Pode ser limpo por higiene, sem urgência.
- **Comentário desatualizado nas linhas 7302-7306**: descreve cards placeholder ("Meta do mês", "Valor vendido", "Valor por faturar", "Agenda", "IA recomenda") que já não existem no HTML atual. Não afeta o comportamento, mas induz em erro quem ler o código à procura desses cards. Vale a pena atualizar o comentário na próxima alteração a este bloco.
- **Padrão `setTimeout` para sincronizar navegação** (ex. `obAbrirLead`, "Abrir Cobranças"): funciona hoje com as margens observadas (200ms/250ms vs. 50ms internos), mas é um padrão frágil espalhado por todo o ficheiro — qualquer aumento futuro no tempo de render da página de destino pode reintroduzir o clássico "abre mas está vazio, só no 2º clique". Não é um bug atual, é uma fragilidade estrutural a vigiar.

---

## 13. Metodologia — consultas SQL executadas (só leitura)

1. `SELECT relrowsecurity/relforcerowsecurity FROM pg_class WHERE relname='ob_crm_dados'` — confirmar RLS ativa.
2. `SELECT policyname, cmd, qual, with_check, roles FROM pg_policies WHERE tablename='ob_crm_dados'` — confirmar que a política de `SELECT` para `ob-crm-atividades`/`ob-leads`/`ob-clients` é por **role**, não por **owner**.
3. `SELECT p.full_name, p.role, count(owner_id), count(vendedor bate) FROM ob_profiles LEFT JOIN ob_orcamentos ...` — confirmar divergência real entre `owner_id` e `vendedor` em produção.
4. `SELECT id, num, vendedor, owner_id FROM ob_orcamentos WHERE owner_id=<Edna Faria>` — isolar o caso concreto de divergência.

Nenhuma consulta de escrita (`INSERT`/`UPDATE`/`DELETE`/DDL) foi executada. Nenhuma alteração foi feita a `index.html`, a migrations, a `main` ou a `preview`.
