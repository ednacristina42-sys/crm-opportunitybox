# Migrations do Supabase

Esta pasta é a fonte oficial de todas as alterações à base de dados do Opportunity AI OS.
Nenhuma alteração de schema deve ser feita à mão (SQL manual) — tudo passa por um ficheiro
de migration versionado aqui e commitado no GitHub.

**Estado atual: pasta vazia.** A Fase 1 (fundação) não cria nenhuma tabela. A primeira
migration real (ex.: tabela `empresas`, RLS multiempresa) fica para a Fase 2, quando os
módulos comerciais começarem a ser desenhados.

## Convenção de nomenclatura

```
YYYYMMDDHHMMSS_descricao_curta.sql
```

Exemplo: `20260101120000_create_empresas_table.sql`.

## Regras

- Cada migration deve ser pequena e fazer uma coisa.
- Sempre que possível, idempotente (`create table if not exists`, `create index if not exists`, etc.).
- Toda migration que altere dados ou estrutura existente deve vir acompanhada, no PR, de:
  1. tabelas afetadas;
  2. risco estimado;
  3. plano de rollback (instruções explícitas se não for automaticamente reversível);
  4. confirmação de teste em staging;
  5. aprovação humana antes de aplicar em produção.
- Nunca apagar tabelas/colunas/dados sem backup e aprovação humana.
- Nunca renomear tabelas/colunas existentes sem plano de migração.
- Nunca alterar políticas de RLS existentes sem testes.
- Toda tabela multiempresa deve ter `empresa_id` e RLS obrigatória.

## Como aplicar localmente

```bash
supabase start          # sobe a stack local (Postgres, Auth, Storage, Studio)
supabase db reset        # aplica todas as migrations desta pasta a partir do zero
```

Só depois de validado em staging é que uma migration é aplicada em produção, com aprovação humana.
