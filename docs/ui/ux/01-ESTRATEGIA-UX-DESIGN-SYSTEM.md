# FênixGran — Estratégia de Design System e experiência do produto

**24/11/2026 • Proposta para aprovação • Não constitui autorização de implementação**

## 1. Sumário executivo e método

A estratégia recomendada é aproveitar a fundação Power Fênix | Vita Fênix como patrimônio de marca e engenharia, mas criar uma expressão financeira unificada, denominada FênixGran, dentro de um núcleo compartilhado Fênix. Não importar indiscriminadamente os estilos de saúde/performance nem criar um terceiro sistema inteiramente independente. O objetivo é transmitir controle, clareza, autonomia e evolução, com densidade apropriada a tarefas financeiras repetitivas. Personalização ampla é um diferencial, mas deve operar sobre contratos de tokens validados, não sobre estilos arbitrários.

Fontes: `DESIGN-SYSTEM-MASTER.zip` (914 entradas), `minhas-financas-main.zip` (4.290 entradas), catálogo de microinterações de 24/11, briefing do usuário e documentação de projeto `00`–`20`. Ambos os ZIPs passaram na verificação CRC (`ZipFile.testzip()`). Foram lidos os documentos centrais de marca, cor, tipografia, grafismo, layout, componentes, tokens, motion, dados, testes, governança e licenças; o frontend foi analisado estaticamente e amostras históricas do Dashboard claro/escuro desktop/mobile foram inspecionadas. Varredura de 275 arquivos TS/TSX/CSS em `src/`. Pesquisa externa em fontes oficiais e especialistas, e consulta técnica via Context7. Não houve execução do produto, reexecução de suítes, revisão manual de todas as 1.589 imagens do repo ou validação de todos os arquivos binários/nested ZIPs; a auditoria integral de cada tela/estado será a primeira rodada. A instância remota privada do Claude Design não foi acessada: o espelho `20-claude-design-system` é a evidência local, não prova de paridade com a instância atual. Nenhuma instalação, alteração, commit, push ou deploy. Não se distribuem fontes ou ativos privados neste relatório.

Legenda: **E** = evidência dos anexos; **P** = proposta deste relatório; **V** = precisa de validação/decisão. Referências internas são caminhos relativos à raiz de cada ZIP; números de testes são históricos, não reproduzidos.

## 2. Inventário e aproveitamento do Design System original

| Área | Evidência e origem | Decisão proposta para o FênixGran |
|---|---|---|
| Marca | `01-brand-foundation/README.md`: união ciência, tecnologia e humanidade; Sábio 40%, Herói 35%, Governante 25%; sofisticada, moderna, elegante, humana | Preservar princípios; adaptar narrativa a literacia, controle e progresso financeiro. Não transportar promessas de saúde |
| Logotipo | `02-logo-system`, `assets/logos/logo-manifest.json`, `assets/logos/web`: símbolo fênix-chama comum, assinaturas horizontais, verticais, principais e reduzidas; 63 SVG web sem fundo segundo README | Preservar geometria do símbolo; criar novo nominal FênixGran e assinatura horizontal/reduzida, submetidos ao estúdio/proprietário. Não editar nominal Power/Vita ou reutilizar tagline Saúde & Performance. Testar área de proteção, 16/24 px e app maskable |
| Paleta | `03-color-system`: 5 primárias institucionais, escalas 100–600 oficiais; 700–900 e neutros propostos | Preservar valores oficiais como primitivos; unificar no produto financeiro, sem alterar Power/Vita |
| Tipografia | `04-typography-system`: Neulis Alt Medium (títulos/nominal), Urbanist Light editorial, Regular/Medium digital (proposta); ambas sem `tnum` | Preservar voz tipográfica; Urbanist 400–600 para UI, Neulis 500 apenas após licença web/app, fonte numérica com tnum a validar |
| Grafismos | `05-graphic-system`: 9 Fluxos Mindset, 4 Organogramas, 2 Ascensão, 4 padrões, selos, watermark, 29 vetores descritos | Fluxos de expansão/conexão e watermark em landing/onboarding; um motivo por composição. Selos de saúde e slogans específicos fora do produto. Sem grafismo atrás de tabelas |
| Iconografia | `06-iconography`: 38 ícones propostos, grid 24, traço 1,5, currentColor | Preservar geometria e consistência, usar Lucide por padrão no app; adaptar ícones autorais úteis, não duplicar centenas de ícones |
| Ilustração/fotografia | `07-illustration`, `08-photography`, manifesto: sem banco de imagens aprovado | Ilustração abstrata geométrica pontual; não reutilizar fotos sem direitos. Evitar mascote infantil, moeda 3D e ilustrações fitness |
| Layout | `09-layout-system`: base 4 px, 4/8/12 colunas, breakpoints 640/768/1024/1280/1536, raios 6/12/20/32/pill | Preservar escala, adaptar raios e densidade financeira; não impor max 1200 a tabelas de gestão |
| Tokens | `10-design-tokens`: fonte JSON, CSS/SCSS/TS, DTCG/resolver, Figma, Tailwind v3/v4, 205 tokens no portal, 54 semânticos declarados | Reutilizar pipeline e proveniência; produto/temas adicionais; validar formatos gerados e aliases |
| Componentes | `11-components/README.md`: 47 componentes, React 18, TS/CSS, bundle e catálogo | Aproveitar APIs/anatomia e partes comprovadas; reavaliar comportamento acessível e responsabilidades financeiras antes de portar |
| Motion | `12-motion-system`: 80/140/220/360/560 ms, curvas padrão/entrada/saída/ascensão, energia contida | Aproveitar e encurtar fluxos de alta frequência, sem quique, sem 3D em tarefas |
| Dados | `13-data-visualization`: cores fixas por série, linha/barra/rosca, tabela alternativa, zero em barras | Especializar paleta e semântica de caixa, dívida, aporte, previsão, patrimônio; preservar Recharts |
| Editorial/templates | `14`–`17`: documentos, apresentações, redes e impressos | Reutilizar linguagem de comunicação, não importar formatos/branding de saúde diretamente |
| Voz e IA | `18-brand-voice`, `19-ai-guidelines`, `21-brand-skill` | Vocabulário financeiro pt-BR, não prometer retorno, skill de marca derivada para FênixGran |
| Portal | `22-design-system-portal`: busca, preview, contraste, temas, componentes | Aproveitar como referência/portal inicial; não publicar HTML com fontes sem licença nem duplicar documentação viva |
| Governança | `24-governance`, `26-reports`: status oficial/extraída/inferida/proposta/pendente; SemVer | Manter rastreabilidade; aprovação humana antes de promover RC |
| Testes | `25-tests/README.md`: 188 execuções por variante de tokens, 160 do portal, zero violações reportadas; 292 pares, 2 avisos de warning-border | Reexecutar no Gran e nos temas customizados. Axe sozinho não demonstra WCAG AA |

**Licenças e conflitos:** `26-reports/DECISOES-PENDENTES.md` P2/P18 e `licenses/MANIFESTO-LICENCAS.md` indicam que Neulis Alt tem uso privado declarado, mas licença web/app não comprovada; não publicar WOFF2 nem HTML embutido antes da comprovação. Urbanist é OFL, incluir licença e aviso. Fotografias de mockups sem licença identificada não são reutilizáveis. Algumas cores de SVG diferem dos HEX oficiais (P4, ΔE reportado <1); solicitar reexportação sem adulterar vetores. Área de proteção do símbolo isolado 29% é proposta; validar. Divergência Source Serif/Neulis resolvida no DS original por priorizar Manual; não reabrir sem necessidade. Nome Cinza Ancestral vs erro Binza, selos e frases inconsistentes, P17 borda warning 2,37:1, e estados Vita claro/escuro são pendências do DS de origem, não fatos a propagar. A mistura cromática Gran é nova extensão; não mudar regras das marcas Power/Vita.

## 3. Diagnóstico técnico e visual da aplicação atual

Evidências: `src/App.tsx` centraliza navegação via estado `view` e monta Dashboard, receitas/despesas, relatórios, metas, investimentos simples, configurações, cartões, split, recorrentes, clientes PJ, empréstimos PF/PJ, admin e planos; `LoginView.tsx` usa Google Auth. Não localizei landing pública dedicada no snapshot (nomes/estrutura e montagem examinados); P9 prevê cadastro, landing, preços e legal. Não afirmar que existe uma landing externa sem URL ou material. O código atual tem React 18.2, Tailwind 3.4.19, Framer Motion 10.16.4, Recharts 2.12.7, TanStack Query 5.0.0, Firebase ^12.8, Howler 2.2.4, canvas-confetti 1.9.2, Lucide 0.263.1, Phosphor 2.1.4 e Tabler 3.2.0. `tailwind.config.js` usa Poppins, variáveis semânticas e cores legadas. Documentos consolidados de outubro indicam React 19/Tailwind 4 e P4-C, mas estão atrasados em relação a este snapshot. O plano mestre contém P5/F, P6 e gate de piloto; não se conclui prontidão de lançamento a partir do ZIP.

| Achado | Evidência específica | Impacto e decisão |
|---|---|---|
| Muitas cores simultâneas e hierarquia por cor | `SummaryCard.tsx`: fundos de ícone azul/verde/vermelho/índigo/roxo, bordas coloridas; capturas p5f1-r2a `desktop-light-s01-dashboard.png` e dark: quatro KPIs com acento próprio, chips roxos, ação índigo | A aparência é amigável, mas cores competem. Superfícies neutras, saldo principal destacado, cor restrita ao significado |
| Tipografia arredondada e títulos pesados | Poppins em `tailwind.config.js`, captura do Dashboard | Não é defeito isolado; combinada com ícones circulares/chips, reforça estética lúdica. Urbanist mais contida, pesos 400/500/600 e numerais com alinhamento |
| Uso excessivo localizado de decoração | `GoalCard.tsx` gradiente radial/linear, emoji com scale 125%, capas, selos, shimmer infinito, confete via efeito; `themePresets.ts` showCover/showEmoji/showBadges true | Evidência concreta mais forte de infantilização. Preservar personalização, mudar padrão: imagem/emoji opcionais, sem shimmer contínuo; celebração rara e persistida após fato confirmado |
| Simulação 3D de cartão | `CreditCard3D.tsx`: rotação Y 180° no hover, gradiente, sombra | Pode ser recurso afetivo em preview, mas esconde dados e depende de hover. Cartão plano com detalhe explícito; flip opt-in não necessário |
| Aparência de header/sidebar | `Header.tsx` gradientes até roxo e ícones circulares; `Sidebar.tsx` acentos purple; screenshot mostra título “Minhas Finanças”, menu colapsado sem rótulos | Marca incompleta; navegação mais legível com rótulos, workspace inequívoco, ação global e estado do período |
| Espaço e leitura no mobile | `mobile-light-s01-dashboard.png`/dark: cabeçalho ocupa altura, quatro KPIs empilhados, aviso de tempo de trabalho quebra em várias linhas | Priorizar saldo/resumo e lançamento; não ocultar aviso de estimativa. Grid 2 colunas apenas quando números cabem, senão linha compacta; tabela vira lista com acesso ao detalhe |
| Gráfico sem dados | Dashboard histórico: área vazia grande com legenda multicolorida; não se prova erro de query pela captura | Reservar espaço proporcional e explicitar vazio/filtro/erro/atualização; jamais inventar zero |
| Personalização fragmentada | `ThemeContext.tsx` injeta 16+ propriedades e persiste `app-theme` local; `PersonalizationView.tsx` 47 kB e contraste por par; tokens semânticos coexistem com classes fixas | Consolidar resolver de tema, separar edição de preview, testar efetividade por componente |
| Sons em padrão ligado | `themePresets.ts`: enabled true, volume 50, efeitos true; `ThemeContext.tsx` 12 URLs de áudio Mixkit | Padrão desligado; manter opção de usuário, revisar licenças e hospedagem local; nada de rastreamento/asset remoto no clique |
| Modais e navegação | `ConfirmationModal`, `LoanDialog`, `ClientsDialog`, diversos modais específicos, drawer de fatura; portal e focus já exigidos por docs | Não declarar duplicatas funcionais sem diff; padronizar primitivas e preservar contratos específicos; inventariar keyboard/focus antes de trocar |

Varredura textual (não é contagem de defeitos nem de elementos renderizados): 3.965 ocorrências de classes cromáticas fixas em 91 arquivos; 167 HEX literais em 19 arquivos; 165 `rounded-full` em 52; 30 padrões de gradiente em 11; 17 imports Framer Motion em 17. Cores de marca de cartões e dados de domínio podem ser legítimas, comentários e testes podem influenciar; classificar usos antes de substituir. Nenhuma evidência de que todo arredondamento ou toda animação seja ruim. As capturas históricas não são do runtime atual; a rodada inicial deve reproduzir baseline completa em Emulator.

## 4. Arquitetura visual em três camadas

1. **Fênix Core (marca):** símbolo original, cinco primitivos oficiais, escala 4 px, tipografia e geometria, vocabulário de componentes, semântica acessível, princípios e motion. Independente de domínio e sem Firebase.
2. **Produto (Gran):** semântica de superfície e ação, tabela/fluxo, dados financeiros, identidade verbal, navegação, densidade, componentes especializados, landing. Power/Vita mantêm seus temas e restrições próprias; Fênix Conecta ganha outro perfil sem copiar a UI financeira. A identidade Gran é única em claro/escuro, não dois subprodutos.
3. **Usuário/workspace:** preferência global do usuário (tema, modo, densidade, movimento, som, escala tipográfica); overrides de acento do workspace apenas dentro de uma whitelist semântica. Não sobrescrever status financeiro, identidade do produto, foco mínimo ou papéis. Tema customizado não altera payloads nem regras.

Arquitetura lógica: fonte original rastreada → primitivos → semânticos por produto/modo → tokens de componente → overrides tipados/validados → CSS/TS/Tailwind/preview. Preferência do SO de movimento reduzido prevalece sobre modo intenso. Acessibilidade tem precedência sobre escolha estética; oferecer correção sugerida e não salvar combinações ilegíveis. Não usar cascata solta de overrides no DOM por módulo. Separar camada de dados de componente visual e evitar pacote distribuído prematuramente.

## 5. Direção artística: precisão calorosa

**P**: base editorial financeira, marinho profundo + neutros quentes, acento âmbar contido, linhas finas, hierarquia por tamanho/peso/espaço em vez de arco-íris, microinterações discretas. A marca deve sugerir trajetória ascendente sem prometer enriquecimento. Duas alternativas menos adequadas: dark premium dominante (contraste e leitura prolongada, aparência de trading) e verde orgânico dominante (aproxima Vita e reduz distinção do produto). Usar azul como eixo de confiança e deixar o verde/âmbar/vermelho agir semanticamente. Landing pode ter composição mais expressiva com Fluxos/Ascensão; aplicação logada permanece operacional.

| Cor oficial | Hex | Função no Gran |
|---|---|---|
| Azul Abissal | #16365B | Ação principal clara, marca, cabeçalhos/seleção, informação; derivados claros no escuro |
| Brasa Nobre | #EA9543 | Acento de marca, progresso e CTA comercial específico, atenção em tons escuros sobre claro |
| Cinza Ancestral | #DDD9CD | Neutros, bordas decorativas, fundo editorial, tons 100/200 para superfícies |
| Verde Origem | #8AA989 | Crescimento/metas, entrada de dinheiro e sucesso; verde 800/900 no claro para texto |
| Vermelho Vital | #881812 | Despesa/saída, dívida quando aplicável, erro; tons 100/200 no escuro |

Proporção indicativa para tela logada: 80–90% neutros, 7–15% azul, 2–5% acentos; não medir pixel a pixel como requisito. O layout e a informação definem a proporção. Azul e vermelho têm baixo contraste entre si (~1,3:1 conforme DS), assim como Brasa e Verde sobre branco (~2,4/2,6:1). Não usar como texto pequeno ou ícone informativo. Brasa em fundo marinho funciona melhor, mas não deve ser o único CTA em todo lugar. Usar estados com rótulo e sinal +/−, ícone/forma e texto. Receitas e despesas são direções, não julgamento moral. Investimento não é receita; aporte/resgate não é necessariamente ganho/perda. Dívida não é erro, vencido não equivale a pago, zero é neutro.

## 6. Especificação preliminar de tokens

Valores abaixo são candidatos, não nova paleta oficial. Escalas base extraídas em `03-color-system`; adicionar só neutros necessários e documentar. A matriz de contraste deste pacote calcula pares candidatos, não todos os estados.

| Token semântico | Claro | Escuro |
|---|---|---|
| surface.page | #F4F2EE | #101B29 (derivado proposto) |
| surface.panel | #FFFFFF | #19283A (derivado proposto) |
| surface.subtle | #F9F9F7 | #24354A (derivado proposto) |
| text.primary | #1D1D1B | #F9F9F7 |
| text.secondary | #5D5B53 | #B1BCC8 |
| text.heading | #16365B | #F9F9F7 |
| action.primary.bg | #16365B | #B1BCC8 |
| action.primary.fg | #FFFFFF | #001836 |
| action.accent.bg | #EA9543 | #EA9543 |
| action.accent.fg | #16365B | #16365B |
| link | #16365B | #D8DDE4 |
| border.decorative | #DDD9CD | #3D5876 |
| border.control | #7D7A72 | #8B9BAD |
| focus.ring | #A95F00 | #EA9543 |
| status.success.fg | #4F6C4E | #C4D4C4 |
| status.success.bg | #EBF1EB | #345034 |
| status.warning.fg | #814800 | #F4CAA1 |
| status.warning.bg | #FBEDE0 | #51341C (derivado proposto) |
| status.error.fg | #881812 | #EBD8D7 |
| status.error.bg | #EBD8D7 | #3F0000 |
| status.info.fg | #16365B | #D8DDE4 |
| status.info.bg | #D8DDE4 | #0B2C50 |
| finance.income | #4F6C4E | #B1C6B0 |
| finance.expense | #881812 | #D7B2B0 |
| finance.investment | #16365B | #B1BCC8 |
| finance.pending | #814800 | #F4CAA1 |

Tokens de foco específicos para inverse/accent, `on` tokens para todos os fundos, hover/pressed/selected/disabled, linhas de gráficos, baseline e cursor precisam de validação adicional. Não derive automático texto claro para qualquer cor: resolver e medir cada par. Exemplo DTCG conceitual (aliases na fonte, não código a aplicar agora):

```json
{"color":{"primitive":{"azul":{"600":{"$type":"color","$value":{"colorSpace":"srgb","components":[0.086275,0.211765,0.356863],"alpha":1}}}},"semantic":{"action":{"primary":{"bg":{"$type":"color","$value":"{color.primitive.azul.600}"}}}}}}
```

Implementação proposta de artefatos: `design-system/source/{primitives,semantics,products,components}.json` + resolver de temas conforme DTCG 2025.10; CSS estático por `data-product`/`data-mode`, TS para schema e preferências, Tailwind v3 adapter, manifesto de proveniência e hashes. Não duplicar fonte em Figma e código. Cores em OKLCH para geração/interpolação, saída sRGB validada e fallback CSS; registrar clipping de gamut. `--color-primary` e demais vars atuais podem ser aliases transitórios de UI com prazo de remoção (não é migração de dados financeiros). Não sobrepor estilos arbitrários via CSS importado de usuário.

### Tipografia, grid e acabamento

Urbanist Regular 400 (texto 14–16), Medium 500 (labels 13–14), semibold 600 (hierarquia), 700 só destaque; títulos 20/24/30/36; landing 40–64 desktop, 32–44 mobile. Neulis Alt 500 para títulos e assinatura somente se licença permitir; fallback Urbanist 500. Textos longos 16–18, line-height 1,45–1,6; labels não em caixa alta generalizada. Para valores, validar fonte OFL com `tnum` (por exemplo Inter, confirmar arquivo e glifos) ou system-ui com alinhamento à direita e colunas estáveis; não presumir que CSS `tabular-nums` funciona em Urbanist/Neulis. Moeda `Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})` na camada de apresentação, reutilizar formatadores canônicos, sem floats autoritativos. Time mode mantém semântica e rótulo de unidade.

Grid 4/8/12 do DS, base 4; gutters 16/24/24; padding de card 16/20/24; no app, largura adaptável e tabelas com área local de scroll quando indispensável; landing max 1200–1280. Raios Gran 6 (inputs compactos), 8 (botões), 12 (cards), 16 (modal), pill apenas status/chips/avatar; DS original tem 20/32/pill, não copiar automaticamente. Densidade confortável controles 44 px, compacta 36 desktop, ampliada 48; mínimo normativo AA 24×24 com exceções, meta de toque 44. Bordas 1 px e 3 níveis de sombra (cartão quase sem sombra, popover média, modal alta); sem sombras coloridas intensas. Z-index respeita portal, modal/foco e toasts. Ícones Lucide 16/20/24, stroke 1,5–2 fixo por família, `currentColor`; mapa funcional sem trocar significado por tema. Preservar outros packs como avançado condicionado a paridade e testes (não carregar todos no bundle inicial).

## 7. Design System de componentes e arquitetura de informação

Inventário original de 47: Button, IconButton, Link, ButtonGroup, SegmentedControl; TextField, Textarea, Select, Checkbox, RadioGroup, Switch, Slider, SearchField, DateField, FileUpload; Badge, Tag, Alert, Toast, ProgressBar, Spinner, Skeleton, EmptyState; Card, MetricCard, Accordion, Tabs, Dialog, Drawer, Tooltip, Popover; Avatar, List, Divider, Table, Pagination, Breadcrumb, AppHeader, SideNav, Timeline; Logo, Watermark; BarChart, LineChart, DonutChart, ChartLegend, Icon. Todos estão classificados PROPOSTA no DS original. Não prometer equivalência de comportamento só por nome.

| Família | Tratamento Gran |
|---|---|
| Ações/inputs | Reutilizar semântica e estados; `MoneyField`, `PercentField`, `CivilDateField`, seletor conta/cartão, `CatalogCombobox`, formulário com erro inline/estado busy/idempotência, campos de moeda preservam parsing |
| Overlay | Dialog, Drawer, Tooltip, Popover, menu/context menu, ConfirmationDialog com portal, foco preso/retornado, Escape quando não busy, não fechar antes de confirmação |
| Navegação | AppShell, SideNav, Header, WorkspaceSwitcher, Breadcrumb, Tabs, MobileNav, CommandPalette (posterior); roles e PF/PJ preservados |
| Dados | `FinancialMetric`, `MoneyValue`, `WorkTimeValue`, `FinancialStatus`, `DataTable` com paginação/ordenação, `TransactionRow`, `EmptyState`, `ErrorState`, `PendingState`, `ChartFrame`, `ChartDataTable`, `PeriodSelector` |
| Domínio | AccountSummary, TransferForm, InvoiceSummary, LoanSchedule, ReceiptBreakdown, RecurrenceTimeline, SplitAllocation, InvestmentPosition, GoalProgress, ReportFilter, NotificationItem, PlanCard. Compostos sobre primitivos, não colocar regra de negócio no DS |
| Preferências | ThemeEditor, ThemePreview, ContrastInspector, MotionPreference, DensitySelector, ResetTheme; preview com fixture sintética isolada de chamadas e sons |
| Marketing | BrandLockup, Hero, ProductDemo, FeatureNarrative, PlanComparison, FAQ, LegalFooter, CTA, consentimento de cookies quando necessário |

Para cada componente: anatomia, token map, variantes (size/tone/density), estados default/hover/focus/active/disabled/loading/error/success/empty conforme aplicável; tipos, nomes acessíveis, exemplos, keyboard, teste de contraste, visual e interação; responsabilidade explícita sobre dados/side effects. Não portar `Logo` que só conhece Power/Vita sem adaptação. Não duplicar Recharts com biblioteca gráfica do DS. Avaliar Radix headless só onde primitivas existentes falham; não instalar pacote inteiro nem shadcn por padrão.

### Arquitetura proposta de navegação

- Visão geral (Dashboard); Movimentações (Receitas, Despesas, extrato/transferências e filtros); Contas e cartões; Planejamento (Recorrências, Metas); Patrimônio (Investimentos, Empréstimos); Compartilhado (Divisão/Rateios & Reembolsos); PJ (Clientes/Recebíveis); Análise (Relatórios, IA contextual); Configurações/Plano. Trata-se de taxonomia para teste, não remoção de módulo. Atalhos e pin de módulos frequentes, rótulos PF/PJ em vez de menus duplicados.
- Desktop sidebar 224–256 expansível, rail com tooltip e nomes acessíveis, header com workspace e período claramente escopados, busca/ações, notificações e perfil. Tablet rail ou drawer; mobile ação Nova transação sempre alcançável sem obstrução de conteúdo, navegação de 3–5 destinos frequentes + Mais, com workspace visível. Navegação por estado atual precisa ser avaliada para deep links/voltar: não impor React Router durante redesign, decidir ADR se necessário.
- Disclosure progressiva: ação primária e campos essenciais primeiro, avançados em área identificada (juros/descontos, amortização, filtros) sem esconder condição obrigatória. Usuário especialista acessa atalhos e visão densa. Diferenciar contextos global e da tela (período, filtros, workspace), não resetar silenciosamente.

### Wireframe conceitual (sem código, não render atual)

```
DESKTOP  ┌──────────────┬────────────────────────────────────────────────┐
         │ FênixGran    │ Workspace ▾   Período ▾   R$/tempo   🔔 Perfil │
         │ Visão geral  │ Visão geral                + Novo lançamento  │
         │ Movimentações│ Saldo disponível        Receitas   Despesas    │
         │ Contas       │ R$ ...                  R$ ...     R$ ...     │
         │ Planejamento │ [Fluxo de caixa / período] [A vencer / ações]  │
         │ Patrimônio   │ [Realizado vs previsto]    [Próximas contas]   │
         │ Compartilhado│ Últimas movimentações — tabela e filtros      │
         │ Relatórios   │ Diagnóstico / IA contextual (se autorizado)    │
         └──────────────┴────────────────────────────────────────────────┘
MOBILE   [Espaço ▾ | R$/tempo | notificações]  [Período ▾]
         Saldo disponível — valor / unidade / aviso se necessário
         Entradas e saídas (compactos, sem overflow)
         + Lançamento | A vencer | Ver extrato
         Fluxo / próximos compromissos / movimentações
         [Início] [Movimentos] [Novo] [Mais]
```

## 8. Redesign por jornada e módulo

| Jornada | Mudança recomendada | Invariantes/aceite |
|---|---|---|
| Login/cadastro | Marca e proposta clara; fluxo Google existente; explicar workspace inicial e privacidade, erros acionáveis | Não inventar novos provedores, não contornar convite/piloto; integração P9 |
| Dashboard | Saldo realizado em primeiro plano, resumo operacional do período, próximos vencimentos, previsão separada; cards sem moldura multicolorida; gráfico com vazio explícito; ocultar valores em apresentação | Saldo não é patrimônio, relatório server-side, período explícito; conversão tempo só com estimativa provada, aviso preservado |
| Transações | Lista unificada conceitual ou abas receita/despesa (validar contrato), filtros por estado/conta/categoria/data, busca existente, drawer de detalhe, botão novo lançamento | Pendente não move saldo; criação/confirm/edit/void idempotentes; quota e papéis; datas civis; não criar UI otimista de dinheiro |
| Contas/transferências | Saldo total, lista de contas, extrato com origem, transferência em fluxo origem → destino → valor → revisar | Conta arquivada/zero, saldo não editável, transferência não é despesa/receita, estorno compensatório |
| Cartões | Layout plano, limite usado/disponível, fatura por competência, compras e parcelas, CTA pagar apenas elegível | Fatura fechada/aberta separada de pagamento, conta de origem obrigatória, ajuste não é pagamento, não duplicar despesa |
| Recorrentes | Calendário/lista de próximos vencimentos, modo automático/confirmar visível, detalhe/histórico | Não-cartão automático gera pendente, ocorrências reais vs projeções, pause/catch-up |
| Empréstimos PF/PJ | Tomado/concedido, resumo principal/juros, cronograma com detalhe, revisão de amortização, estorno/cancelamento | Principal não é resultado operacional, pagamento separa juros, ownership/RBAC |
| Clientes/recebíveis PJ | Tabela clientes/recebíveis, atraso derivado, drawer, recebimento parcial com decomposição e preview | PII não retornada a member/viewer, desconto não entra caixa, principal e juros distintos |
| Split/reembolsos | Grupos em lista padrão e cards opcionais; participantes internos/externos explícitos; resumo quem deve, rateio com total fechado, trilha de aprovação PJ | Não gerar caixa para quitação pessoal, autorização por UID, reembolso pago por conta e papéis, quota |
| Investimentos | Manter `SimpleInvestmentsView`; posição e alocação, aportes/resgates, ganhos realizados vs estimativa, metas vinculadas e ações claras | Ledger patrimonial único, integração de conta, não ressuscitar UI profissional removida, não prometer rentabilidade |
| Metas | Barra de progresso, prazo, valor alvo, status, ações e detalhe, decoração opt-in | Status canônico, confete uma vez após marco confirmado, não confundir investimento vinculado com saldo disponível |
| Relatórios/IA | Períodos/escopo explícitos, resumo e filtros avançados, comparação e tabela alternativa, IA com consentimento e origem da resposta | Não recalcular autoridade financeira no cliente; preservar consentimento, dados minimizados, quotas, isolamento, sem falsa certeza |
| Tempo de trabalho | Toggle global com unidade clara, detalhes do cálculo e retorno a R$, wizard acessível | Não usar tempo para persistência/payload, sem converter estimativa não provada/antiga, preservar renda privada e ForceMoneyDisplay |
| Notificações | Agrupar por tipo/prioridade e lidas/não lidas, links acessíveis e estados vazios/erro | Estado privado, TTL definido pelo projeto, revalidação do destino, não vazar conteúdo na aba bloqueada |
| Configurações/planos | Seções Conta, Espaço, Financeiro, Aparência, Privacidade, Assinatura; comparar limites e progresso com nomenclatura precisa | Billing backend-driven, downgrade preserva dados, roles, pricing real, não criar planos fictícios |
| Admin/suporte | Visual funcional denso, informações mínimas, ações de alto risco explícitas | Não ampliar acesso, segregação, proibição de produção, auditoria e autorização |

### Visualização de dados

Recharts já atende; criar wrapper `ChartFrame` com título informativo, unidade, período, legenda, resumo textual e tabela acessível; testar leitura no teclado e leitores de tela. Linha para série temporal; barras comparativas com zero; composição só quando total coerente (até 6 grupos, demais em Outros com drilldown); sem 3D/eixo duplo por padrão. Semânticas de gráfico separadas de paleta categórica: entradas e saídas com cores constantes, previsão tracejada, estorno identificado, saldo e patrimônio distinguíveis. Categórica proposta: azul 600, brasa 700, verde 800, vermelho 400, neutro 600, azul 400; não usar sequência para significar lucro/prejuízo; validar contraste por tema e daltonismo, usar hachuras/markers e rótulos diretos. Legenda fixa não deve aparecer sem dados. Exportar conforme permissões e backend já disponível, não criar nova rota de exportação por estética.

## 9. Personalização avançada

Evidência: `ThemeContext` usa localStorage `app-theme`, merge de defaults, sistema para tema inicial; `themePresets` cinco presets (claro, escuro, Midnight, Emerald, Sunrise); `PersonalizationView` preview e cálculo de contraste; `Icons` três famílias, controle de tamanho/traço; sons, efeitos, metas e split configuráveis. Nem toda preferência está comprovadamente aplicada em todas as telas. `AppTheme` e chamadas precisam de inventário antes de prometer sincronização.

| Preferência | Prioridade | Proposta e limite |
|---|---|---|
| Claro/escuro/automático | Essencial | Preferência `mode` separada do preset; seguir mudança do SO no automático, evitar flash na inicialização, modo atual anunciado |
| Temas predefinidos | Essencial | Gran claro/escuro padrão e 2–3 variações Gran discretas (Abissal, Origem, Brasa como acento), testar pares; temas antigos traduzidos ou explicitamente mantidos como personalizados conforme decisão |
| Editor de cores | Essencial | Editor básico com acento e superfícies; avançado com on-color e prévia; validação de todas as combinações críticas; reset global/por seção; status financeiros derivados, não livremente trocáveis |
| Cor workspace | Recomendado | Identificação visual e borda/indicador, não mudar significado financeiro ou marca do usuário |
| Densidade/raio | Essencial/recomendado | Confortável, compacta desktop e ampliada; raios por perfil, não slider sem limites em cada componente |
| Tipografia | Recomendado | Escala 100/112/125%, fontes aprovadas/licenciadas, sem família arbitrária nem fontes remotas carregadas pelo usuário |
| Layout/cards/sidebar | Recomendado | Largura e recolhimento, lista/cards, metas sem capa/emoji por padrão; preservar áreas de toque |
| Som | Opcional | Desligado por padrão em novos perfis; eventos relevantes; packs de arquivos com licença e volume baixo; nenhum som crítico exclusivo |
| Movimento | Essencial | Sistema/reduzido/desligado; intensidade expressiva somente rara e opt-in; SO reduzido prevalece |
| Gráficos | Recomendado | Cores categóricas validadas, formatos preferidos, manter significado de sinais, texto/ícone sempre |
| Sombras e aparências experimentais | Opcional | 2–3 perfis testados, não sombras arbitrárias, sem glass/neumorphism em controles essenciais |
| CSS próprio, imagens de fundo arbitrárias, animações livres | Rejeitar inicialmente | Risco de XSS, CSP, contraste, carga e suporte; não permitir código do usuário |

Resolver tipado, estado draft/preview local isolado, salvar apenas quando válido, restaurar versão do preset e opção reset. Persistência local continua no primeiro release; se sincronizar, usar documento privado por UID com schema/versionamento/allowlist, Rules e limites, sem dado financeiro/PII desnecessário, reconciliar preferências multi-device e logout sem transferir tema de um usuário a outro. Não introduzir listener contínuo só para isso; hidratar na sessão e gravar sob demanda. Conflito de preferências deve ser resolvido por regra documentada. Ausência de dados financeiros legados não elimina a necessidade de decidir como preservar preferências existentes de teste. Nenhuma alteração de schema nesta análise.

## 10. Landing pública — direção e conteúdo

P9 prevê landing/cadastro/pricing/legal; não há página dedicada localizada neste ZIP. Criar experiência independente e compartilhar somente fundação e componentes essenciais. Não repetir sidebar/dashboard como layout de marketing. Proposta de narrativa: **“Sua grana em uma nova fase”** (slogan oficial), explicação clara “Organize suas finanças pessoais e empresariais em um só lugar” (copy proposta a validar), CTA Começar/Entrar conforme acesso real e gate comercial. Hero editorial com composição assimétrica, fundo claro quente ou azul profundo, Fluxo de Expansão como único grafismo e screenshot do produto aprovado, não mockup enganoso. Evitar hero com dez cards flutuantes/gradientes neon.

| Seção | Conteúdo e composição |
|---|---|
| Header | Marca nova aprovada, Produto, Recursos, Planos, FAQ, Entrar; mobile acessível |
| Hero | Mensagem, dois CTAs no máximo, demonstração real sintética, promessa específica sem garantia financeira |
| Problema/valor | Da dispersão à visão de contas, obrigações e metas; 3 benefícios concretos sem números fictícios |
| Produto em uso | Jornada visual: registrar → entender → planejar, com 3 screenshots reais e texto; comparação PF/PJ |
| Diferencial | Tempo de trabalho como perspectiva opcional, aviso de estimativa; sem prometer aconselhamento financeiro |
| Módulos | Contas, cartões, recorrências, investimentos, metas, divisão, clientes PJ e relatórios conforme disponibilidade efetiva |
| Segurança/privacidade | Explicar controle de acesso/workspaces e tratamento de dados com linguagem verificável; não alegar certificações ou criptografia não confirmadas |
| Planos | Dados do catálogo oficial atual, periodicidade/limites; Free/Pro/Business históricos sujeitos a confirmação antes de publicação; CTA server-driven |
| FAQ | Quem pode usar, PF/PJ, limites, cancelamento, privacidade, suporte, tempo de trabalho; respostas confirmadas |
| CTA final e rodapé | Termos, Privacidade, Cookies, contato, identificação, login/cadastro, preferências de consentimento |

Landing motion 400–560 ms em revelações, hero único, scroll nativo; parallax/spotlight experimentais apenas com performance e reduced motion. Imagem estática equivalente, carregamento sob demanda, nada de som. SEO: HTML público indexável/SSR ou pré-render avaliado sem mudar stack do app, title/description/canonical, sitemap, robots (app privado noindex e autenticação real), OG, headings semânticos e FAQ real. Instrumentação minimizada com consentimento quando necessário; medir LCP/INP/CLS e conversão sem dark patterns. Não publicar preço, claim, depoimento, número de clientes, security badge ou screenshot não comprovado. Status de disponibilidade/piloto precisa aparecer corretamente. P9 e P8 coordenam legal/consentimento.

## 11. Motion, microinterações e catálogo

Anexo `02-MATRIZ-MICROINTERACOES.md` avalia individualmente cada linha funcional do catálogo e acrescenta contexto, intensidade, risco e decisão; política global abaixo aplica-se a todas. O catálogo é fonte de ideias, não autorização de dependências nem prescrição de stack. As regras de backend do Gran prevalecem sobre sugestões genéricas do catálogo de UI otimista, exclusão posterior, batch SQL, WebSockets e SSE.

| Token | Gran app | Landing | Uso |
|---|---|---|---|
| instant | 0–80 ms | 80 | foco, feedback imediato (não aguardar servidor) |
| fast | 120–140 ms | 140 | hover/click/checkbox |
| base | 180–220 ms | 220 | menus, abas, acordeão curto |
| overlay | 220–260 ms | 280–360 | diálogo/drawer; saída 70% da entrada |
| ascensao | 360–560 ms rara | 400–560 | conclusão excepcional, hero; nunca bloquear |
| reduced | 0–80 ms fade | idem | sem deslocamento, confete, parallax, animação de números; permitir indicador estático |

Curvas reaproveitadas: padrão cubic-bezier(.4,0,.2,1), entrada (.2,0,0,1), saída (.4,0,1,1), ascensão (.16,1,.3,1). Press 0,98, sem quique; entrada 4–8 px, somente raras até 16 px; não animar toda troca de rota, filtros ou digitação; nenhum movimento contínuo decorativo no app. CSS primeiro; Framer Motion já instalado para overlay/layout quando necessário. MotionConfig `reducedMotion=user` desliga transform/layout, mas não opacidade/cor; adicionar política CSS e flags próprias para confete, áudio, canvas, shimmer e gráficos. Context7 consultado em documentação Motion atual; confirmar APIs na versão 10.16.4 antes de codificar. Sem React 19.3/ViewTransition obrigatório: usar CSS ou Motion já disponível, não atualizar React para obter um efeito. Sons nunca indicam confirmação antes do servidor. Feedback local imediato = estado enviando, não saldo atualizado. Retry da mesma intenção usa mesma chave; não fazer exclusão física via job. Undo financeiro é reversal autorizado, não desfazer universal nem auto-deleção. Cancelar tarefa longa só se backend tiver cancelamento real.

### Matriz de aplicação por tela

| Tela | Essenciais | Recomendados/opcionais | Evitar |
|---|---|---|---|
| Shell/header | foco, seleção, menu, avisos/connection, toast | drawer curto, toggle tema discreto, atalhos | transição cinematográfica por rota |
| Dashboard | skeleton, estado vazio/erro, número estável, gráfico com alternativa | fade de atualização e KPI animate raro, sem atrasar | stagger a cada mês/consulta, looping |
| Formulários/transações | validação, busy, erro, confirmação server, preservação input | accordion avançado, drawer, copiar | UI otimista financeira, swipe destrutivo |
| Cartões/contas | estado fatura, feedback, tabela/lista | preview visual estático, disclosure | flip 3D obrigatório, animação de saldo pendente |
| Recorrências/empréstimos/recebíveis | timeline, feedback e loading | drawer e expansão curta | confete de pagamento rotineiro |
| Split | feedback, participantes/perm, estado real | reordenar lista pequena, painel | presença/cursores sem demanda |
| Investimentos/metas | progresso, legenda, confirmação | celebração opcional uma vez por conquista | shimmer infinito, gamificação de risco |
| Relatórios/IA | progresso, atualização explícita, estados seguros | seção independente, filtros salvos | efeitos que mascaram estimativa/erro |
| Personalização | preview isolado, contraste, reset | amostra de motion/som manual | áudio automático, CSS arbitrário |
| Landing/onboarding | foco, layout estável, conteúdo real | reveal, watermark, animação explicativa, 1 celebração | 3D pesado, scroll sequestrado, botão magnético em CTA crítico |

## 12. Acessibilidade e usabilidade

Base WCAG 2.2 AA: 4,5:1 texto normal e 3:1 grande; 3:1 informação não textual/foco quando aplicável; 24×24 mínimo com exceções, alvo interno 44 no touch; não depender de cor; reflow em 320 CSS px salvo exceções de conteúdo bidimensional com região rolável acessível; zoom 200%/400% conforme critério, foco não encoberto, ordem e navegação lógica, alternativa a arrastar (2.5.7), autenticação acessível, prevenção de erros financeiros (3.3.4), status anunciado sem tomar foco, rótulo visível consistente com nome acessível. Reduced motion é requisito voluntário reforçado (2.3.3 é AAA, não afirmar AA); movimento contínuo precisa de controle conforme 2.2.2; evitar flashes. Testar NVDA/Firefox/Chrome, VoiceOver/Safari/iOS, Android TalkBack, contraste e forced colors; eixo de teclado, popovers e modais, orientação e zoom, formulário com falha, permissão negada, conexão instável, longos valores e tradução pt-BR. Axe automatizado em todas as rotas principais e estados; revisão manual e teste com usuários são obrigatórios. Não prometer conformidade sem auditoria.

Testes de tarefa: 5–8 participantes por rodada exploratória entre PF/PJ, iniciantes e experientes (amostra qualitativa, não estatística), incluindo usuários com necessidades de acessibilidade quando possível; medir sucesso sem ajuda, tempo, erros, confiança e compreensão de saldo/pendente/tempo; meta proposta ≥90% nas tarefas críticas após iteração, nenhum erro de interpretação monetária grave observado, comparar com baseline e reportar N. Atividades: criar lançamento pendente e confirmar; transferir; localizar fatura fechada; receber parcialmente; localizar investimento e patrimônio; configurar tema/tempo; restaurar tema; navegar mobile e teclado. Não usar dados reais em protótipos.

## 13. Engenharia, desempenho, segurança e governança

Manter React 18/Vite/Tailwind 3 e versões lockadas; adaptar fonte DS com preset v3 e variáveis. CSS nativo + Framer Motion atual, Recharts + wrappers, Query 5 existente, ícones Lucide existentes, Howler sob demanda. Não instalar GSAP/Rive/Three.js/Sonner/AutoAnimate/dnd-kit/cmdk todos juntos. Sonner ou toast existente: escolher só se gap comprovado; cmdk posterior se busca/navegação aprovada; NumberFlow só se acessibilidade e tnum comprovados, CSS estático por padrão. Atualização de React/Tailwind, roteador ou lib de gráfico exige ADR, teste isolado, benefício mensurado e compatibilidade com Firebase/SDK. Usar primitives headless se reduzirem custo de manutenção e comprovarem foco; não trocar todos os modais simultaneamente.

Core Web Vitals: p75 LCP ≤2,5 s, INP ≤200 ms, CLS ≤0,1 em campo; em lab usar baseline com CPU/network throttling, INP de campo não se deduz de Lighthouse. Meta interna de feedback ≤100 ms, bundle inicial app não cresce >10% gzip em relação ao baseline sem ADR; separar marketing e assets pesados (lazy chunks), sem preload indiscriminado; medir custo por rota, fontes locais somente licenciadas, imagens com dimensão, sem CLS, pausas quando invisíveis, sem rAF/setState em todo pointermove, `will-change` temporário. Testar Android de entrada e Safari iOS/desktop, Firefox, Chrome/Edge. Recharts render e agregados respeitam paginação e domínios. Não anexar telemetria financeira nem identificadores sensíveis; não aumentar listeners/queries por efeitos. Firestore já fornece mecanismos de realtime, não introduzir Redis/SSE/socket para brilho ou notificações. Cancelamento e assinaturas por tenant; cache keys workspace/uid/role onde necessário, limpeza na troca/logout. PWA offline apresenta conexão/atualização; não enfileirar mutações financeiras sem decisão de domínio, não cachear PII indiscriminadamente.

Estrutura inicialmente no repo: `src/design-system/{tokens,theme,primitives,patterns,charts,motion,icons}`, `src/components` mantém compostos de domínio; `docs/design-system` guarda ADRs, catálogo, contraste, componentes, decisões e baselines. Fonte única em `design-system/source`; build determinístico para CSS/TS/Tailwind v3 e export DTCG/Figma. CSS classes prefixadas quando importar FenixDS; sem conflitos de resets ou z-index. Storybook opcional (portal atual + Playwright já servem de primeiro catálogo). Se segundo produto adotar e surgir duplicação real, extrair pacotes privados `@fenix/tokens` (sem React) e `@fenix/ui` (peer React), separar adapters e ativos licenciados, versionar SemVer, changelog, compatibilidade e release notes; não criar monorepo agora. Nenhum dado/serviço financeiro dentro de pacote compartilhado. CI verifica token drift, contraste, lint/typecheck/build, snapshots revisados, testes de teclado/aria e domínios; hardcodes permitidos só em primitivos/fixtures/brand asset com whitelist, não regex cega. Aprovação do proprietário para marca e extensão; estúdio para assinatura/direitos; líder técnico para componentes/contratos; QA acessibilidade para aceite. Regras de depreciação de APIs de UI com versão e remoção planejada; não manter duas fontes de dados.

## 14. Ferramentas e referências verificadas

Pesquisa em 24/11/2026. Os comandos abaixo são instruções de instalação de ferramentas, **não comandos de implementação do produto**. Não foram executados. Confirmar ambiente, versões, licenças, política de rede e permissões antes de instalar; `@latest` é a forma documentada, mas fixar versão auditada na execução real. Cloud/CLI não têm necessariamente paridade; a existência de um plugin não confirma instalação nem habilitação no ambiente do usuário.

| Recurso / mantenedor | Prioridade / ambiente | Instalação e verificação | Uso, limitações e riscos/custos |
|---|---|---|---|
| Skill de marca original `21-brand-skill` / proprietário | Essencial, Claude Code e skills compatíveis com Claude chat | Inspecionar `SKILL.md` e referências/ativos; em Code colocar diretório em `.claude/skills/<nome>/SKILL.md`, ou utilizar o ZIP da skill na interface compatível. Confirmar carregamento na lista/solicitar que cite a versão e seção | Derivar skill Gran após aprovação. Não enviar fontes Neulis ou PII a serviços externos. Custo de contexto; carregar só seção necessária |
| Skills existentes / repositório | Essenciais, Claude Code | Já presentes em `.agents/skills`, links `.claude/skills`; verificar resolução dos symlinks e conteúdo de `SKILL.md`. `ptbr-product-ui-review`, `regression-release-gate`, financial-domain-integrity, multi-tenant-security-review, firestore-scale-cost-review, billing-entitlement-integrity, privacy-lgpd-data-lifecycle, saas-commercial-readiness conforme superfície | Gates canônicos, não substituíveis por opinião estética. `playwright-cli` já contém skill local; verificar binário. Custo de testes e tokens; Haiku explora, Sonnet executa |
| Frontend Design / Anthropic | Recomendado, Claude Code | `/plugin install frontend-design@claude-plugins-official` (marketplace oficial; se ausente `/plugin marketplace add anthropics/claude-plugins-official`), verificar plugin em `/plugin` e skill carregada | Direção e composição não genérica; **precedência do DS aprovado** sobre sugestões de estilo. Revisar código/manifesto e hooks. Sem taxa específica confirmada, consumo do plano. https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design |
| Claude Design / Anthropic | Recomendado, protótipos | Artefato Design com seleção de Design System na interface; docs atuais descrevem migração do standalone para Claude. Verificar se o DS privado foi migrado e aparece no seletor; não há comando CLI universal de criação | Prototipar comparativos antes de codificar; validar equivalência com tokens e não exportar automaticamente para produção. Disponibilidade depende de conta/ambiente; consumo do plano. https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design ; https://support.claude.com/en/articles/14604416-get-started-with-claude-design |
| Playwright Test + axe / Microsoft + Deque | Essencial, repo local/cloud | Já presentes; conferir `package.json`, `npx playwright --version`, scripts E2E, browsers e ambiente Emulator. Instalação somente se faltar via lockfile; `npx playwright install` para browsers segundo docs. `expect(page).toHaveScreenshot()` e teste axe | Baseline/diffs, testes de teclado, screenshots desktop/mobile, traces. Segredos/storage state nunca em ZIP; screenshots sintéticos. Custo de CPU e tempo; sem serviço pago obrigatório. https://playwright.dev/docs/test-snapshots ; https://playwright.dev/docs/intro |
| Playwright CLI / Microsoft | Recomendado, agente de UI | Skill já no repo; se binário ausente, docs: `npm i -g @playwright/cli@latest`, `playwright-cli install --skills`; `playwright-cli --help` e teste local | Preferir CLI por economia de contexto. Não acessar produção. Sem taxa de plugin confirmada, custo de execução. https://playwright.dev/docs/getting-started-cli |
| Playwright MCP / Microsoft | Opcional, alternativa ao CLI | `claude mcp add playwright npx @playwright/mcp@latest`, verificar `claude mcp list`, conectar browser de teste isolado | Útil para navegação exploratória, não necessário se CLI suficiente; risco de prompt injection em páginas e storage state. Não instalar os dois sem demanda. https://github.com/microsoft/playwright-mcp |
| Figma MCP / Figma | Opcional, se decidir prototipação colaborativa em Figma | Preferir plugin recomendado pelo guia oficial; alternativa documentada `claude mcp add --transport http figma-remote-mcp https://mcp.figma.com/mcp`, OAuth e `claude mcp list`; conferir leitura de arquivo de teste | Tokens, variables, componentes e handoff. Não é requisito se Claude Design atende; plano e rate limits variam, acesso por OAuth e escopo. https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/ |
| Context7 / Upstash | Recomendado sob demanda, Claude Code | `claude plugin marketplace add upstash/context7` e seguir README para plugin; alternativa `npx ctx7 setup --claude` documentada; `claude mcp get context7`, confirmar docs da versão | APIs versionadas, evitar alucinações. Não transmitir código privado/chaves; eventual quota/plano externo a confirmar. https://github.com/upstash/context7/blob/master/docs/clients/claude-code.mdx |
| Storybook / equipe Storybook | Opcional após piloto DS | Framework React Vite; seguir guia de compatibilidade e inicialização no branch isolado (`npm create storybook@latest`, versão a validar); verificar build e stories. Já existe portal, não duplicar inicialmente | Catálogo isolado e addon a11y; Chromatic é serviço externo, custo conforme plano; imagens podem conter dados, usar fixtures. https://storybook.js.org/docs/get-started/frameworks/react-vite ; https://storybook.js.org/docs/writing-tests/accessibility-testing |
| Radix Primitives / WorkOS | Opcional se primitivas falharem | Avaliar somente pacote necessário, por exemplo Dialog, conforme documentação e peer deps; confirmar foco e bundle | Headless acessível, não garante produto final AA. Não instalar agora. https://www.radix-ui.com/primitives/docs/overview/accessibility |

**Recursos do ChatGPT efetivamente utilizados:** leitura estática dos ZIPs, validação CRC, inspeção de capturas históricas e varredura por código; pesquisa web em fontes primárias; Context7 para MotionConfig/reduced motion; inventário de skills/conectores disponíveis. O Figma conectado oferece workflows de biblioteca, variáveis, motion e design-to-code, mas não há arquivo Figma solicitado nem autorização para escrever: não foi usado para criar arquivo. Google Drive/Canva não são necessários para inspecionar ZIP local. Orquestrador será útil quando forem solicitados comandos de implementação (não acionado nesta fase para gerar comandos). Não instalar plugins extras simplesmente por catálogo; avaliar plugin/skill apenas quando fornecer função não existente.

### Referências profissionais e como adaptar

| Fonte (link direto) | Tipo | Aplicação ao Gran |
|---|---|---|
| [DTCG 2025.10](https://www.designtokens.org/TR/2025.10/) e [anúncio W3C Community Group](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/) | Especificação estável de comunidade, não recomendação W3C formal | Formato de intercâmbio de tokens e resolver; preservar proveniência |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Norma técnica | AA, foco, target, prevenção de erros financeiros, autenticação, contraste |
| [NN/g — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Prática fundamentada em usabilidade | Apresentar tarefas essenciais antes de opções avançadas, sem ocultar dados necessários |
| [NN/g — Response Times](https://www.nngroup.com/articles/website-response-times/) | Referência de percepção | Feedback imediato; não falsificar estado financeiro |
| [IBM Carbon — Data Visualization](https://carbondesignsystem.com/data-visualization/overview/) | Sistema de design profissional | Escolher gráfico conforme pergunta, alternativa textual e tabela |
| [Stripe Dashboard insights](https://support.stripe.com/questions/dashboard-home-page-charts-for-business-insights) | Referência de produto | Resumo para visão rápida, relatório oficial para precisão; não copiar estilo |
| [Emil Kowalski — You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations) | Prática profissional | Animação com propósito e proporcional à frequência |
| [Motion — Accessibility](https://motion.dev/docs/react-accessibility) / [MotionConfig](https://motion.dev/docs/react-motion-config) | Documentação técnica consultada via Context7 | Política global e exceções para opacity/decoração; confirmar versão local |
| [web.dev — Web Vitals](https://web.dev/articles/vitals) | Métricas técnicas | LCP, INP, CLS, medir em campo e lab |
| [Playwright — Visual comparisons](https://playwright.dev/docs/test-snapshots) | Documentação técnica | Screenshots determinísticos e aprovação humana de diferenças |
| [Radix — Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility) | Documentação técnica | Keyboard, ARIA, foco como base, avaliar adoção seletiva |
| [Claude Code — Plugins](https://code.claude.com/docs/en/plugins) e [marketplace oficial](https://github.com/anthropics/claude-plugins-official) | Documentação técnica | Instalação e escopo, auditar hooks e evitar excesso |

Referências de inspiração do catálogo (não auditoria independente de suas interfaces): Linear/Raycast (atalhos e fluidez), Figma (colaboração), Duolingo (celebração). Não copiar gamificação financeira, retenção manipulativa, cores de outras marcas ou layouts. Direção artística, raios, proporções, pesos, paleta proposta e roadmap são recomendações próprias e devem ser testados, não fatos científicos. Uma URL de atalhos Linear consultada retornou 404; não utilizada como evidência.

## 15. Plano incremental de execução futura

Não alterar ordem de P6–P10 sem revisão do gate de piloto e aprovação. O redesign é macrofase explícita; planejamento/prototipação pode correr em paralelo, mas implementar sobre base funcional estável, integrar P9 e executar auditoria final P10 depois do redesign. Restrições `AGENTS.md`/`CLAUDE.md` proíbem mudança visual até autorização; primeira rodada aprovada deve registrar nova decisão que delimita a exceção apenas ao escopo UX. Não renomear project ID, coleção, Function, billing nem repo. Não gerar comandos de implementação agora.

| Rodada | Objetivo/escopo e dependências | Aceite objetivo e testes |
|---|---|---|
| UX-00 — baseline | Inventário de cada rota, estado e papel em Emulator; conferir fase atual, arquivos, hash, UI atual, customização, fonte de dados e screenshots. Sem refatorar | Matriz rota × PF/PJ × role × estado × tema × viewport; baseline screenshots/axe/keyboard/perf e build; lista de hardcodes classificados e fluxos críticos; sem escrita produção |
| UX-01 — identidade e direção | Aprovar símbolo/nominal/slogan, paleta unificada e licenças, mockups comparativos claro/escuro em Dashboard, transação e mobile; depende de UX-00 e aprovação | Lockup/ícone/área de proteção aprovados, Neulis condicionada, tokens candidatos contrastados; testes qualitativos de confiança/compreensão; sem substituir código ainda |
| UX-02 — tokens/temas | Core e Gran, resolver e adapters v3, CSS vars, preview de tokens, estado reduzido, tema automático; depende de identidade | Build determinístico, aliases válidos, contraste em todos os pares críticos, no flash; tema inválido recusado; workspace accent não invade semântica; testes unitários e visual |
| UX-03 — primitivas e catálogo | Botões, campos, estados, overlays, navegação básica, wrappers de dados e iconografia, portal/storybook conforme ADR | Estados e variantes documentados; keyboard/focus/Escape/portal, 320/375/768/1440 px, zoom, light/dark/custom; axe zero novas violações e backlog tratado; nenhuma alteração de contrato |
| UX-04 — shell e dashboard | Sidebar/header/workspace, período, responsive, dashboard, charts e tempo | Rotas acessíveis, PF/PJ e papéis, sem overflow indevido, valores idênticos em fixtures, estimativa não provada não convertida, perfil switch sem vazamento; before/after e E2E |
| UX-05 — movimentações/contas/cartões | Principal jornada financeira: lançamentos, contas, transferências, cartões/faturas | Testar create/confirm/edit/void, retry mesma intenção, quotas, transferência e pagamento sem dupla despesa, erro/pending/reload; comparação de ledger e permissões; axe e snapshots |
| UX-06 — planejamento e patrimônio | Recorrentes, empréstimos PF/PJ, investimentos simples, metas | Aportes/resgates, cronograma, principal/juros, recorrência real vs projeção, status metas e confete raro; E2E positivo/negativo, regressão de valores |
| UX-07 — colaborativo e PJ | Split, reembolso, clientes/recebíveis, notificações | PII ausente a viewer/member, rateio exato, quitação sem caixa, aprovação/reembolso por conta, receipt parcial, destino notificação/role; testes cross-tenant e teclado |
| UX-08 — análise e configurações | Relatórios, IA, tempo e wizard, preferências avançadas, pricing autenticado, admin | Agregados preservados, consentimento/quotas, gráficos com tabela, sem conversão errada; tema preview/reset, sync somente se aprovada e testada; billing/PII gates |
| UX-09 — produtividade e motion | Aplicar matriz aprovada, atalhos, drawer, densidade, sons opcionais, onboarding, sem novos serviços desnecessários | Reduced motion desliga decoração, estados server-first, atalho não interfere com input, testes de frequência/perf, sem loops, sem requests extras injustificadas |
| UX-10 — P9 landing/comercial | Landing, cadastro, pricing/legal e SEO, marketing chunks separados | Conteúdo verificável, navegação/touch, consentimento/aceite versionado, LCP/CLS, acessibilidade e cadastro real; gate comercial e privacidade; disponibilidade/piloto respeitados |
| UX-11 — validação transversal e P10 | Auditoria de todos os fluxos, contraste, compatibilidade, usuários, perf e segurança; correção de gaps | Gates do repo, zero blockers visuais/funcionais/segurança, AA auditado, matriz atualizada, testes de leitores de tela e cross-browser, comparação de tarefa; relatório e autorização separada de publicação |

**Contrato de cada rodada:** objetivo, escopo e arquivos, dependências, ADRs/decisões, critérios de aceite antes de editar, testes dirigidos (unit/integração/Rules/E2E conforme impacto), screenshots antes/depois, axe e manual, bundle/requests comparados, revisão de regressão e privacidade, relatório pt-BR com evidências, falhas/correções, riscos, comandos executados/contagens reais, `git diff --check`, ZIP cumulativo sem `.git`, node_modules, caches, secrets, logs/PII, ZIPs antigos ou fontes não licenciadas, symlinks preservados, teste CRC/round-trip e SHA-256. Não avançar automaticamente após gate FAIL nem mascarar falhas; supervisor compara código e relatório antes de próxima autorização. Gate `verify:all` final do conjunto coerente conforme docs e `regression-release-gate` obrigatório; usar scripts reais do repo. Sem commit/push/deploy/produção. Preservar contrato financeiro server-side, RBAC, isolamento, cents, idempotência e histórico. Teste visual não substitui financeiro.

**Roteamento econômico futuro:** modelo principal mais capaz para direção, integração de tokens, ADR, conflitos de arquitetura/segurança e revisão final; Sonnet para implementação especificada e componente por fatia; Haiku para exploração seletiva, inventário, execução/logs de testes; QA de acessibilidade revisa evidência e casos manuais, não somente axe. Nomes/modelos disponíveis no ambiente devem ser verificados (não pressupor versão). Usar `repo-explorer`, `implementation-worker`, `test-runner` já existentes; carregar apenas skills tocadas e documentação de versão. Um comando por rodada após aprovação, sem microcomandos e sem scripts globais desnecessários. Relatórios e ZIPs são handoff oficial do projeto.

## 16. Registro de riscos e decisões a aprovar

| ID | Risco/decisão | Impacto | Mitigação e recomendação |
|---|---|---|---|
| UX-D01 | Unificar as duas paletas somente no Gran | Alto marca | Aprovar formalmente extensão; manter Power/Vita intactas |
| UX-D02 | Nominal/símbolo/tagline | Alto marca/direitos | Aprovar novo lockup com estúdio e licença; não publicar marca provisória |
| UX-D03 | Licença Neulis web/app | Crítico de publicação | Usar Urbanist até comprovação; OFL incluída |
| UX-D04 | Personalização livre vs AA | Alto | Overrides restritos, contraste e preview, fallback corrigido, modo alto contraste avaliado |
| UX-D05 | Tema global vs workspace | Médio | Separar identidade, preferência e contexto de organização; cor do workspace não significa estado financeiro |
| UX-D06 | Dependências e framework | Alto | Manter versões atuais; ADR separado para upgrades; medir bundle |
| UX-D07 | Reorganização de navegação | Alto usabilidade | Teste de card sorting/tarefas e acesso PF/PJ/role; deep links/voltar com decisão técnica |
| UX-D08 | Dados em UI otimista | Crítico | Somente local/inócuo; confirmação de dinheiro pelo backend, reversão autorizada |
| UX-D09 | Motion/áudio e gamificação | Médio/alto | Desligado som por padrão, reduced motion, confete raro, nada de streak/punição |
| UX-D10 | Capturas e telemetria | Alto privacidade | Fixtures sintéticas, sem PII, nenhum envio de produção a terceiros |
| UX-D11 | Sincronizar preferências | Médio | Primeiro local, depois ADR/RBAC/schema privado; avaliar custo Firestore |
| UX-D12 | Ordem do roadmap/piloto | Alto | Aprovar momento do redesign, preservar blockers P6–P10, não adiar segurança por estética |
| UX-D13 | Compartilhamento entre apps | Médio | Extrair pacotes só com segundo consumidor; controlar versões e assets licenciados |
| UX-D14 | Acessibilidade de charts e tnum | Alto | Auditoria humana; validar fonte numérica OFL e tabela alternativa |
| UX-D15 | Presets/recursos antigos | Médio | Definir quais manter/migrar visualmente, preservar preferências úteis; revisar 3D/capas/emojis opt-in |
| UX-D16 | Landing sem evidência de oferta pública | Alto | Integrar P9 ao estado real do piloto, planos e legal; não inventar prova social |

## 17. Recomendação e conclusão

Aprovar a estratégia em princípio, não o redesign inteiro de uma vez. A primeira decisão visual deve ser o núcleo Fênix e a expressão Gran (paleta unificada, logo, tipografia e padrão de personalização). Em seguida, UX-00 e UX-01 podem produzir evidência comparativa suficiente para confirmar se a direção reduz aparência infantil sem sacrificar a identidade. Testar uma amostra representativa (dashboard + lançamento financeiro + mobile + personalização) antes de escalar para todos os módulos. Não abandonar o projeto financeiro consolidado, não criar um segundo app, não atualizar stack por causa de animação, nem adotar efeitos genéricos em massa. A versão final deve ter unidade, legibilidade, resposta previsível e confiança — a identidade deve funcionar mesmo com todo motion e som desativados.
