# Fase 2 — Plano de teste para as 3 primeiras contas reais (preparado, não executado)

A correr **depois** de Paulo, Rui e Humberto aceitarem o convite (ver
`fase2-funcoes-rpc-e-convites.md`) e **antes** de qualquer migration #7/#8. Nada disto
foi corrido — fica pronto para quando as contas existirem.

## Pré-condição

```sql
select full_name, email, role from public.ob_profiles order by full_name;
```
Esperado: 4 linhas — Edna (`admin`, já existente), Paulo (`admin`), Rui (`comercial`),
Humberto (`comercial`).

## Testes (via API REST do Supabase, usando o token de sessão de cada pessoa)

1. **Login individual** — `POST /auth/v1/token?grant_type=password` com o email e a
   password que cada pessoa definiu no convite. Confirmar que devolve um
   `access_token` diferente por pessoa.
2. **Rui cria um cliente:**
   ```
   POST /rest/v1/ob_clientes
   Authorization: Bearer <token do Rui>
   { "nome": "Cliente Teste Rui", "created_by": "<uuid do Rui>", "owner_id": "<uuid do Rui>" }
   ```
   Esperado: sucesso, devolve o registo criado.
3. **Humberto não vê o cliente do Rui:**
   ```
   GET /rest/v1/ob_clientes
   Authorization: Bearer <token do Humberto>
   ```
   Esperado: **não** inclui o "Cliente Teste Rui".
4. **Humberto tenta aceder diretamente pelo ID:**
   ```
   GET /rest/v1/ob_clientes?id=eq.<id-do-cliente-do-rui>
   Authorization: Bearer <token do Humberto>
   ```
   Esperado: `[]` — bloqueado ao nível da linha, não só escondido na lista.
5. **Paulo (admin) vê tudo:**
   ```
   GET /rest/v1/ob_clientes
   Authorization: Bearer <token do Paulo>
   ```
   Esperado: inclui o cliente do Rui, mesmo sendo `admin` e não o dono.
6. **Humberto tenta editar/apagar o cliente do Rui:**
   `PATCH`/`DELETE` no mesmo ID → esperado 403/0 linhas afetadas nos dois casos
   (edição bloqueada por `ob_clientes_update`; eliminação física bloqueada para
   qualquer não-admin, mesmo o próprio dono).
7. **Rui tenta apagar o próprio cliente:** `DELETE` no cliente que ele criou →
   esperado também bloqueado (só admin apaga fisicamente — combinado explicitamente).
8. **Logout do Rui:** `POST /auth/v1/logout` com o token dele → repetir o passo 2
   com o mesmo token → esperado 401.
9. **Limpeza:** o cliente de teste fica no sistema como registo real de teste — antes
   de fechar este teste, um admin apaga-o fisicamente (`DELETE` autenticado como
   Edna/Paulo) para não poluir os dados reais, já que a eliminação lógica
   (`deleted_at`) ainda não está ativa nas políticas.

## Critério de aprovação

Os 3 comerciais/admin passam por 1–9 sem nenhum resultado inesperado → dá luz verde
para considerar o mecanismo de isolamento validado com contas reais, antes de avançar
para a migration #7 (backfill dos 577 orçamentos).
