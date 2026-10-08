# P4-E — evidência visual de Configurações › Cadastros

Capturas do mesmo roteiro (`p4e-evidence.spec.ts`, temporário, fora da suíte) na base P4-D.1 (`antes/`) e na P4-E (`depois/`), com os mesmos dados semeados no Emulator (workspace PJ; categorias de despesa, receita e investimento, um produto e um centro de custo), viewports 1440×900 e 390×844, temas claro e escuro.

| Captura | Diferença (pixels) | Motivo |
| --- | --- | --- |
| `cadastros-categorias-owner-desktop-*` | 0,05% | Aba "Parcelados" removida das categorias (D-23: o catálogo não tem subtipo `parcelado`). |
| `cadastros-categorias-owner-mobile-claro` | 11,19% | A mesma remoção encolhe a largura mínima da faixa de abas; o painel deixa de transbordar no celular (antes, título, "Novo cadastro" e paginação ficavam cortados à direita) e o texto se reorganiza. |
| `cadastros-categorias-member-desktop-claro` | 1,05% | Member e viewer não veem "Novo cadastro", "Editar" e "Inativar" (só owner/admin administram; o backend decide). |
| `modal-novo-cadastro-desktop-claro` | 0,64% | Chip "Parcelados" removido do tipo de transação do formulário. |
| `confirmar-inativacao-desktop-claro` | 0,23% | Texto corrigido: a reserva do nome não é liberada ao inativar ("O nome continua reservado: para usá-lo de novo, reative este cadastro."). |

Relatórios: transbordo horizontal 0 em todas as telas medidas, antes e depois; axe-core (WCAG 2.0/2.1 A e AA) no formulário com as mesmas violações pré-existentes antes e depois (`button-name` 74 — botões de ícone do seletor —, `color-contrast` 3), nenhuma nova. `depois-relatorio.json` registra, para o member: 0 botões de criar, editar e inativar e as abas Receitas, Despesas e Investimentos.

## Teclado (`teclado-depois.txt`)

Roteiro na P4-E, só com teclado depois do foco inicial: Enter em "Novo cadastro" abre o formulário; Enter no nome envia; nome repetido mostra o alerta (`role="alert"`) dentro do formulário e preserva o valor digitado; nome novo cria e fecha com "Cadastro criado com sucesso."; Enter em "Inativar" abre a confirmação e Enter em "Inativar item" inativa. Escape não fecha o formulário — comportamento pré-existente, idêntico na base (o componente não trata Escape em nenhuma das duas versões); não foi alterado porque a P4-E não muda a interface além do exigido pelo contrato.
