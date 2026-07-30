# Fase 4 — Resultado das Etapas 3 e 4 (aguarda validação para avançar)

Complementa `fase4-plano-autenticacao.md`. Nada publicado — tudo só no branch
`claude/crm-opportunitybox-cleanup-q737hx`.

---

## Fluxo exato de arranque (pedido explicitamente, em falta na resposta anterior)

**Com sessão válida:**
```
carregamento inicial
  → overlay (#crm-auth-loading, visível desde o HTML, sem depender de JS)
  → crmAuthBootGate() começa, captura a sua geração (_crmAuthGen)
  → recuperação da sessão — crmAuthGetSession() (lê a sessão persistida
    pelo supabase-js, storage 'ob-crm-auth')
  → validação da sessão — existe, tem session.user.id
  → consulta a ob_profiles — crmAuthLoadProfile(session.user.id),
    filtrando por id = auth.users.id da sessão, .maybeSingle()
  → validação: perfil existe e id corresponde à sessão pedida
     → validação: active === true
        → validação: role está em CRM_VALID_ROLES
           → validação: department não vazio
              → validação: full_name não vazio
                 → construção do CU (crmBuildCUFromProfile) — só com
                   dados de ob_profiles, nunca de localStorage/USERS
                 → overlay escondido, #login escondido, #app mostrado
                 → entrada no CRM (setupApp/renderAll/goPage('home'))
```

**Sem sessão:**
```
carregamento inicial
  → overlay
  → crmAuthGetSession() devolve null
  → ausência de sessão
  → overlay escondido, ecrã de login mostrado (o antigo, inalterado)
```

**Qualquer validação falha** (sem perfil, inativo, role desconhecida,
department/nome em falta, ou o `id` devolvido não bate com o da sessão):
`logout explícito (crmAuthLogout) → overlay escondido → login mostrado →
mensagem específica do motivo`.

**Falha de rede** (a validar sessão ou a carregar perfil): mesma coisa, mas
**sem** logout automático e com mensagem genérica de "tenta novamente" —
nunca confundida com credenciais erradas ou conta bloqueada.

---

## Etapa 4 — mapeamento `ob_profiles` → `CU`

### 1. Mapeamento exato

| Campo do `CU` | Vem de `ob_profiles` | Nota |
|---|---|---|
| `id` | `profile.id` | = `session.user.id`, validado antes de aceitar |
| `name` | `profile.full_name` | |
| `email` | `profile.email` | |
| `role` | `profile.role` | validado contra `CRM_VALID_ROLES` |
| `admin` | `profile.role === 'admin'` | booleano derivado, não guardado à parte na BD |
| `dept` | `profile.department` | nome mantido (`dept`) para compatibilidade com o resto do ficheiro |
| `manager_id` | `profile.manager_id` (ou `null`) | |
| `_authGate` | — | `true`, marcador interno para distinguir de um `CU` do login antigo |

**Nada vem de `localStorage`, de `USERS`, nem de nenhum parâmetro do
browser.** `color`/`online` ficam com valores fixos (não existem em
`ob_profiles`) — cosmético, sem implicação de segurança.

### 2. Campos obrigatórios (bloqueiam o acesso se ausentes/inválidos)
`id` (tem de bater com a sessão), `active` (tem de ser `true`), `role` (tem
de estar em `admin`/`manager`/`comercial`/`financeiro`), `department` (não
vazio), `full_name` (não vazio).

### 3. Casos de bloqueio, cada um com logout explícito + mensagem própria
- Sem perfil correspondente → "Esta conta ainda não tem perfil associado no CRM."
- `id` devolvido não corresponde ao da sessão (dados inválidos) → "Os dados da conta são inválidos."
- `active !== true` → "Esta conta está desativada."
- `role` fora da lista válida → "A função associada a esta conta não é reconhecida."
- `department` vazio → "Perfil incompleto (falta departamento)."
- `full_name` vazio → "Perfil incompleto (falta nome)."

Perfil **duplicado** não é um caso de bloqueio testável — `ob_profiles.id` é
chave primária (referencia `auth.users`), duplicados são impossíveis na base
de dados; `.maybeSingle()` é o método usado precisamente para isto (rejeita
com erro se, por algum motivo impossível, mais do que uma linha correspondesse).

### 4. Testes simulados executados (SDK do Supabase totalmente mockado via `page.addInitScript`, sem depender de rede real)

| # | Cenário | Resultado |
|---|---|---|
| 1 | Sessão válida, perfil ativo | ✅ `CU` construído certo (role/dept/admin/manager_id), app mostrada |
| 2 | Sessão válida, sem perfil | ✅ logout chamado, mensagem própria, login mostrado |
| 3 | Sessão válida, perfil inativo | ✅ logout chamado, mensagem "conta desativada" |
| 4 | Sessão expirada (`SIGNED_OUT` a meio do uso) | ✅ volta ao login, `CU` limpo, mensagem "sessão expirou" |
| 5 | Falha de rede (`getSession` lança erro) | ✅ mensagem de "tenta novamente", **sem** logout automático, nunca "credenciais erradas" |
| 6 | Retorno inválido de `ob_profiles` (`id` não bate com a sessão) | ✅ bloqueado, "dados inválidos" |
| 7 | Role desconhecida (`"gerente"`, fora do enum) | ✅ bloqueado, "função não reconhecida" |
| 8 | Dois eventos `SIGNED_OUT` consecutivos | ✅ idempotente, sem exceção, sem efeito duplicado |
| 9 | Logout a meio do carregamento do perfil (corrida) | ✅ o logout venceu — app nunca abriu, `CU` ficou `null`, mesmo depois do perfil "atrasado" resolver |

O teste 9 valida o mecanismo `_crmAuthGen` (contador de geração) acrescentado
nesta etapa: cada tentativa de arranque guarda a sua geração e verifica-a
depois de cada `await`; um logout (ou um novo arranque) incrementa o
contador, e uma tentativa antiga que entretanto resolva desiste em silêncio
em vez de reabrir a app com dados já inválidos. Isto exigiu uma exceção
pequena e explícita: `doLogout()` ganhou **uma linha** (incrementar
`_crmAuthGen`) — o resto da função não foi tocado.

### 5. Riscos ainda não testados com Supabase real
- Nunca corri isto contra o Supabase verdadeiro (rede indisponível neste
  sandbox) — o mock reproduz fielmente a forma das respostas (`{data,error}`,
  `maybeSingle()`), mas não pode garantir 100% que o SDK real se comporta
  exatamente assim em todos os casos (ex.: formato exato de um erro de rede
  real, latência real do `autoRefreshToken`).
- `onAuthStateChange` só foi testado disparando o evento manualmente — não
  testei um cenário real de expiração de token (isso demora horas/dias a
  acontecer naturalmente).
- Não testei ainda com as 5 contas reais (Edna, Paulo, Rui, Humberto,
  André) — falta confirmar que `ob_profiles` devolve exatamente o que o
  mock assumiu para cada uma.

### `CRM_AUTH_GATE_ENABLED` — nota para a Etapa 9
Registado, não esquecido: antes de publicar, o ramo `if(!CRM_AUTH_GATE_ENABLED)`
(que hoje existe só para reverter rapidamente durante o desenvolvimento) tem
de ser revisto — ou removido, ou blindado — para nunca poder reabrir, em
produção, o caminho de entrada pelo login falso. Fica marcado como item
obrigatório da checklist da Etapa 9, não resolvido agora.

---

## Commit
Separado, só no branch de trabalho: ver secção seguinte da conversa.
