# Catálogo de efeitos e microinterações para UI/UX em React + TypeScript + Node

Nov 24, 2026 · @RI Parauapebas

## O que gera o "UAU"

O "UAU" vem de três coisas juntas: resposta instantânea a cada ação, movimento que explica o que mudou e poucos momentos de celebração bem escolhidos. Animar tudo produz o efeito contrário num sistema usado o dia inteiro.

| Princípio | O que diz | Como aplicar no sistema |
| --- | --- | --- |
| Limites de tempo de resposta ([NN/g](https://www.nngroup.com/articles/website-response-times/)) | Até 0,1 s parece que o próprio usuário causou a mudança; até 1 s o raciocínio não se interrompe; após 10 s a atenção se perde | Feedback visual no mesmo quadro do clique; acima de 1 s, indicador de progresso; acima de 10 s, porcentagem e botão de cancelar |
| Limiar de Doherty ([Laws of UX](https://lawsofux.com/doherty-threshold/)) | A produtividade dispara quando sistema e usuário interagem em menos de 400 ms | Meta de resposta percebida abaixo de 400 ms em toda ação principal, com UI otimista quando o servidor demorar mais |
| Regra do pico-fim ([Laws of UX](https://www.oreilly.com/library/view/laws-of-ux/9781492055303/ch06.html)) | A experiência é lembrada pelo pico e pelo final, não pela média | Concentrar a "mágica" nos momentos de conclusão: pagamento confirmado, cadastro finalizado, meta batida |
| A frequência decide a intensidade ([Emil Kowalski](https://emilkowal.ski/ui/you-dont-need-animations)) | Uma animação vista muitas vezes por dia perde a graça e passa a atrasar o usuário | Atalhos de teclado e navegação principal: sem animação. Ações diárias: sutis e rápidas. Ações raras: celebração |
| Duração e curva ([Emil Kowalski](https://emilkowal.ski/ui/great-animations)) | A maioria das animações fica abaixo de 300 ms; ease-out na entrada; animar só transform e opacity; sempre interrompível | 150 a 250 ms na interface; ease-out para entrar; mola (spring) para gestos; o usuário pode reverter no meio do movimento |
| Movimento com propósito | Cada animação responde "o que mudou e para onde foi" | O menu nasce do botão que o abriu; o item excluído encolhe no lugar; o card aberto cresce a partir da miniatura |

Regra de ouro: o efeito precisa deixar o sistema mais rápido de usar, nunca mais lento. O hábito saudável nasce de valor real com fluidez, não de truques que prendem o usuário contra a vontade dele.

## Landing page e sistema: dois ritmos

A landing é vista poucas vezes por pessoa e precisa impressionar em segundos; o sistema é usado o dia todo e precisa ser rápido. Use o mesmo design system nos dois e mude só a intensidade do movimento.

| Aspecto | Landing page | Sistema logado |
| --- | --- | --- |
| Papel do movimento | Impressionar e explicar o produto | Dar feedback e orientar |
| Duração típica | Mais longa, de 400 a 800 ms em revelações e títulos | 150 a 250 ms; ações frequentes sem animação |
| Rolagem | Revelação ao entrar, parallax leve, animações guiadas pela rolagem; Lenis opcional | Nativa, com cabeçalho fixo e posição preservada ao voltar |
| Hover | Spotlight, tilt, botão magnético, borda com brilho | Cor, cursor e foco |
| Texto | Revelação letra a letra (SplitText), brilho em títulos | Sem efeito; números tabulares |
| Ilustração e 3D | Rive, dotLottie e cena 3D carregada sob demanda | Mascote só em estados vazios, sucesso e erro |
| Bibliotecas | GSAP com ScrollTrigger, Motion | Motion com LazyMotion, CSS nativo, Sonner, cmdk |
| Carregamento | Código separado do sistema (rota ou app próprio), para GSAP e 3D nunca entrarem no bundle do sistema | Bundle enxuto, sem bibliotecas de marketing |
| Som | Nenhum | Opcional e desligado por padrão |
| Métrica de sucesso | Conversão e LCP | INP, tarefas concluídas e retorno diário |
| Passagem entre os dois | O botão de cadastro leva ao sistema com a mesma cor e tipografia | Primeiro acesso com checklist e uma celebração ao concluir |

Na landing, as seções de hover, rolagem e encantamento valem quase inteiras; o quadrante "Só no marketing" do roteiro é a lista de partida.

## Stack recomendada

Comece pelo que o navegador já faz sozinho em CSS, use Motion para os componentes React e reserve GSAP para linhas do tempo pesadas. Bibliotecas pequenas e especializadas cobrem toasts, comandos, números e arrastar.

| Para quê | Recomendado | Situação em nov/2026 |
| --- | --- | --- |
| Entrada e saída de componentes, layout, gestos, molas | [Motion](https://unpkg.com/framer-motion@12.42.2/README.md) (`motion/react`) | É o antigo Framer Motion; licença MIT; importe de `motion/react` |
| Linhas do tempo, SVG, texto letra a letra, rolagem complexa | [GSAP](https://gsap.com/pricing/) + `@gsap/react` | 100% gratuito, inclusive para uso comercial e plugins como SplitText e MorphSVG ([licença de 30/04/2025](https://gsap.com/blog/3-13/)) |
| Transição entre telas e estados | [`<ViewTransition>` do React 19.3](https://react.dev/blog/2026/09/09/react-19-3) | Estável desde 09/09/2026; anima só atualizações marcadas como Transition |
| API nativa por trás do item acima | [View Transitions na mesma página](https://web-platform-dx.github.io/web-features-explorer/features/view-transitions) | Baseline desde 14/10/2025 (Chrome 111, Safari 18, Firefox 144); entre páginas ainda [parcial no Firefox](https://caniuse.com/cross-document-view-transitions) |
| Animação guiada pela rolagem | [CSS scroll-driven](https://web.dev/blog/web-platform-10-2026) (`animation-timeline`) | Baseline em out/2026 com o Firefox 159; Chrome 115 e Safari 26 |
| Entrada de dialog, popover e o que sai de `display: none` | [`@starting-style` + `allow-discrete`](https://web.dev/blog/baseline-entry-animations) | Baseline desde ago/2024 |
| Animar até `height: auto` (acordeões) | [`interpolate-size: allow-keywords`](https://developer.chrome.com/docs/css-ui/animate-to-height-auto) | Só [Chrome e Edge 129+](https://caniuse.com/mdn-css_properties_interpolate-size); nos demais o tamanho pula para o final, sem quebrar |
| Listas que entram, saem e reordenam | [AutoAnimate](https://auto-animate.formkit.com/) (`@formkit/auto-animate`) | Um hook (`useAutoAnimate`) no elemento pai; sem configuração |
| Toasts | [Sonner](https://github.com/emilkowalski/sonner) | Usado pelo shadcn/ui; `toast.promise` mostra carregando, sucesso e erro |
| Paleta de comandos ⌘K | [cmdk](https://github.com/pacocoursey/cmdk) | Filtra e ordena sozinho; serve também como combobox acessível |
| Drawer arrastável no celular | [Vaul](https://github.com/emilkowalski/vaul) | O README avisa que não é mais mantido; prefira Dialog acessível + `drag` do Motion |
| Números que rolam como odômetro | [NumberFlow](https://github.com/barvian/number-flow) (`@number-flow/react`) | [Localiza e formata](https://21st.dev/@barvian/components/number-flow.md) os números, sem dependências |
| Arrastar e soltar (kanban, ordenação) | [dnd-kit](https://github.com/clauderic/dnd-kit) (`@dnd-kit/react`) | Acessível e com sensores de mouse, toque e teclado |
| Ilustrações e mascotes interativos | [Rive](https://rive.app/blog/rive-as-a-lottie-alternative) ou [dotLottie](https://lottiefiles.com/dotlottie) | Ambos com máquina de estados; Rive costuma gerar arquivos menores, Lottie tem o ecossistema mais amplo |
| Efeitos sonoros | [use-sound](https://www.npmjs.com/package/use-sound) (sobre Howler.js) ou Web Audio API | O autor declara o use-sound "semi-mantido"; para produção, um hook próprio sobre Web Audio é mais seguro |

Evite misturar Motion e GSAP no mesmo elemento: cada um assume o controle do `transform` e um sobrescreve o outro.

## Hover e foco

O hover diz "isto responde a você" antes do clique; no toque ele não existe, então tudo o que aparece no hover precisa de outro caminho por foco ou toque.

| Efeito | O que o usuário sente | Como fazer em React/TS | Cuidado |
| --- | --- | --- | --- |
| Estado de hover em tudo que é clicável | "Isto é clicável" | `transition` de cor e fundo em 150 ms, dentro de `@media (hover: hover) and (pointer: fine)` | Sem a media query, o hover [fica grudado no celular](https://css-tricks.com/?p=303871) após o toque |
| Cursor certo | O sistema "fala" com o mouse | `pointer` em ações, `grab`/`grabbing` em arrastáveis, `not-allowed` em desabilitados | Custo zero; muita gente esquece |
| Spotlight que segue o mouse em cards | Profundidade e luxo | `radial-gradient` posicionado por variáveis CSS `--x`/`--y`, atualizadas no `pointermove` via `ref` | Nunca `setState` a cada movimento: re-renderiza a árvore; agrupe com `requestAnimationFrame` |
| Borda com brilho animado | Destaque premium | `conic-gradient` com ângulo animado via `@property` | Só em um elemento por tela (plano recomendado, CTA principal) |
| Inclinação 3D (tilt) | O card parece físico | `perspective` + `rotateX`/`rotateY` com `useMotionValue` e `useSpring` do Motion | Limite de uns 8 graus; vitrines e onboarding, nunca tabelas |
| Botão magnético | O botão "puxa" o cursor | Deslocamento proporcional à distância do cursor, suavizado por mola | Páginas de marketing; no sistema do dia a dia vira distração |
| Sublinhado animado em links | Elegância | `scaleX` com `transform-origin` à esquerda na entrada e à direita na saída | Mantenha o sublinhado visível em textos corridos por acessibilidade |
| Ações reveladas na linha (editar, copiar, excluir) | Tela limpa, poder à mão | `group-hover` e `group-focus-within` no Tailwind | No toque, mostre sempre ou use menu de três pontos |
| Tooltip com atraso inteligente | Ajuda sem incomodar | Radix Tooltip: [`delayDuration` padrão 700 ms e `skipDelayDuration` 300 ms](https://www.radix-ui.com/primitives/docs/components/tooltip); abre também no foco por teclado | Depois do primeiro, os vizinhos abrem sem espera enquanto o usuário percorre a barra |
| Cartão de prévia (hover card) | Ver detalhes sem sair da lista | Radix HoverCard com dados já em cache | Carregue os dados sob demanda e com cache, para não disparar consultas a cada passada |
| Pré-carregar na intenção | A próxima tela abre instantânea | TanStack Router [`defaultPreload: 'intent'`](https://tanstack.com/router/latest/docs/framework/vue/guide/preloading) (começa após 50 ms, cancela se o hover acabar) | Em páginas tradicionais, [Speculation Rules](https://developer.chrome.com/blog/speculation-rules-improvements) com `eagerness: "moderate"` (hover de 200 ms, só Chromium) |
| Foco visível caprichado | Quem usa teclado se sente em casa | Anel com `:focus-visible` e `outline-offset`, com leve transição | Nunca `outline: none` sem substituto |

O spotlight, o tilt e o botão magnético geram muito "UAU" na primeira visita. Em telas de uso repetido, deixe só o hover de cor, o cursor e o foco.

## Clique e toque

Todo clique precisa de uma resposta visual em menos de 100 ms, antes de qualquer retorno do servidor. É isso que faz o sistema parecer "vivo" na mão.

| Efeito | O que o usuário sente | Como fazer em React/TS | Cuidado |
| --- | --- | --- | --- |
| Botão que afunda ao pressionar | O botão é físico | `transform: scale(0.97)` no `:active` com 100 a 160 ms de ease-out, [como recomenda Emil Kowalski](https://www.ui-skills.com/skills/emilkowalski/emil-design-eng) | Nada abaixo de 0,95; nunca partir de `scale(0)` |
| Mola ao soltar | Resposta elástica, natural | `whileTap={{ scale: 0.97 }}` do Motion; [Enter no teclado também dispara](https://motion.dev/docs/react-gestures) o `whileTap` | Use mola sem quique exagerado em telas de trabalho |
| Botão com estados: ocioso, carregando, sucesso, erro | "Vi que deu certo" sem ler nada | Máquina de estados no componente; spinner no lugar do texto, depois ícone de check desenhado; volta ao normal em uns 1,5 s | Largura fixa para não pular o layout; desabilite durante o envio e use chave de idempotência no Node contra envio duplo |
| Ondulação (ripple) a partir do ponto clicado | O clique "espalha" | Círculo posicionado por `--x`/`--y` no `pointerdown`, animado com `scale` e `opacity` | Opcional; combina com identidades mais lúdicas |
| Interruptor (switch) com mola | Liga e desliga com prazer | Bolinha anima com mola; cor muda em 150 ms; estado otimista | `role="switch"` e `aria-checked`; reverta com aviso se o servidor recusar |
| Checkbox com traço desenhado | Conclusão satisfatória | `pathLength` de 0 a 1 em SVG com Motion, em torno de 200 ms | Em listas longas de seleção em massa, desligue a animação |
| Favoritar com pequena explosão | Recompensa afetiva | Escala de 1 para 1,25 e volta, com algumas partículas | Só para ações raras e emocionais |
| Copiar para a área de transferência | Confirmação instantânea | `navigator.clipboard.writeText`; ícone vira check e "Copiado" por 1,5 a 2 s | Anuncie em `aria-live` para leitores de tela |
| Segurar para confirmar | Ação destrutiva com segurança, sem pop-up | Barra enche durante 1 s de pressão; soltar cancela | Ofereça alternativa por teclado; muitas vezes "desfazer" é melhor (seção de feedback) |
| Arrastar com física | Objeto real nas mãos | `drag` do Motion com limites, elasticidade e inércia; encaixe no solte | No kanban, combine com dnd-kit para acessibilidade |
| Deslizar item de lista (celular) | Gesto nativo de app | Arrastar no eixo x revela ações; acima de um limite, executa | Sempre com "desfazer" logo depois |
| Puxar para atualizar (PWA) | Sensação de app instalado | Arrasto no topo com resistência e indicador girando | `overscroll-behavior: contain` evita conflito com o gesto do navegador |
| Área de toque generosa | Nunca errar o clique | Mínimo de [24 x 24 px (WCAG 2.2 AA)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), ideal 44 x 44 px; aumente a área com padding ou pseudo-elemento | Vale principalmente para ícones de fechar, editar e excluir |
| Destaque de toque próprio | Acabamento de app nativo | `-webkit-tap-highlight-color: transparent` e um `:active` desenhado por você | Só remova o destaque padrão se houver substituto |

## Transições de página e de layout

Quando nada "teleporta", o usuário entende sozinho de onde veio e para onde foi. Desde o React 19.3 isso sai quase de graça com `<ViewTransition>`, e o [React Router já envolve cada navegação em `startTransition`](https://reactrouter.com/how-to/view-transitions), descontinuando as props próprias de transição.

| Efeito | Onde usar | Como fazer em React/TS | Cuidado |
| --- | --- | --- | --- |
| Troca de rota com direção (avançar desliza para a esquerda, voltar para a direita) | Navegação entre lista e detalhe | `<ViewTransition>` em volta do `<Outlet>` e [`addTransitionType`](https://react.dev/reference/react/ViewTransition) para marcar a direção, ligada a classes CSS | O React [não respeita sozinho](https://react.dev/reference/react/ViewTransition) o `prefers-reduced-motion`: adicione a media query |
| Elemento compartilhado (a miniatura vira a ficha) | Lista de clientes, produtos, alunos | Mesmo `name` (por exemplo `cliente-${id}`) nos dois lados; ou `layoutId` do Motion | Nomes únicos por item; se um lado estiver fora da tela, vira entrada e saída comuns |
| Revelação do Suspense (esqueleto vira conteúdo) | Telas que buscam dados | `<ViewTransition>` em volta do `<Suspense>` faz cross-fade entre fallback e conteúdo | O React espera até 500 ms por fontes e imagens visíveis antes de animar |
| Saída animada do que é condicional | Modal, popover, item removido | `AnimatePresence` do Motion, ou `@starting-style` com `allow-discrete` só em CSS | Saída mais curta que a entrada, por exemplo 150 ms contra 220 ms |
| Menu que nasce do gatilho | Dropdowns, selects, popovers | `transform-origin: var(--radix-popover-content-transform-origin)` e [`data-side`](https://www.radix-ui.com/primitives/docs/components/popover) para a direção | Escala de 0,95 para 1, nunca de 0 |
| Indicador de aba que desliza | Abas, filtros segmentados, item ativo do menu | Um único elemento com `layoutId="indicador"` do Motion | Leva o olho junto com a mudança de contexto |
| Grade que se reorganiza ao filtrar ou ordenar | Listas de cards, kanban, galerias | Prop `layout` do Motion ou AutoAnimate no pai | Com centenas de itens, virtualize e anime só o que está visível |
| Card que expande no lugar | Resumo que vira detalhe | `layout` no card e nos filhos; `layout="position"` no texto para não distorcer | Evite em tabelas densas |
| Acordeão suave | Filtros avançados, perguntas frequentes | `interpolate-size: allow-keywords` com salto instantâneo onde não há suporte, ou `height: "auto"` do Motion | Conteúdo pesado dentro: monte só ao abrir |
| Entrada em cascata (stagger) | Primeira carga de um painel ou lista | 30 a 50 ms entre itens, até uns 8 itens | Só na primeira renderização, nunca a cada atualização de dados |
| Troca de tema com círculo que se expande do botão | Botão claro/escuro | `document.startViewTransition` e `clip-path: circle()` animado em `::view-transition-new(root)` | Ação rara: aqui o "UAU" vale a pena |

## Rolagem

Rolar é a interação mais frequente de qualquer tela, então aqui o efeito certo quase sempre é funcional. Desde out/2026 as animações guiadas por rolagem são [Baseline em CSS puro](https://web.dev/blog/web-platform-10-2026), sem JavaScript na thread principal.

| Efeito | Onde usar | Como fazer | Cuidado |
| --- | --- | --- | --- |
| Barra de progresso de leitura | Contratos, termos, artigos longos | `animation-timeline: scroll(root)` animando `scaleX` de 0 a 1 | Fina e discreta no topo |
| Revelação ao entrar na tela | Landing, onboarding, relatórios longos | `animation-timeline: view()` com `animation-range: entry`; alternativa: `whileInView` do Motion com `viewport={{ once: true }}` | Revele uma vez; nunca esconda conteúdo importante até o usuário rolar |
| Cabeçalho que ganha sombra ao grudar | Barra superior, cabeçalho de seção | `position: sticky` com `@container scroll-state(stuck: top)` | [Só Chromium 133+](https://web-platform-dx.github.io/web-features-explorer/features/container-scroll-state-queries); no resto, um sentinela com IntersectionObserver |
| Sombra nas bordas de áreas roláveis | Tabelas largas, listas dentro de modais | Máscara ou sombra animada por `animation-timeline: scroll(self)` | Avisa que há mais conteúdo sem nenhum texto |
| Cabeçalho de tabela e primeira coluna fixos | Qualquer tabela de dados | `position: sticky` no `th` e na primeira coluna | Essencial em SaaS com muitos registros |
| Manter a posição ao voltar | Lista que abre detalhe e volta | `<ScrollRestoration />` do React Router e cache dos dados da lista | Perder o lugar na lista é uma das frustrações mais comuns |
| Carregar mais ao chegar ao fim | Feeds, históricos, auditorias | Sentinela com IntersectionObserver e `useInfiniteQuery` do TanStack Query; no Node, paginação por cursor (keyset) com índice composto | Evite `OFFSET` em tabelas grandes; mantenha um botão "Carregar mais" e o rodapé alcançável |
| Carrossel com encaixe | Planos, cards de destaque | `scroll-snap-type: x mandatory`; destaque do item central com [`scroll-state(snapped: x)`](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/carousel-snap-highlights) | Botões de anterior e próximo para quem usa teclado |
| Parallax leve | Páginas de marketing | `view()` com deslocamento de poucos pixels | Nunca em telas de trabalho |
| Botão "voltar ao topo" | Páginas longas | Aparece depois de rolar uma altura de tela | Pequeno e no canto, sem cobrir ações |
| Rolagem suave para âncoras | Índices, links internos | `scroll-behavior: smooth` dentro de `@media (prefers-reduced-motion: no-preference)` | Mova também o foco para a seção de destino |
| Fundo travado sob modal | Modais e drawers | `overscroll-behavior: contain` no conteúdo do modal | Evita que a página de trás role junto |
| Rolagem "amanteigada" (Lenis) | Só sites de marketing | Biblioteca Lenis sobre a rolagem nativa | A Thoughtworks alerta para [problemas de acessibilidade](https://www.thoughtworks.com/en-au/radar/languages-and-frameworks/lenis); não use no sistema |

O próximo passo são as [animações disparadas por rolagem](https://developer.chrome.com/blog/scroll-triggered-animations) do Chrome 145, que tocam uma animação com tempo próprio ao cruzar um ponto. Use com fallback em IntersectionObserver.

## Velocidade percebida

Nenhum efeito visual compensa um sistema lento. Responda na hora, mostre a forma do que vem e nunca deixe a tela em branco; a meta de responsividade do Google é [INP de até 200 ms](https://web.dev/articles/inp), e acima de 500 ms é ruim.

| Técnica | O que o usuário percebe | Como fazer | Cuidado |
| --- | --- | --- | --- |
| UI otimista | "Funcionou na hora" | [`useOptimistic`](https://react.dev/reference/react/useOptimistic) dentro de `startTransition`, que volta sozinho ao valor real se a ação falhar; ou TanStack Query com [`onMutate`, rollback em `onError` e `invalidateQueries` em `onSettled`](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) | Só para ações que quase sempre dão certo. Pagamentos e operações financeiras mostram estado pendente, nunca otimista |
| Esqueleto com a forma do conteúdo | "Já está chegando" | Mesmo layout do conteúdo final, com pulso lento; [indicado para carregamentos de página](https://www.nngroup.com/videos/skeleton-screens-vs-progress-bars-vs-spinners/) | Para ações curtas (salvar, excluir), use spinner no próprio botão |
| Atraso antes de mostrar o carregamento | Nada pisca à toa | Indicador só aparece após [uns 250 ms](https://www.eleken.co/blog-posts/spinner-ui); depois de visível, fica um tempo mínimo | Sem isso, respostas rápidas viram um flash irritante |
| Manter a tela anterior enquanto a nova carrega | Filtro e paginação sem tela vazia | `startTransition` e `placeholderData: keepPreviousData` no TanStack Query; conteúdo antigo levemente esmaecido | Deixe claro que está atualizando |
| Pré-carregar dados | A próxima tela já vem pronta | `queryClient.prefetchQuery` no hover e no foco; código das rotas dividido com `lazy` | Respeite limites por tenant para não multiplicar consultas |
| Streaming por blocos | O topo aparece já; o resto chega aos poucos | Um `<Suspense>` e um ErrorBoundary por bloco independente | Um bloco lento nunca trava a tela inteira |
| Imagens com blur-up | Nada "pula" | Miniatura borrada (BlurHash, ThumbHash) com fade ao carregar; `width`/`height` ou `aspect-ratio` sempre definidos; `loading="lazy"` fora da dobra | Reserve o espaço para não deslocar o layout |
| Barra de progresso no topo | Navegação com sensação de avanço | Ligada ao estado de carregamento do router, com o mesmo atraso inicial | Avança rápido no início e devagar no fim |
| Busca instantânea | Resultado enquanto digita | Debounce de 150 a 250 ms, `useDeferredValue` e `AbortController` para cancelar a busca anterior | No banco, índice adequado (full-text ou trigram) e limite de resultados |
| Listas enormes fluidas | Rolagem sem engasgo | Virtualização (TanStack Virtual) e cálculos pesados em Web Worker | O DOM com milhares de linhas derruba o INP |
| API rápida no Node | Tudo acima fica crível | Compressão Brotli, ETag e `Cache-Control`, consultas com índice e só as colunas necessárias, sem N+1, cache com `tenant_id` na chave, cabeçalho `Server-Timing` para medir | A chave de cache sem o tenant vaza dados entre clientes |

## Feedback do sistema

O usuário confia no sistema quando cada ação tem uma resposta clara, os erros aparecem antes do envio e quase tudo pode ser desfeito. Essa confiança é o que traz a pessoa de volta todo dia.

| Elemento | O que o usuário sente | Como fazer | Cuidado |
| --- | --- | --- | --- |
| Toasts bem-feitos | Confirmação sem interromper | Sonner: [empilha com profundidade, expande no hover, pausa o tempo no hover e com a aba oculta, fecha com gesto rápido](https://emilkowal.ski/ui/building-a-toast-component) | Sempre na mesma posição; `aria-live="polite"`; erro grave não some sozinho |
| Desfazer no lugar de "Tem certeza?" | Rapidez sem medo | A ação acontece na hora e o toast oferece "Desfazer" por alguns segundos. No Node: exclusão lógica (`deleted_at`) e limpeza definitiva por job | A NN/g recomenda [não usar confirmação em ações rotineiras](https://www.nngroup.com/articles/confirmation-dialog/); reserve o diálogo para o que é realmente irreversível |
| Validação inline | Corrige antes de enviar | Valide ao sair do campo; [evite validação prematura, remova o erro assim que corrigido e mostre o acerto](https://baymard.com/blog/inline-form-validation) com um check discreto | React Hook Form e Zod com o mesmo schema validado também no Node |
| Erro que ensina | "Sei o que fazer agora" | Mensagem em português claro: o que aconteceu e como resolver, com botão de tentar novamente | Nunca mostre stack trace, código interno ou ID de tenant |
| Tremida em senha errada | Gesto universal de "não" | Três oscilações em `translateX` em uns 300 ms | Junte a uma mensagem de texto; só a animação não é acessível |
| Números que rolam | Os KPIs parecem vivos | NumberFlow com `locales="pt-BR"` e formato de moeda quando couber | Só anime quando o valor muda; carregamento inicial mostra o valor direto |
| Salvamento automático visível | Tranquilidade | Indicador "Salvando…" e depois "Salvo agora" perto do título; envio com debounce | Avise se sair da página com alterações pendentes |
| Progresso de tarefas longas | Sabe quanto falta | Importação e exportação em fila no Node, progresso enviado por SSE com porcentagem; notificação ao terminar | Permita sair da tela e voltar depois |
| Estado vazio caprichado | Saber o primeiro passo | Ilustração leve, uma frase e um botão de ação principal | Diferencie "ainda não há nada" de "o filtro não achou nada" |
| Indicador "ao vivo" | Algo está acontecendo agora | Ponto verde com pulso suave | Pare o pulso com `prefers-reduced-motion` |
| Contador e medidor em campos | Sem surpresas | Contador de caracteres que muda de cor perto do limite; força da senha em barra | Texto de apoio, não só cor |
| Formulário que respeita o esforço | Nada se perde | Foco no primeiro campo, Enter envia, os dados ficam preenchidos após erro | Rascunho local em formulários longos, sem dados sensíveis |

## Som e háptica

Som bem usado deixa o produto mais "tangível", mas num sistema de trabalho ele deve marcar só eventos importantes, nunca cada clique. Comece desligado, com um interruptor fácil de achar.

| Evento | Tipo de som | Cuidado |
| --- | --- | --- |
| Sucesso importante (pagamento recebido, tarefa concluída) | "Plim" curto e agudo | Toque uma vez, mesmo que vários eventos cheguem juntos |
| Notificação em tempo real (novo pedido, nova mensagem) | Tom distinto e reconhecível | Útil em telas operacionais abertas o dia todo, como recepção ou caixa |
| Erro grave | Tom grave e curto | Sempre junto de mensagem visual |
| Celebração (meta batida, primeiro cadastro) | Acorde ascendente | Combine com o confete da seção de encantamento |
| Toques mecânicos (interruptor, soltar item arrastado) | Clique quase inaudível | Só para quem ativar o modo completo de sons |

Regras de implementação:

- Interruptor "Sons da interface" acessível por teclado e que [fica salvo](https://joshwcomeau.com/react/announcing-use-sound-react-hook/); guarde a preferência no perfil do usuário no backend, não só no navegador.
- Volume baixo (em torno de 0,25), todos os arquivos nivelados e sem silêncio no início.
- Um único arquivo em sprite com todos os sons, carregado sob demanda depois do primeiro uso.
- O `AudioContext` só toca depois de um gesto do usuário: [crie ou chame `resume()` no primeiro clique](https://developer.chrome.com/blog/autoplay).
- Silencie quando a aba estiver oculta, a não ser em notificações que o usuário pediu.
- Nenhuma informação crítica só por som: leitores de tela e aparelhos no mudo perdem o aviso.
- Fontes de sons gratuitos: [SND](https://www.npmjs.com/package/snd-lib) (uso comercial liberado), [UI SFX](https://github.com/romainsimon/uisfx/wiki) (áudio CC0) e Freesound com licença CC0.

Háptica no celular é bônus, nunca o único retorno:

- Android: `navigator.vibrate(15)` para confirmação e um padrão curto como `[50, 70, 50]` para sucesso; sempre com detecção de suporte.
- iPhone: o Safari não oferece API. O truque com `<input type="checkbox" switch>` [funcionou do iOS 17.4 ao 26.4 e foi corrigido no 26.5](https://unpkg.com/ios-haptics@3.1.1/README.md), então não conte com ele.
- Use só em momentos físicos: soltar item arrastado, deslizar até o limite, confirmar ação importante. Ofereça opção para desligar.

## Produtividade que vicia

O "vício" bom num SaaS vem de sentir-se rápido e no controle: quem aprende os atalhos não quer voltar para o concorrente. Esses recursos são usados centenas de vezes por dia, então [aparecem sem animação](https://rauno.me/craft/interaction-design).

| Recurso | O que o usuário sente | Como fazer em React/TS | Cuidado |
| --- | --- | --- | --- |
| Paleta de comandos (Ctrl/⌘+K) | "Faço tudo sem tirar a mão do teclado" | cmdk com grupos: ações, navegação, registros recentes e busca no servidor | Busque no Node com debounce e limite; mostre só o que o perfil do usuário pode acessar |
| Atalhos de teclado e sequências | Poder de usuário avançado | [react-hotkeys-hook](https://www.mintlify.com/JohannesKlauss/react-hotkeys-hook/quickstart) com escopos e sequências (como `g>c` para ir a Clientes), ou [TanStack Hotkeys](https://tanstack.com/hotkeys/latest/docs/framework/react/guides/hotkeys) | Desative atalhos de uma tecla só dentro de campos de texto |
| Dicas de atalho na interface | Aprende sem manual | Atalho exibido em tooltips e menus (`<kbd>`); `?` abre a lista completa | Mostre Ctrl no Windows e ⌘ no Mac |
| Navegação por setas em listas | Percorre registros como num e-mail | Seta para cima e para baixo (ou J e K) move a seleção, Enter abre, Esc fecha | Foco visível e `aria-activedescendant` |
| Edição inline | Corrige sem abrir formulário | Clique no valor vira campo; Enter salva, Esc cancela; salvamento otimista | Valide no servidor e reverta com aviso se falhar |
| Seleção múltipla e ações em massa | Resolve 50 itens de uma vez | Shift+clique seleciona intervalo; barra flutuante com as ações; "selecionar todos os 1.240" | No Node, processe em lote com fila e transação, nunca uma requisição por item |
| Menu de contexto (botão direito) | Sensação de software de desktop | ContextMenu do Radix nas linhas de tabela e cards | As mesmas ações precisam existir em um menu visível |
| Painel lateral de detalhes | Ver e editar sem perder a lista | Drawer que desliza da direita, com a URL refletindo o registro aberto | Esc fecha e devolve o foco ao item de origem |
| Soltar arquivos em qualquer lugar | Importar sem procurar botão | Camada "Solte para enviar" ao arrastar arquivo sobre a janela | Valide tipo e tamanho no cliente e no servidor |
| Colar para criar | Mágica do dia a dia | Colar imagem anexa; colar linhas de planilha vira importação com prévia | Prévia sempre antes de gravar |
| Desfazer e refazer globais | Liberdade para experimentar | Ctrl+Z e Ctrl+Shift+Z com pilha de comandos no cliente e endpoints de reversão no Node | Deixe claro o que será desfeito |
| Estado na URL e visões salvas | Volta exatamente onde parou | Filtros, ordenação e página na query string; visões salvas por usuário no backend | Compartilhar o link respeita as permissões de quem abre |
| O sistema lembra as escolhas | "Ele me conhece" | Últimos filtros, colunas visíveis e densidade da tabela salvos por usuário e tenant | Ofereça "Restaurar padrão" |

## Encantamento e recompensa

O "UAU" que fica na memória nasce nos marcos raros, não no uso diário. Guarde as celebrações para conquistas reais e registre no backend quais o usuário já viu, para nunca repetir.

| Recurso | Momento certo | Como fazer | Cuidado |
| --- | --- | --- | --- |
| Confete | Primeiro pagamento recebido, plano ativado, 100º cliente | canvas-confetti com [`disableForReducedMotion` e `useWorker`](https://github.com/catdad/canvas-confetti), que renderiza fora da thread principal | Uma vez por marco por usuário; nunca em ações rotineiras |
| Tela de conclusão caprichada | Fim de um fluxo importante | Check animado, número que rola com o resultado e a próxima ação sugerida | É o "fim" da regra do pico-fim: vale o capricho |
| Checklist de primeiros passos com barra | Primeiros dias de uso | Comece com um ou dois itens já marcados; a [motivação cresce perto da meta](https://lawsofux.com/goal-gradient-effect/) e [tarefas incompletas ficam na memória](https://lawsofux.com/zeigarnik-effect/) | Pode ser dispensado e nunca bloqueia o uso |
| Mascote ou ilustração que reage | Estados vazios, sucesso, erro, espera longa | Rive com máquina de estados e entradas como `sucesso` e `erro`, ou dotLottie | Arquivos pequenos e carregados sob demanda |
| Saudação útil | Ao abrir o sistema | "Bom dia, Ana. 3 cobranças vencem hoje." com dados reais | Contexto vale mais que graça; evite gírias forçadas |
| Retrospectiva do mês ou do ano | Virada do mês, fim de ano | Página com cards animados, números que rolam e botão de compartilhar | Pré-calcule em job no Node com tabelas agregadas; nada de agregação pesada a cada acesso |
| Easter egg | Usuários curiosos | Sequência de teclas (o tinykeys aceita [até o código Konami](https://github.com/psd-coder/tinykeys)) que ativa um tema secreto | Nunca mexe em dados |
| Personalização | Configurações do perfil | Tema, cor de destaque, densidade da tabela, foto | O que o usuário investe cria apego; salve por usuário |
| Texto que se revela ou brilha | Títulos de landing e telas de conquista | SplitText do GSAP ou brilho com `background-clip: text` | Nunca em texto que precisa ser lido rápido; mantenha o texto acessível |
| Cena 3D | Só landing pages | React Three Fiber carregado sob demanda | Nunca dentro do sistema |

Sobre gamificação: o modelo Hooked usa recompensas variáveis [no espírito das máquinas caça-níqueis](https://www.pendo.io/pendo-blog/?p=7288) e [recebe críticas por manipulação](https://www.supersummary.com/hooked/background/). Num SaaS, troque a surpresa artificial por descobertas úteis, como "sua inadimplência caiu este mês", e nunca puna o usuário por quebrar uma sequência.

## Tempo real com Node

Um sistema que se atualiza sozinho, sem F5, parece vivo. O Node é forte justamente aqui, desde que cada evento respeite o tenant e as permissões de quem recebe.

| Recurso | O que o usuário sente | Como fazer | Cuidado |
| --- | --- | --- | --- |
| Lista e painel que se atualizam sozinhos | "O sistema está acontecendo agora" | Evento do servidor chama `setQueryData` ou `invalidateQueries` no TanStack Query; a linha nova entra com um brilho amarelo que desbota em 1 s | Agrupe eventos em rajada para não redesenhar a tela a cada milissegundo |
| Canal só de ida (servidor para tela) | Notificações e progresso confiáveis | Server-Sent Events: [o navegador reconecta sozinho](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) e o campo `id` permite retomar de onde parou | No HTTP/1 há só umas 6 conexões por domínio somando as abas; sirva por HTTP/2 |
| Canal de ida e volta | Chat, colaboração, presença | Socket.IO; com vários servidores, use o [adaptador Redis, de preferência o sharded](https://socket.io/docs/v4/redis-adapter/) | Autentique no handshake e autorize cada sala no servidor |
| Presença ("Ana está vendo este registro") | Não pisa no trabalho do colega | Avatares empilhados no topo do registro; presença com TTL no Redis renovada por batimento | Salas por tenant e por registro, nunca transmissão geral |
| Cursores ao vivo | Colaboração "estilo Figma" | Liveblocks, ou Yjs com provedor próprio | Só onde há edição conjunta de verdade |
| "Fulano está digitando…" | Conversa natural | Evento com throttle e expiração de poucos segundos | Não grave em banco |
| Edição simultânea sem perder dados | Confiança total | Aviso de bloqueio suave ("Ana está editando") ou CRDT com Yjs; versão do registro conferida no `UPDATE` | Sem controle de versão, o último a salvar apaga o outro |
| Sino de notificações | Nada importante passa despercebido | Contador com pequeno salto ao chegar algo novo; lista agrupada por tipo | Preferências por tipo de notificação |
| Push no celular e no desktop | O sistema avisa mesmo fechado | Push API com service worker; no iPhone, [só para o app adicionado à Tela de Início](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados) e após um toque do usuário | Peça permissão no momento certo, nunca ao abrir a página |
| Status da conexão visível | Sabe quando confiar no que vê | Faixa discreta "Reconectando…"; ao voltar, busca o que mudou desde o último evento | Reconexão com espera crescente e aleatória para não derrubar o servidor |

## Acabamento visual

O acabamento faz o sistema parecer caro antes de qualquer animação. São detalhes baratos de implementar, que funcionam em toda tela e não cansam com o uso.

| Detalhe | Efeito percebido | Como fazer |
| --- | --- | --- |
| Tema claro e escuro | Conforto o dia todo | `color-scheme: light dark` e [`light-dark()`](https://web.dev/articles/light-dark), Baseline desde maio/2024; escolha salva no perfil e script no `<head>` para não piscar o tema errado |
| Paleta em OKLCH | Cores harmônicas em todos os tons | Tokens em OKLCH, como o [Tailwind v4 já faz](https://dev.to/matfrana/the-mystery-of-tailwind-colors-v4-hjh); hover e ativo mudam só a luminosidade |
| Sombras em camadas | Profundidade realista | Várias sombras leves e tingidas com o tom do fundo, [em vez de uma sombra cinza borrada](https://www.joshwcomeau.com/css/designing-shadows); três níveis de elevação como tokens |
| Bordas e raios consistentes | Tudo parece da mesma família | Borda de 1 px semitransparente; raio interno igual ao externo menos o espaçamento |
| Números tabulares | Valores alinhados que não "dançam" | `font-variant-numeric: tabular-nums` em tabelas, totais e números animados |
| Títulos equilibrados | Quebras de linha elegantes | `text-wrap: balance` nos títulos ([Baseline desde 2024](https://specification.website/spec/foundations/text-wrap/)) e `pretty` nos parágrafos onde houver suporte |
| Fonte variável bem carregada | Texto nítido sem pulo | Uma família variável, `preload`, `font-display: swap` e fonte de reserva ajustada com `size-adjust` |
| Ícones de um só conjunto | Coerência visual | Lucide ou Phosphor com a mesma espessura de traço; ícones animados só em mudanças de estado |
| Vidro fosco com moderação | Camadas leves e modernas | `backdrop-filter: blur()` em barras e menus sobrepostos |
| Textura e gradiente sutis | Personalidade sem poluição | Ruído leve e gradiente suave no fundo de landing e onboarding |
| Barra de rolagem sem salto | Nada se mexe ao abrir um modal | `scrollbar-gutter: stable` |
| Cor da marca nos detalhes nativos | Identidade até no mínimo | `::selection` e `accent-color` em checkbox, radio e range |
| Aba do navegador viva | O sistema chama de volta | Título com contador, como "(3) Pedidos", favicon com selo e Badging API no app instalado |
| Densidade ajustável | Cada um no seu ritmo | Modos confortável e compacto nas tabelas, salvos por usuário |
| Avatar com reserva | Nenhum buraco na tela | Iniciais sobre uma cor derivada do ID quando não há foto |

## Performance, acessibilidade e quando NÃO animar

Um efeito que trava num celular simples ou incomoda quem tem sensibilidade a movimento destrói o "UAU". Estas regras valem para todas as seções acima.

| Regra | Por quê | Como |
| --- | --- | --- |
| Anime só `transform` e `opacity` | [Pulam layout e pintura](https://emilkowal.ski/ui/great-animations) e ficam fluidas mesmo com a thread ocupada | Mudanças de tamanho e posição via `layout` do Motion (técnica FLIP), nunca animando `width`, `top` ou `margin` |
| `will-change` só durante a animação | Cada camada extra consome memória de GPU | Adicione ao começar e remova ao terminar |
| Bundle enxuto | Biblioteca pesada atrasa o primeiro uso | `m` + `LazyMotion` derruba o Motion de [cerca de 43 kB para pouco mais de 5 kB iniciais](https://motion.dev/docs/react-reduce-bundle-size); GSAP, Rive, Lottie, confete e 3D por `import()` dinâmico |
| Responsividade medida | O que não é medido piora em silêncio | INP até 200 ms medido em campo com a biblioteca `web-vitals`; no laboratório, CPU 4x mais lenta no DevTools e um Android básico de verdade |
| Pause o que não está visível | Loops fora da tela gastam bateria | IntersectionObserver e `document.hidden` pausam Lottie, Rive e vídeos |
| Respeite `prefers-reduced-motion` | Critério [WCAG 2.3.3](https://w3.org/WAI/WCAG21/Understanding/animation-from-interactions) | [`<MotionConfig reducedMotion="user">`](https://motion.dev/docs/react-accessibility) desliga movimento e layout e mantém opacidade e cor; no CSS, troque deslizes por fades curtos |
| Opção "Reduzir animações" no sistema | Nem todo mundo conhece a opção do sistema operacional | Preferência salva no perfil, que liga `reducedMotion="always"` |
| Movimento automático com controle | Critério [WCAG 2.2.2, nível A](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide): o que se move sozinho por mais de 5 s precisa poder ser pausado | Carrosséis e fundos animados com botão de pausa |
| Sem flashes | Risco de crise fotossensível | Nada que pisque mais de três vezes por segundo |
| Foco bem cuidado | Teclado e leitor de tela não se perdem | Modal prende o foco e o devolve ao fechar; Esc fecha; ordem de tabulação lógica |
| Anúncios para leitor de tela | Quem não vê também recebe o feedback | Toasts em `aria-live="polite"`, erros em `assertive`; números animados expõem o valor final |
| Nada só por cor, som ou movimento | Daltonismo, aparelho no mudo, movimento reduzido | Sempre texto ou ícone junto |

Quando NÃO animar:

- Ações feitas pelo teclado, paleta de comandos e menus de contexto.
- Qualquer coisa que o usuário veja [mais de 100 vezes por dia](https://tessl.io/registry/skills/github/emilkowalski/skill/emil-design-eng).
- Tabelas densas, edição em massa e telas de digitação rápida.
- Quando o efeito atrasa a tarefa ou bloqueia o próximo clique.
- Enquanto a pessoa digita: não reordene a lista sob o cursor.
- Quando dois elementos disputam a atenção ao mesmo tempo.
- Quando o único motivo é "fica bonito".

## Roteiro de implementação

Implemente em cinco ondas, começando pelo que é barato e aparece em todo clique; cada onda já deixa o sistema melhor sozinha.

&#91;embedded content: efeitos do catálogo · impacto x esforço · 4 quadrantes\]

O quadrante "Só no marketing" fica fora do sistema logado: use em landing pages e no onboarding.

1. Fundação: tokens de cor, sombra e raio; botão que afunda; hover e foco; movimento reduzido; números tabulares.
2. Confiança: toasts com desfazer, UI otimista, esqueletos, validação inline, estados vazios e de erro.
3. Fluidez: `<ViewTransition>` nas rotas, layout animado, AutoAnimate nas listas, pré-carregamento na intenção.
4. Poder: paleta de comandos, atalhos, edição inline, ações em massa, visões salvas.
5. Vida e encantamento: tempo real, presença, notificações, números que rolam, confete nos marcos e sons opcionais.

## Referências e fontes

Estude como os melhores fazem e copie os padrões, não os efeitos soltos. Produtos que valem observar de perto: Linear (velocidade e teclado), Stripe (painéis e números), Raycast (paleta de comandos), Figma (colaboração ao vivo) e Duolingo (celebrações).

| Referência | O que estudar |
| --- | --- |
| [Emil Kowalski: Great animations](https://emilkowal.ski/ui/great-animations) e [You don't need animations](https://emilkowal.ski/ui/you-dont-need-animations) | Quando animar, duração, curvas e frequência; autor do Sonner |
| [Rauno Freiberg: Invisible details of interaction design](https://rauno.me/craft/interaction-design) | Gestos, metáforas, interrupção e o que nunca animar |
| [Josh W. Comeau: use-sound](https://joshwcomeau.com/react/announcing-use-sound-react-hook/) e [sombras](https://www.joshwcomeau.com/css/designing-shadows) | Som com bom gosto e profundidade realista |
| [Laws of UX](https://lawsofux.com/doherty-threshold/) | Psicologia aplicada: Doherty, pico-fim, gradiente de meta, Zeigarnik |
| [Motion: gestos](https://motion.dev/docs/react-gestures) e [acessibilidade](https://motion.dev/docs/react-accessibility) | Receitas de animação em React com movimento reduzido |
| Galerias compatíveis com shadcn/ui: [Magic UI, Aceternity UI, Motion Primitives](https://dev.to/keitam83/a-curated-list-of-shadcnui-like-react-component-collections-44pa) e [React Bits](https://dev.to/codedthemes/top-animated-ui-component-libraries-for-react-1383) | Componentes animados para copiar e adaptar. Magic UI é voltada a marketing, sem tabelas nem formulários |

Fontes técnicas consultadas:

- React: [React 19.3](https://react.dev/blog/2026/09/09/react-19-3), [`<ViewTransition>`](https://react.dev/reference/react/ViewTransition), [`useOptimistic`](https://react.dev/reference/react/useOptimistic), [React Router e View Transitions](https://reactrouter.com/how-to/view-transitions)
- Plataforma web: [View Transitions](https://web-platform-dx.github.io/web-features-explorer/features/view-transitions), [novidades de out/2026](https://web.dev/blog/web-platform-10-2026), [animações de entrada](https://web.dev/blog/baseline-entry-animations), [`height: auto`](https://developer.chrome.com/docs/css-ui/animate-to-height-auto), [scroll-state queries](https://web-platform-dx.github.io/web-features-explorer/features/container-scroll-state-queries), [Speculation Rules](https://developer.chrome.com/blog/speculation-rules-improvements), [INP](https://web.dev/articles/inp), [`light-dark()`](https://web.dev/articles/light-dark), [SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), [autoplay e Web Audio](https://developer.chrome.com/blog/autoplay), [Web Push no iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados)
- Bibliotecas: [GSAP gratuito](https://gsap.com/pricing/), [Motion e tamanho do bundle](https://motion.dev/docs/react-reduce-bundle-size), [Sonner](https://emilkowal.ski/ui/building-a-toast-component), [Vaul](https://github.com/emilkowalski/vaul), [cmdk](https://github.com/pacocoursey/cmdk), [NumberFlow](https://github.com/barvian/number-flow), [AutoAnimate](https://auto-animate.formkit.com/), [dnd-kit](https://github.com/clauderic/dnd-kit), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates), [TanStack Router](https://tanstack.com/router/latest/docs/framework/vue/guide/preloading), [Socket.IO com Redis](https://socket.io/docs/v4/redis-adapter/), [canvas-confetti](https://github.com/catdad/canvas-confetti), [Rive x Lottie](https://rive.app/blog/rive-as-a-lottie-alternative), [ios-haptics](https://unpkg.com/ios-haptics@3.1.1/README.md)
- Pesquisa e acessibilidade: [NN/g: tempos de resposta](https://www.nngroup.com/articles/website-response-times/), [NN/g: confirmações](https://www.nngroup.com/articles/confirmation-dialog/), [Baymard: validação inline](https://baymard.com/blog/inline-form-validation), [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [WCAG 2.3.3](https://w3.org/WAI/WCAG21/Understanding/animation-from-interactions), [WCAG 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide)
