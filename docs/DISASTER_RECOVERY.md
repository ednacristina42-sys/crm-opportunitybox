# Recuperação de desastre

**Estado na Fase 1: N/A** — ainda não há dados reais, schema, nem storage a proteger
neste subprojeto. Este documento fica como placeholder a expandir na Fase 2+, quando
existirem dados reais e as normas da proprietária exigirem scripts de exportação/restauro.

## Scripts previstos (futuro, documentados antes de existirem dados reais)

- Exportar schema do Supabase.
- Exportar dados por empresa (`empresa_id`).
- Exportar anexos do Storage.
- Restaurar uma empresa a partir de um export.
- Reconstruir todo o ambiente a partir do GitHub (clone → `.env` → migrations → build → deploy).

## Princípio

O GitHub (código + migrations) e os backups do Supabase devem ser suficientes, por si
só, para reconstruir o sistema inteiro sem depender de nenhuma ferramenta de
desenvolvimento temporária (Emergent/Claude Code/etc.).
