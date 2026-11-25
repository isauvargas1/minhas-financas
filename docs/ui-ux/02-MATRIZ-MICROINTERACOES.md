# FênixGran — Matriz individual do catálogo de efeitos e microinterações

**Proposta para aprovação • 24/11/2026**

Fonte: `Catálogo de efeitos e microinterações para UI UX em React + TypeScript + Node.md`, seções correspondentes. A coluna benefício reproduz sinteticamente o propósito presente no catálogo, não um resultado observado no produto. A decisão é proposta contextualizada, não implementação. A=aplicação autenticada; L=landing/marketing; E=essencial (fundação/feedback/acessibilidade); R=recomendado; O=opcional condicionado; L=restrito à landing; X=evitar/adiar. Quando o contexto contém A+L vale para os dois. RM=movimento reduzido. A classificação de uma técnica como essencial não torna obrigatória uma biblioteca específica.

## Política transversal (aplica-se a cada linha)

- Frequência: E em todo contexto pertinente; R quando melhora a tarefa; O só por opção/necessidade comprovada; L no máximo uma vez por seção/visita, não em loop; X não implementar no escopo inicial. Intensidade: ação diária mínima, raros marcos mais expressivos. As durações específicas abaixo são propostas, não medições.
- Mobile: toque/foco equivalentes ao hover, teclado virtual não encoberto, alvo 44 px ideal; gesto nunca único meio de operar. Sem hover/tilt/parallax que dependa do mouse no touch. Sem movimento que prejudique leitura ou scroll. Desktop/tablet com teclado e pointer fino.
- Desempenho: CSS primeiro, Framer Motion 10 existente quando necessário, `transform`/`opacity` preferidos; medir custo, bundle, INP, CLS; sem listeners/consultas extras por estética. Sem loops; lazy para mídia. Efeitos classificados O/L de custo maior dependem de prova de valor. Nenhuma atualização de React/Tailwind implícita.
- Acessibilidade: reduced motion do SO prevalece; desativar deslocamentos, partículas, som/háptica quando preferências exigirem, usar estado estático/feedback textual; foco e aria-live, teclado, contraste WCAG 2.2 AA. Temas: todos os estados usam tokens semânticos e pares testados; cor/forma/texto, nunca apenas cor. Ações críticas sempre recebem feedback visual/textual independentemente das preferências; decoração é opt-in/desativável, sem desativar segurança ou feedback obrigatório.
- Segurança financeira: confirmar dinheiro somente depois do backend; retry mesma intenção; sem hard delete, undo genérico ou dados em URL/cache cross-tenant; sem SSE/Redis/SQL/CRDT adicionados por efeito. Nenhuma dependência instalada nesta análise.

## Hover e foco

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M001 — Estado de hover em tudo que é clicável | "Isto é clicável" | E | A+L, todos os controles | 80–140 ms; somente ponteiro fino | foco/toque equivalentes; sem hover pegajoso |
| M002 — Cursor certo | O sistema "fala" com o mouse | E | A+L, ações e arrastáveis | imediato | cursor não substitui rótulo ou disabled real |
| M003 — Spotlight que segue o mouse em cards | Profundidade e luxo | L | hero ou demonstração isolada | só enquanto ponteiro ativo, 1 elemento | opcional; desativar touch/reduced; CSS/rAF sem listener Firestore |
| M004 — Borda com brilho animado | Destaque premium | L | CTA comercial destacado, se realmente necessário | breve, sem loop | contraste estável; preferir borda estática |
| M005 — Inclinação 3D (tilt) | O card parece físico | X | cartões financeiros | não adotar | flip/tilt dificulta leitura; alternativa card plano |
| M006 — Botão magnético | O botão "puxa" o cursor | X | CTA e tarefas | não adotar | deslocar alvo é risco de usabilidade; press estável |
| M007 — Sublinhado animado em links | Elegância | R | A+L links de navegação | 120–160 ms | texto corrido sempre sublinhado ou sinal inequívoco |
| M008 — Ações reveladas na linha (editar, copiar, excluir) | Tela limpa, poder à mão | R | A, tabelas/recorrências | 120 ms | foco e menu sempre disponíveis; touch mostra ações |
| M009 — Tooltip com atraso inteligente | Ajuda sem incomodar | E | A, ícones e rail | atraso ~700 ms; entrada 120 | rótulo acessível; não ocultar informação indispensável |
| M010 — Cartão de prévia (hover card) | Ver detalhes sem sair da lista | O | A, cliente/fatura quando cache já autorizado | 180 ms | não requisitar PII no hover; acesso por clique/foco |
| M011 — Pré-carregar na intenção | A próxima tela abre instantânea | O | A, rotas/consulta cacheada | sem efeito | limitar por intenção e tenant; medir leituras; manter stack |
| M012 — Foco visível caprichado | Quem usa teclado se sente em casa | E | A+L todos controles | 0–80 ms | anel sólido contrastado, jamais remover outline sem substituto |

## Clique e toque

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M013 — Botão que afunda ao pressionar | O botão é físico | R | A+L, botões comuns | 100–140 ms, scale .98 | não deslocar layout nem impedir clique; RM sem scale |
| M014 — Mola ao soltar | Resposta elástica, natural | O | A, switch/drag opcional | amortecida, sem quique, 140 ms | preferir CSS; desativar RM |
| M015 — Botão com estados: ocioso, carregando, sucesso, erro | "Vi que deu certo" sem ler nada | E | A, salvar/pagar/confirmar | feedback imediato; check 180 ms só após resposta | pending e mesma chave de retry; largura estável |
| M016 — Ondulação (ripple) a partir do ponto clicado | O clique "espalha" | X | A, botões | não adotar padrão | ruído visual e custo; press discreto substitui |
| M017 — Interruptor (switch) com mola | Liga e desliga com prazer | R | A, preferências não financeiras | 140 ms sem overshoot | rollback se rejeitado; aria-checked |
| M018 — Checkbox com traço desenhado | Conclusão satisfatória | R | A, checklist individual | 140–180 ms | massa sem animação; foco visível |
| M019 — Favoritar com pequena explosão | Recompensa afetiva | X | A, favoritos | não adotar | não há caso confirmado; check simples |
| M020 — Copiar para a área de transferência | Confirmação instantânea | E | A, copiar identificador permitido | feedback 1,5 s | aria-live; confirmar clipboard real; proteger dados |
| M021 — Segurar para confirmar | Ação destrutiva com segurança, sem pop-up | X | A, estorno/void | não adotar como requisito | confirmação explícita e resumo; não gesto exclusivo |
| M022 — Arrastar com física | Objeto real nas mãos | O | A, reordenar preferências se feature aprovada | curto e interrompível | alternativa teclado/botão; sem mover dinheiro |
| M023 — Deslizar item de lista (celular) | Gesto nativo de app | O | A mobile, revelar ações não destrutivas | 140–180 ms | sem executar mutação no swipe; menu alternativo |
| M024 — Puxar para atualizar (PWA) | Sensação de app instalado | O | A PWA, recarregar consulta autorizada | nativo ou botão | evitar conflito navegador e múltiplas leituras; não submeter mutação |
| M025 — Área de toque generosa | Nunca errar o clique | E | A+L touch | imediato | 44 px meta; 24 px AA com exceções; sem overlay invisível interceptando |
| M026 — Destaque de toque próprio | Acabamento de app nativo | R | A mobile | 80 ms | preservar tap highlight se não houver substituto acessível |

## Transições de página e de layout

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M027 — Troca de rota com direção (avançar desliza para a esquerda, voltar para a direita) | Navegação entre lista e detalhe | R | A, lista→detalhe/drawer | fade 140–180 ms, direção só em fluxo raro | sem React 19 obrigatório; não bloquear navegação |
| M028 — Elemento compartilhado (a miniatura vira a ficha) | Lista de clientes, produtos, alunos | O | A, meta/detalhe selecionado | 180–220 ms | somente se continuidade ajuda; sem animar tabelas |
| M029 — Revelação do Suspense (esqueleto vira conteúdo) | Telas que buscam dados | R | A, atualização de bloco | fade 120–180 ms | manter layout; não ocultar estado de erro ou usar ViewTransition inexistente no React 18 |
| M030 — Saída animada do que é condicional | Modal, popover, item removido | R | A, overlay e toast | 120–160 ms saída | devolver foco; não atrasar confirmação |
| M031 — Menu que nasce do gatilho | Dropdowns, selects, popovers | R | A, menus/popovers | 140–180 ms, scale .98 | origem do trigger; portal e escape |
| M032 — Indicador de aba que desliza | Abas, filtros segmentados, item ativo do menu | R | A, tabs/filtros | 120–180 ms | label e aria-selected; teclado sem atraso |
| M033 — Grade que se reorganiza ao filtrar ou ordenar | Listas de cards, kanban, galerias | O | A, metas/split cards pequenos | 180 ms | não reordenar durante digitação; evitar listas grandes |
| M034 — Card que expande no lugar | Resumo que vira detalhe | O | A, detalhe de meta ou resumo | 180–220 ms | drawer/expand com botão; não esconder informação financeira |
| M035 — Acordeão suave | Filtros avançados, perguntas frequentes | R | A+L, filtros avançados/FAQ | 180–220 ms | CSS simples ou Motion; sem animação de lista longa |
| M036 — Entrada em cascata (stagger) | Primeira carga de um painel ou lista | L | primeira apresentação/hero | 30–40 ms entre até 6 itens | não repetir no app; conteúdo disponível sem JS |
| M037 — Troca de tema com círculo que se expande do botão | Botão claro/escuro | O | A, troca de modo | 0–180 ms fade | círculo expansivo não padrão; preservar foco e RM |

## Rolagem

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M038 — Barra de progresso de leitura | Contratos, termos, artigos longos | O | L, termos/guia longo | vinculada à rolagem | não substituir sumário; barra estática no RM |
| M039 — Revelação ao entrar na tela | Landing, onboarding, relatórios longos | L | L e onboarding raro | 400–560 ms uma vez | conteúdo disponível mesmo se observer falhar |
| M040 — Cabeçalho que ganha sombra ao grudar | Barra superior, cabeçalho de seção | R | A, header sticky | 100 ms | borda/sombra leve; não encobrir foco; fallback CSS |
| M041 — Sombra nas bordas de áreas roláveis | Tabelas largas, listas dentro de modais | R | A, tabela local/drawer | 80–140 ms | indicador de overflow e keyboard; não cobrir texto |
| M042 — Cabeçalho de tabela e primeira coluna fixos | Qualquer tabela de dados | R | A, tabelas financeiras | sticky sem animação | contraste, reflow, teclado e scroll regional |
| M043 — Manter a posição ao voltar | Lista que abre detalhe e volta | E | A, lista e detalhe | imediato | manter filtros/scroll por workspace; limpar ao trocar conta |
| M044 — Carregar mais ao chegar ao fim | Feeds, históricos, auditorias | R | A, histórico paginado | botão explícito; skeleton | cursor/limites existentes; não scan global nem scroll infinito obrigatório |
| M045 — Carrossel com encaixe | Planos, cards de destaque | O | L, planos ou demo | scroll-snap nativo | botões, sem autoplay; comparação de planos em tabela preferível |
| M046 — Parallax leve | Páginas de marketing | L | L, grafismo não informativo | deslocamento curto, sem loop | RM, touch e performance; estático por padrão |
| M047 — Botão "voltar ao topo" | Páginas longas | O | A+L, páginas longas | fade 140 ms | não cobrir controles; foco volta ao destino |
| M048 — Rolagem suave para âncoras | Índices, links internos | R | L e âncoras de ajuda | 140–220 ms ou nativo | mover foco; instantâneo no RM |
| M049 — Fundo travado sob modal | Modais e drawers | E | A, modal/drawer | imediato | bloquear fundo sem salto, scroll próprio, foco preso |
| M050 — Rolagem "amanteigada" (Lenis) | Só sites de marketing | X | A e L por padrão | não instalar Lenis | rolagem nativa mais acessível, só reavaliar marketing com prova |

## Velocidade percebida

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M051 — UI otimista | "Funcionou na hora" | R | A, aparência/favoritos sem dinheiro | imediato | somente ação inócua; rollback; nunca confirmar saldo/pagamento otimista |
| M052 — Esqueleto com a forma do conteúdo | "Já está chegando" | E | A, dashboard/listas | layout estável, pulso opcional | não simular zeros; RM estático |
| M053 — Atraso antes de mostrar o carregamento | Nada pisca à toa | R | A, loading curto | busy imediato; spinner após ~250 ms | não esconder estado; sem piscar |
| M054 — Manter a tela anterior enquanto a nova carrega | Filtro e paginação sem tela vazia | R | A, filtros/consulta mesmo escopo | manter anterior rotulado | não manter dados de outro tenant/role nem mostrar estimativa obsoleta como atual |
| M055 — Pré-carregar dados | A próxima tela já vem pronta | O | A, rotas de uso frequente | sem motion | cache autorizado, limite de reads, cancelar intenção; medir custo |
| M056 — Streaming por blocos | O topo aparece já; o resto chega aos poucos | R | A, blocos independentes | fade curto | ErrorBoundary e queries existentes; sem migração SSR forçada |
| M057 — Imagens com blur-up | Nada "pula" | O | L, mídia de produto | fade 150 ms | dimensões fixas, lazy, sem imagens não licenciadas/PII |
| M058 — Barra de progresso no topo | Navegação com sensação de avanço | O | A, navegação realmente assíncrona | após 250 ms | progresso indeterminado honesto; não simular percentuais |
| M059 — Busca instantânea | Resultado enquanto digita | R | A, filtro/busca | debounce 150–250 ms | cancelamento e índices Firestore; não sugerir SQL/trigram sem suporte |
| M060 — Listas enormes fluidas | Rolagem sem engasgo | R | A, histórico grande | sem animação | paginação existente primeiro; virtualizar só se medido, preservar teclado |
| M061 — API rápida no Node | Tudo acima fica crível | E | A, Functions/Firestore | sem motion | medir, limites/índices/cache por tenant; não impor Node server SQL ou ETag em callable sem ADR |

## Feedback do sistema

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M062 — Toasts bem-feitos | Confirmação sem interromper | E | A, mutação e operação importante | 140–180 ms | sucesso só server; erro grave persistente; aria-live, toast existente antes de instalar Sonner |
| M063 — Desfazer no lugar de "Tem certeza?" | Rapidez sem medo | R | A, preferência reversível | 5–8 s de opção | dinheiro exige reversal autorizado, nada de hard delete posterior |
| M064 — Validação inline | Corrige antes de enviar | E | A, formulários | validação em blur/submit e limpar erro | backend autoritativo, parsing cents, não validar cedo demais |
| M065 — Erro que ensina | "Sei o que fazer agora" | E | A+L, falhas | imediato, texto claro | sem stack trace/PII; retry mesma intenção, distinguir offline/permissão |
| M066 — Tremida em senha errada | Gesto universal de "não" | X | login Google atual | não adotar | não há campo senha confirmado; mensagem textual preferível |
| M067 — Números que rolam | Os KPIs parecem vivos | O | A, KPI confirmado, raro | 160–220 ms | sem odômetro em digitação, RM ou estimativa; valor final para leitor |
| M068 — Salvamento automático visível | Tranquilidade | O | A, aparência/rascunho não sensível | debounce e status | nunca autosave de lançamento real; não persistir PII em localStorage |
| M069 — Progresso de tarefas longas | Sabe quanto falta | R | A, import/export se disponível | progresso real, não simular | backend job existente; cancelamento só se suportado; não inventar SSE |
| M070 — Estado vazio caprichado | Saber o primeiro passo | E | A, listas e gráficos vazios | imediato | diferenciar vazio, filtro, erro, permissão e loading; CTA permitido |
| M071 — Indicador "ao vivo" | Algo está acontecendo agora | O | A, conexão/status realmente ativo | indicador estático | sem pulso infinito, texto; não sugerir realtime falso |
| M072 — Contador e medidor em campos | Sem surpresas | R | A, limites de input | imediato | texto e valor, não cor só; não inventar senha inexistente |
| M073 — Formulário que respeita o esforço | Nada se perde | E | A, formulários | sem animação | preservar input em falha apropriada; não guardar PII indevida |

## Som e háptica

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M074 — Sucesso importante (pagamento recebido, tarefa concluída) | "Plim" curto e agudo | O | A, conclusão excepcional confirmada | som curto, uma vez, volume baixo | desligado por padrão; local licenciado; visual sempre |
| M075 — Notificação em tempo real (novo pedido, nova mensagem) | Tom distinto e reconhecível | O | A, notificação escolhida | som curto com agrupamento | aba oculta só opt-in; não vazar informação; sem playback automático |
| M076 — Erro grave | Tom grave e curto | O | A, erro crítico | curto, não alarmista | texto persistente; não repetir em retry |
| M077 — Celebração (meta batida, primeiro cadastro) | Acorde ascendente | O | A, meta/cadastro excepcional | acorde breve, uma vez | opt-in e respeito movimento/som; sem manipulação |
| M078 — Toques mecânicos (interruptor, soltar item arrastado) | Clique quase inaudível | O | A, preferências/drag | clique mínimo | desligado por padrão; nunca em toda ação; alternativa visual |

## Produtividade que vicia

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M079 — Paleta de comandos (Ctrl/⌘+K) | "Faço tudo sem tirar a mão do teclado" | R | A desktop, paleta ações/rotas | imediato | cmdk só após gap/ADR; filtrar por RBAC, backend revalida; alternativa touch |
| M080 — Atalhos de teclado e sequências | Poder de usuário avançado | R | A, navegação/lancamentos | imediato | não interferir input/atalhos SO; sem ação destrutiva por tecla única |
| M081 — Dicas de atalho na interface | Aprende sem manual | R | A, menus/tooltips | imediato | Ctrl/⌘ apropriado, lista de atalhos acessível |
| M082 — Navegação por setas em listas | Percorre registros como num e-mail | R | A, tabelas/listas | imediato | foco visível e sem capturar teclas de leitor; Enter abre detalhe |
| M083 — Edição inline | Corrige sem abrir formulário | O | A, nome/preferência não crítica | feedback local e confirmado | dinheiro usa formulário autorizado e confirmação, não autosave otimista |
| M084 — Seleção múltipla e ações em massa | Resolve 50 itens de uma vez | O | A, listas se backend suportar lote | sem motion | não inventar batch, quota/limite/RBAC/reversal; confirmar escopo |
| M085 — Menu de contexto (botão direito) | Sensação de software de desktop | O | A, tabela desktop | imediato | mesmas ações no menu visível/touch, não excluir por gesto |
| M086 — Painel lateral de detalhes | Ver e editar sem perder a lista | R | A, faturas/transações/recebíveis | 220–260 ms | foco/portal, manter posição; deep link só após ADR |
| M087 — Soltar arquivos em qualquer lugar | Importar sem procurar botão | O | A, importação aprovada | overlay discreto | tipo/tamanho/preview no servidor; sem upload arbitrário |
| M088 — Colar para criar | Mágica do dia a dia | O | A, importar linhas se feature real | preview estático | checar formato, cents, quotas, limites; nunca gravar diretamente |
| M089 — Desfazer e refazer globais | Liberdade para experimentar | X | A, undo/redo global financeiro | não adotar | reversals por domínio; undo local só preferência/campo |
| M090 — Estado na URL e visões salvas | Volta exatamente onde parou | R | A, filtros/visões | sem animação | não incluir PII em URL; estado via arquitetura atual/ADR; RBAC no acesso |
| M091 — O sistema lembra as escolhas | "Ele me conhece" | R | A, densidade/colunas/filtros | imediato | escopo uid/workspace; reset e limpeza logout; sync só com aprovação |

## Encantamento e recompensa

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M092 — Confete | Primeiro pagamento recebido, plano ativado, 100º cliente | O | A, meta excepcional confirmada | 360–560 ms uma vez | opt-in, sem repetir a cada montagem; RM desliga e não celebrar risco |
| M093 — Tela de conclusão caprichada | Fim de um fluxo importante | R | A, onboarding/conclusão rara | check 180–220 ms | texto, próxima ação, não atraso obrigatório |
| M094 — Checklist de primeiros passos com barra | Primeiros dias de uso | R | A, onboarding | barra estável, 140 ms | dispensável, progresso real, não bloquear usuário avançado |
| M095 — Mascote ou ilustração que reage | Estados vazios, sucesso, erro, espera longa | X | A, mascote reativo | não adotar como padrão | preservar maturidade; Fluxo estático em vazio, texto útil |
| M096 — Saudação útil | Ao abrir o sistema | R | A, dashboard | sem animação | dados autorizados reais; vencimentos apenas se fonte pronta; sem promessa |
| M097 — Retrospectiva do mês ou do ano | Virada do mês, fim de ano | O | A, retrospectiva | 180–360 ms rara | agregados oficiais, opt-in; não compartilhar PII por padrão |
| M098 — Easter egg | Usuários curiosos | X | A, easter egg | não adotar | custo sem valor financeiro; tema normal acessível |
| M099 — Personalização | Configurações do perfil | E | A, aparência | preview imediato | resolver de tema, contraste e reset; sem scripts de usuário |
| M100 — Texto que se revela ou brilha | Títulos de landing e telas de conquista | L | L, título/hero | 400–560 ms uma vez | heading semântico íntegro; sem split de leitura; CSS primeiro |
| M101 — Cena 3D | Só landing pages | L | L, só se explicar produto | lazy e alternativa estática | não adotar inicialmente; custo GPU e acessibilidade |

## Tempo real com Node

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M102 — Lista e painel que se atualizam sozinhos | "O sistema está acontecendo agora" | R | A, atualizações reais já autorizadas | mudança discreta 120 ms | Query/Firestore existentes; não criar listener por efeito; evitar flicker |
| M103 — Canal só de ida (servidor para tela) | Notificações e progresso confiáveis | X | A, SSE adicional | não adotar inicialmente | Firebase já fornece recursos; ADR se gap de tarefa longa |
| M104 — Canal de ida e volta | Chat, colaboração, presença | X | A, Socket.IO/Redis | não adotar | sem requisito de colaboração que justifique infraestrutura |
| M105 — Presença ("Ana está vendo este registro") | Não pisa no trabalho do colega | X | A, presença | adiar | privacidade/custo; não criar TTL/heartbeat por estética |
| M106 — Cursores ao vivo | Colaboração "estilo Figma" | X | A, cursores ao vivo | não adotar | edição financeira não é canvas colaborativo; risco de exposição |
| M107 — "Fulano está digitando…" | Conversa natural | X | A, digitando | não adotar salvo chat real | estado efêmero e privado, sem necessidade comprovada |
| M108 — Edição simultânea sem perder dados | Confiança total | E | A, conflito edição | mensagem imediata | preservar versionamento/backend, não CRDT de ledger; informar reload/retry |
| M109 — Sino de notificações | Nada importante passa despercebido | E | A, sino | badge estável; 120 ms opcional | lidas/privadas e destino autorizado; nome acessível; sem loop |
| M110 — Push no celular e no desktop | O sistema avisa mesmo fechado | O | A PWA, push | sem motion | consentimento contextual, sem valor/PII na lockscreen, infraestrutura/TTL aprovado |
| M111 — Status da conexão visível | Sabe quando confiar no que vê | E | A, conexão | banner discreto e texto | indicar cache/estado real; retry com backoff; não enfileirar escrita offline |

## Acabamento visual

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M112 — Tema claro e escuro | Conforto o dia todo | E | A+L, tema | sem flash, 0–140 ms | dois modos mesma identidade; contraste de todos estados; SO automático |
| M113 — Paleta em OKLCH | Cores harmônicas em todos os tons | R | A+L, escalas e geração | sem motion | DTCG/sRGB de fallback, gamut e contraste; Tailwind 3 mantido |
| M114 — Sombras em camadas | Profundidade realista | R | A+L, superfícies | sombras estáticas 3 níveis | sem efeito dramático; foco não depender de sombra |
| M115 — Bordas e raios consistentes | Tudo parece da mesma família | E | A+L, componentes | estático | tokens raio 6/8/12/16; controles 3:1 quando aplicável |
| M116 — Números tabulares | Valores alinhados que não "dançam" | E | A, moeda/tabela | estático | Urbanist/Neulis sem tnum; validar fonte numérica ou alinhar colunas |
| M117 — Títulos equilibrados | Quebras de linha elegantes | R | A+L, títulos | estático | text-wrap onde suportado, sem corte; fallback natural |
| M118 — Fonte variável bem carregada | Texto nítido sem pulo | E | A+L, fontes | swap e dimensionamento | licença e local; não incluir Neulis pública sem comprovante |
| M119 — Ícones de um só conjunto | Coerência visual | E | A, ícones | estático | Lucide padrão, packs opcionais só paridade; rótulo e contraste |
| M120 — Vidro fosco com moderação | Camadas leves e modernas | O | A header/popover ou L | estático, blur limitado | fallback opaco, contraste; sem blur em tabela |
| M121 — Textura e gradiente sutis | Personalidade sem poluição | L | L, hero/onboarding | textura estática | usar grafismos oficiais; sem gradiente no logo, evitar ruído |
| M122 — Barra de rolagem sem salto | Nada se mexe ao abrir um modal | R | A, modal e scroll | estático | scrollbar-gutter/fallback, evitar layout shift |
| M123 — Cor da marca nos detalhes nativos | Identidade até no mínimo | R | A+L, seleção e inputs | imediato | accent-color e foco acessível por tema |
| M124 — Aba do navegador viva | O sistema chama de volta | O | A, PWA badge | imediato | não vazar dados no título/lockscreen; preferências e suporte |
| M125 — Densidade ajustável | Cada um no seu ritmo | E | A, listas | instantâneo | compacta só desktop; 44 touch e zoom preservados |
| M126 — Avatar com reserva | Nenhum buraco na tela | R | A, perfil/workspace | estático | iniciais/ícone com contraste; sem informações sensíveis |

## Performance, acessibilidade e quando NÃO animar

| ID / efeito | Benefício / finalidade no catálogo | Classe | Contexto | Intensidade e duração | Guarda específica / alternativa |
|---|---|---|---|---|---|
| M127 — Anime só `transform` e `opacity` | [Pulam layout e pintura](https://emilkowal.ski/ui/great-animations) e ficam fluidas mesmo com a thread ocupada | E | A+L, motion | transform/opacity preferidos | CSS simples, FLIP só onde útil; cor curta aceitável; sem layout caro |
| M128 — `will-change` só durante a animação | Cada camada extra consome memória de GPU | E | A+L, motion | somente durante efeito | evitar memória GPU permanente |
| M129 — Bundle enxuto | Biblioteca pesada atrasa o primeiro uso | E | A+L, bundle | lazy e medido | preservar stack; marketing isolado; sem libs redundantes |
| M130 — Responsividade medida | O que não é medido piora em silêncio | E | A+L, performance | medir p75 campo e lab | INP≤200 ms meta; CPU/Android, sem coletar PII |
| M131 — Pause o que não está visível | Loops fora da tela gastam bateria | E | A+L, visibilidade | pausa imediata | observer/hidden; preferir não loop; não suspender lógica financeira |
| M132 — Respeite `prefers-reduced-motion` | Critério [WCAG 2.3.3](https://w3.org/WAI/WCAG21/Understanding/animation-from-interactions) | E | A+L, reduced motion | 0–80 ms | SO prevalece; MotionConfig + CSS + canvas/audio próprios |
| M133 — Opção "Reduzir animações" no sistema | Nem todo mundo conhece a opção do sistema operacional | E | A, preferências | imediato | sistema/reduzido/desligado, preview sem sons automáticos |
| M134 — Movimento automático com controle | Critério [WCAG 2.2.2, nível A](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide): o que se move sozinho por mais de 5 s precisa poder ser pausado | E | A+L, automáticos | controle visível | evitar autoplay e loop; 2.2.2 conforme aplicabilidade |
| M135 — Sem flashes | Risco de crise fotossensível | E | A+L | nenhum flash | prevenir estímulo fotossensível, não usar strobe |
| M136 — Foco bem cuidado | Teclado e leitor de tela não se perdem | E | A+L, overlays/teclado | foco imediato | portal/focus trap, retorno, Esc seguro e não obscurecido |
| M137 — Anúncios para leitor de tela | Quem não vê também recebe o feedback | E | A+L, feedback | aria-live apropriado | não anunciar cada frame/número; erro não some sozinho |
| M138 — Nada só por cor, som ou movimento | Daltonismo, aparelho no mudo, movimento reduzido | E | A+L, semântica | sempre texto/forma | sinais, labels, hachuras; personalização não muda significado |

## Fechamento

138 linhas avaliadas individualmente. As diretrizes complementares fora das tabelas (háptica, som, quando não animar) seguem a política transversal: háptica opcional e detectada, sem dependência no iOS; som local licenciado, baixo e desligado por padrão, só após gesto, sem informação exclusiva; nenhum movimento enquanto digita, em ações repetitivas ou em tabelas densas. As bibliotecas do catálogo são possibilidades, não dependências aprovadas. O roteiro de ondas foi adaptado às rodadas UX-02 a UX-11 do relatório principal.
