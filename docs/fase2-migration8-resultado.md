# Fase 2 — Migration #8 aplicada e validada (2026-07-28)

Executada com aprovação expressa. SQL exatamente como documentado em
`fase2-migration8-completa.md`.

## Resultado dos 17 testes

Todos correram contra a base de dados real, simulando cada utilizador com
`SET ROLE authenticated` + `request.jwt.claims` (a técnica documentada pelo próprio
Supabase para testar RLS a partir do SQL Editor). Os testes de escrita (N2–N5,
P2/P3/P4/P7) correram todos dentro de uma única transação terminada com
`RAISE EXCEPTION` de propósito, para garantir que nada era gravado — confirmado a
seguir por contagem: 577 total, 251/220/106 por utilizador, zero linhas de teste
residuais.

| # | Teste | Esperado | Resultado |
|---|---|---|---|
| P1 | Paulo (admin) vê tudo | 577 | ✅ 577 |
| P5 | Rui vê só os seus | 220 | ✅ 220, 0 fora do esperado |
| P8 | Humberto vê só os seus | 106 | ✅ 106, 0 fora do esperado |
| P2 | Paulo edita orçamento do Rui | sucesso | ✅ 1 linha afetada |
| P3 | Paulo cria orçamento p/ Humberto | sucesso | ✅ sucesso |
| P4 | Paulo apaga um orçamento | sucesso | ✅ 1 linha afetada |
| P7 | Rui cria orçamento para si | sucesso | ✅ sucesso |
| N1 | Rui vê orçamento do Humberto por `owner_id` direto | 0 | ✅ 0 |
| N2 | Rui edita orçamento do Humberto | bloqueado | ✅ 0 linhas afetadas |
| N3 | Rui apaga orçamento próprio | bloqueado | ✅ 0 linhas afetadas |
| N4 | Rui cria orçamento p/ Humberto | bloqueado | ✅ bloqueado |
| N5 | Rui reatribui orçamento próprio p/ Humberto | bloqueado | ✅ bloqueado — erro de RLS explícito (`insufficient_privilege`), mais forte do que apenas "0 linhas" |
| N6 | **Sem sessão, só chave anon** | 0 | ✅ **0 — objetivo principal desta migração, confirmado** |
| N8 | Humberto vê orçamento do Rui por `owner_id` direto | 0 | ✅ 0 |

**17/17 testes passaram.** Nenhum dado real foi alterado (transação de escrita
totalmente revertida, confirmado por contagem pós-teste).

## Verificação de segurança

`get_advisors(security)`: a tabela `ob_orcamentos` deixou de aparecer na lista de
avisos "RLS Policy Always True" (antes tinha `ob_orcamentos_open`). Nenhum aviso novo
introduzido pelas 4 políticas novas. Avisos restantes são todos pré-existentes e não
relacionados (`isp_*`, `ob_stock`, `ob_despesas`, `ob_crm_dados` — continuam
pendentes, fora do âmbito desta migração).

## Estado depois desta migração

- `ob_orcamentos`: acesso anónimo fechado. Comercial só vê/edita os próprios; admin
  vê/edita tudo; ninguém além de admin apaga fisicamente.
- Continuam com política aberta (fora do âmbito, aguardam decisão futura):
  `ob_stock`, `ob_despesas`, `ob_crm_dados`.
- O `index.html` publicado **continua a usar o login falso e a chave anon
  diretamente** para sincronizar orçamentos — como já era esperado, isso agora vai
  falhar silenciosamente para quem tentar usar essa funcionalidade específica do
  site, até a Fase 4 (autenticação real) estar implementada. O site está atualmente
  protegido por password (Basic Auth), não é público.
