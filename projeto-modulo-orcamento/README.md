# Módulo de Orçamentos — Opportunity Box

Módulo isolado da área de **Orçamentos** do CRM da Opportunity Box (empresa de
sinalética e reclamos luminosos, Portugal). Este repositório contém apenas a
parte de orçamentos — o resto do CRM não faz parte do âmbito deste projecto.

## O que o módulo faz

- **Criar orçamentos** com dados do cliente (nome, NIF, morada, email, WhatsApp),
  validade, prazo de pagamento e prazo de entrega
- **Linhas de produto** com catálogo fixo (Letras Monobloco 3D, Reclamo LED,
  Totem, Caixa de Luz, Neon Flex, Painel LED, Sinalética, etc.), quantidade,
  preço unitário e subtotal por linha
- **Cálculo automático** de subtotal, desconto (%), IVA (%) e total
- **Condição especial "50% adjudicação + 50% entrega"** — calcula sinal e saldo
- **Numeração automática** no formato `ORC-AAAA-NNN` (ex.: `ORC-2026-042`),
  sequencial por ano
- **Lista de orçamentos** com KPIs (total, aprovados, pendentes, faturados),
  filtros (pesquisa, estado, vendedor, data), paginação (20 por página) e
  exportação CSV
- **Estados**: Pendente → Em análise → Aprovado → Em Produção → Concluído →
  Faturado / Cancelado (com registo de quem aprovou e quando)
- **Geração de PDF** (A4, via janela de impressão do navegador) com logótipo,
  dados da empresa, linhas, totais, valor por extenso e zona de assinaturas
- **Envio por WhatsApp e Email** (mensagens pré-formatadas)
- **Mini-registo de clientes** (modal "Novo Cliente") com auto-preenchimento
  dos campos do orçamento
- **Persistência**: localStorage sempre; sincronização com Supabase quando
  configurado (ver abaixo)

## Estrutura de ficheiros

```
index.html          Página do módulo (formulário + lista)
css/estilo.css      Estilo dark + amarelo #F5C400 (igual ao CRM principal)
js/config.js        Configuração (placeholders — SEM chaves reais)
js/logo.js          Logótipo em base64 usado no PDF
js/supabase.js      Sincronização com a tabela ob_orcamentos
js/pdf.js           Geração do PDF (orcPDF + numeroPorExtenso)
js/orcamentos.js    Toda a lógica do módulo (funções orc*)
README.md           Este ficheiro
INTEGRACAO.md       Como o trabalho volta a ser integrado no CRM principal
```

## Estrutura dos dados

### Objecto orçamento (localStorage `ob-orcamentos` — array, mais recente primeiro)

```json
{
  "num": "ORC-2026-042",
  "cli": "Hotel Serra da Lua",
  "vendedor": "Rui Mota",
  "email": "rui@opportunitybox.pt",
  "st": "Pendente",
  "stc": "ba",
  "dt": "04/07/2026",
  "data": "04/07/2026",
  "val": "2026-08-03",
  "prazo": "30 dias",
  "prazoEntrega": "25",
  "morada": "Rua Principal 12, Sintra",
  "nif": "PT 500 000 000",
  "cliEmail": "reservas@hotelserra.pt",
  "cliWA": "+351 912 345 678",
  "pagamento50": false,
  "sinal": null,
  "saldo": null,
  "imagem": null,
  "linhas": [
    { "produto": "Totem", "desc": "Totem entrada 3m", "qty": 1, "preco": 5800, "sub": 5800 }
  ],
  "totais": {
    "sub": 5800, "descPct": 0, "descVal": 0,
    "ivaPct": 23, "ivaVal": 1334, "total": 7134
  },
  "aprovado_em": "05/07/2026",
  "aprovado_por": "Paulo Faria"
}
```

Notas importantes:
- `st` é o estado; `stc` é a classe de cor usada no CRM principal
- `dt`/`data` estão no formato `DD/MM/AAAA`; `val` (validade) em `AAAA-MM-DD`
- `linhas[].sub = qty × preco`; `totais.total` é o total com IVA
- `aprovado_em`/`aprovado_por` só existem depois de o estado passar a "Aprovado"

### Tabela Supabase `public.ob_orcamentos`

| Coluna     | Tipo    | Conteúdo                                            |
|------------|---------|-----------------------------------------------------|
| `id`       | text PK | Igual a `num` (ex.: `ORC-2026-042`)                 |
| `num`      | text    | Número do orçamento                                 |
| `cli`      | text    | Nome do cliente                                     |
| `vendedor` | text    | Nome do comercial                                   |
| `email`    | text    | Email do comercial                                  |
| `st`       | text    | Estado (Pendente / Aprovado / …)                    |
| `stc`      | text    | Classe de cor do estado                             |
| `dt`, `data` | text  | Data de criação `DD/MM/AAAA`                        |
| `val`      | numeric | Valor total com IVA                                 |
| `nif`      | text    | NIF do cliente                                      |
| `obs`      | text    | Observações                                         |
| `linhas`   | jsonb   | Array de linhas (formato do objecto acima)          |
| `totais`   | jsonb   | Objecto de totais (formato do objecto acima)        |
| `extra`    | jsonb   | `{ dtProducao, aprovado_em, aprovado_por }`         |

A tabela já contém **577 orçamentos reais** em produção — o formato acima
**não pode ser alterado** sem autorização.

## Como testar localmente

1. Clonar o repositório
2. Abrir o `index.html` directamente no navegador **ou** (recomendado, para
   evitar restrições de CORS/file://) servir a pasta:
   ```bash
   npx serve .
   # ou
   python3 -m http.server 8080
   ```
3. Abrir `http://localhost:8080`
4. Os dados ficam no localStorage do navegador — não precisas de Supabase
   para desenvolver. Para recomeçar do zero: DevTools → Application →
   Local Storage → apagar as chaves `ob-orcamentos` e `ob-clients`.

## Chaves de API (⚠️ ler com atenção)

- **Não há chaves reais neste repositório** — o `js/config.js` tem apenas
  placeholders vazios (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
- Com os placeholders vazios, o módulo funciona 100% em modo local
  (localStorage). É assim que deves desenvolver e testar.
- As chaves reais serão inseridas pela Opportunity Box na integração final.
- **Nunca** faças commit de chaves (Supabase, OpenAI ou outras), nem mesmo em
  branches de teste. Se precisares de testar contra uma base de dados, cria o
  teu próprio projecto Supabase gratuito com uma tabela `ob_orcamentos` com as
  colunas da secção anterior.

## Regras para o desenvolvimento

1. **Não alterar os nomes das funções nem das variáveis globais** (`orcGuardar`,
   `orcRenderList`, `orcData`, `ORC_FILTERS`, etc.) — a integração de volta no
   CRM principal depende destes nomes (ver `INTEGRACAO.md`).
2. **Não alterar os IDs dos elementos HTML** (`orc-cliente`, `orc-tbody`,
   `orc-num-badge`, etc.) pela mesma razão.
3. **Não alterar o formato dos dados** (objecto orçamento, `linhas`, `totais`)
   — há 577 orçamentos reais em produção com este formato.
4. **Manter o estilo visual**: tema dark com amarelo `#F5C400` (variáveis CSS
   em `css/estilo.css`). Novos elementos devem usar as variáveis existentes.
5. **Tudo em português de Portugal** (interface, comentários, mensagens).
6. **Sem frameworks nem build steps** — HTML + CSS + JavaScript puro (ES6),
   como está. Sem npm, sem bundlers. Pode usar-se CDN apenas com autorização
   prévia.
7. **JavaScript compatível com navegadores modernos** (Chrome/Edge/Safari
   actuais); não é preciso suportar IE.
8. Trabalhar em branches e abrir Pull Request — não fazer push directo para
   `main` deste repositório.
9. Qualquer dúvida sobre regras de negócio (IVA, numeração, estados),
   perguntar antes de assumir.
