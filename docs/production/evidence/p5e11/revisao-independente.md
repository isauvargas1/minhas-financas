# P5-E1.1 — Revisões adversariais independentes

Três revisões, todas por um revisor Opus separado, somente leitura: sem editar o repositório, sem Emulator, sem E2E e sem acesso a produção ou a segredos. Cada revisão respondeu às 15 perguntas obrigatórias do §13 com evidência de arquivo:linha e classificou os achados.

## Rodada 1 (por volta das 10:30Z, desenho A das notificações)

Avaliou a minimização do contexto da IA e o desenho A das notificações: ações disparadas no `touchend` e guarda por origem nos `onClick`. Texto completo: [`revisao/rodada1-completa.txt`](revisao/rodada1-completa.txt).

### As 15 perguntas

| # | Veredito | Resumo |
| --- | --- | --- |
| 1 | OK | Nem o nome nem a chave da categoria são lidos para o contexto. Alertas têm chaves fixas, as sugestões são fixas, a extração não envia o catálogo. O único texto livre é a pergunta, e o diálogo avisa disso. |
| 2 | OK | A asserção principal é estrutural (lista fechada de chaves). As regex de CPF, CNPJ e e-mail são só complemento. Nenhum texto afirma anonimização. Ver L6c. |
| 3 | PROBLEMA (LOW) | O diálogo omitia valores a receber, indicadores, tipo do espaço e fluxos de investimento (L1). |
| 4 | OK | Papel relido em transação, viewer fora, patrimônio só com permissão; inalterado na P5-E1.1. |
| 5 | OK | Centavos e pontos-base copiados sem alteração; teto de 5 e cobertura mantidos; desempate segue a ordem oficial do relatório. |
| 6 | OK, com limite | O modelo não recebe o nome. A regra da instrução depende da obediência do modelo: não há filtro na saída nem teste com o modelo real. |
| 7 | OK | A pergunta vai inteira, sem log; só o hash é persistido; o diálogo mostra o texto e avisa sobre dados pessoais. |
| 8 | OK | Confirmação antes de qualquer leitura; contexto montado antes da admissão; ordem inalterada. |
| 9 | OK | Tombstone `deleted`, `notification_entries`, TTL e "viewer não exclui" intactos; Rules e índices sem diferença. |
| 10 | OK | ID estável, só o estado do próprio uid, só o cache do escopo da ação. |
| 11 | PROBLEMA (MEDIUM/LOW) | Causa tratada e spec original intacta, mas o desenho A tinha riscos: toque que só para a inércia (M1), toque longo (L2) e foco (L3). |
| 12 | OK | Toques dentro do painel nunca atingem o fundo; sem Pointer Events o fundo fecha normalmente. |
| 13 | OK | Nenhum sinal enviado na inspeção; o processo órfão sumiu com o reinício da VM. |
| 14 | PROBLEMA (MEDIUM) | Logs de evidência ignorados pelo Git e fechamento incompleto (M2, M3). |
| 15 | OK | Mensagens e menu da conta fecham normalmente; sem referência ao texto antigo; 787 unitários do frontend passam. |

### Achados e tratamento

| Achado | Classe | Tratamento |
| --- | --- | --- |
| M1 — toque que só para a inércia podia arquivar, sem volta | MEDIUM | **Deixou de existir.** O desenho A foi substituído pelo roteamento do clique (desenho B): o navegador volta a decidir se houve clique, e não há clique num toque que para a inércia. |
| M2 — logs de evidência ignorados pelo Git (`*.log`) | MEDIUM | **Corrigido.** Renomeados para `.txt` e links ajustados. |
| M3 — fechamento incompleto (plano, links, `verify:all`, repetições, capturas) | MEDIUM | **Tratado no fechamento** (é o M2 da rodada 2): `repeticoes-mobile.md`, `mutacoes.md`, `execucoes.md`, capturas e a seção 20.12 do plano mestre. A revisão foi repetida depois das mudanças funcionais (rodada 2). |
| L1 — diálogo incompleto | LOW | **Corrigido.** O texto lista valores a receber, indicadores, movimentações de investimentos, o patrimônio conforme a permissão e o tipo do espaço; testes de texto atualizados. |
| L2 — toque longo acionava a ação | LOW | **Deixou de existir** com o desenho B: o navegador não gera clique depois de toque longo. |
| L3 — foco não acompanhava o toque | LOW | **Deixou de existir** com o desenho B: não há `preventDefault` no toque, e o foco segue o comportamento nativo. |
| L4 — o E2E novo quase não detectava o defeito original | LOW | **Corrigido.** Casos 19 e 20 na spec nova: clique redirecionado a partir de um botão, de um aviso e de área sem dono, conferido no navegador. |
| L5 — asserção trivial no P23 | LOW | **Corrigido.** O P23 injeta patrimônio no relatório e prova que, sem a permissão, ele sai "sem permissão"; com a permissão (controle), o valor aparece. |
| L6 — afirmações das evidências sem respaldo (a–d) | LOW | **Corrigido.** (a) a evidência diz que o E2E confere a presença de três frases; (b) "quem não lê o nome é `buildAnalysisContext`"; (c) as mutações foram refeitas na árvore final, ver `mutacoes.md`; (d) `SECURITY_MODEL.md` atualizado. |
| L7 — fusão de marcas só pelo ID | LOW | **Corrigido.** A fusão compara também `expiresAtMs`; caso de teste do evento recriado com o mesmo ID. |

## Rodada 2 (árvore final, retrato às 13:44Z)

Avaliou a árvore final:
- o roteamento do clique;
- a fusão de marcas;
- a remoção garantida no fim da saída (`onExitComplete`), com o `layout` original, e a refutação da hipótese do `MeasureLayout`;
- a correção de acessibilidade do diálogo de IA, informada durante a revisão;
- a minimização do contexto, inalterada desde a rodada 1.

O revisor também rodou mutantes extras numa cópia própria. Texto completo: [`revisao/rodada2-completa.md`](revisao/rodada2-completa.md).

**Veredito:** nenhum BLOCKER e nenhum HIGH; dois MEDIUM e oito LOW.

### As 15 perguntas

| # | Veredito | Resumo |
| --- | --- | --- |
| 1 | OK | Nome e chave da categoria nunca são lidos; o único caminho de um nome ao Google é o usuário digitá-lo na pergunta, e o diálogo avisa. |
| 2 | OK | Nenhum texto afirma anonimização; a prova é estrutural, e as regex só complementam. |
| 3 | OK | Todos os blocos enviados estão no texto do diálogo; patrimônio só com permissão, como dito. |
| 4 | OK | Papel relido em transação, viewer fora, sem `uid`/`workspaceId` nas partes enviadas. |
| 5 | OK | Centavos e pontos-base intactos, teto de 5 e cobertura preservados; só o critério de desempate mudou. |
| 6 | OK, com limite | O modelo não recebe nomes; não há filtro de saída nem teste com o modelo real, e ele pode associar um nome escrito pelo usuário. |
| 7 | OK | A pergunta vai inteira, sem log; só o hash é persistido; o diálogo mostra e avisa. |
| 8 | OK | Ordem mantida: confirmação, contexto, admissão e só então o provedor. |
| 9 | OK | Tombstones, TTL e `notification_entries` intactos; a fusão não inventa marca nem item; viewer sem excluir. |
| 10 | OK | Só o estado do próprio usuário, pelo ID estável; o E2E 02 confere os dois IDs. |
| 11 | OK (ver M1) | Spec original intacta, sem esperas; as duas causas tratadas; sem regressão de teclado, caneta, toque longo, rolagem, multitoque ou duplo disparo. Resíduos: L4 e L5. |
| 12 | OK | Toque iniciado dentro do painel não fecha pelo fundo; iniciado no fundo, fecha; sem Pointer Events, tudo passa. |
| 13 | OK (ver L6) | Todo encerramento na 8080 com SIGTERM, depois de identidade, propriedade e não uso; desvios anteriores às 12:41Z divulgados. |
| 14 | PROBLEMA (MEDIUM) | M1 e M2. |
| 15 | OK | Os dois `Header` montados funcionam com o contador de ouvintes; mensagens e menu mudam só no gesto com destino trocado; nenhum teste depende de texto antigo. |

### Achados e tratamento

| Achado | Classe | Tratamento |
| --- | --- | --- |
| M1 — a correção do `onExitComplete` não tinha proteção determinística: a guarda só confere texto, e um setter que não faz nada passava `tsc` e 99/99 | MEDIUM | **Corrigido.** Nova regressão determinística na suíte E2E, `e2e/notifications-exit-race.spec.ts`: empacota o `NotificationsPanel` real e remove o segundo aviso exatamente na janela, em 10 rodadas. A guarda passou a exigir também o `useState(0)`. Os mutantes R13r, R14r e R16r (o mesmo setter sem efeito) rodam contra essa spec, e o R16 contra a guarda; resultados em [`mutacoes.md`](mutacoes.md). A frase "Fica fixado por" do diagnóstico foi refeita. |
| M2 — fechamento documental incompleto (arquivos citados ainda inexistentes, seção do plano, log da spec nova só no scratchpad) | MEDIUM | **Tratado no fechamento:** `mutacoes.md`, `execucoes.md`, `VEREDITOS.md`, `encerramentos-emulator.txt`, os logs das execuções em `execucoes/` e a seção 20.12 do plano mestre. |
| L1 — cabeçalho da spec nova descrevia o desenho antigo, com 18 casos | LOW | **Corrigido.** Descreve o roteamento, os 20 casos e a segunda causa, apontando a regressão determinística. |
| L2 — dois caminhos raros do framer-motion 10.16.4 escapam da correção: item que volta à lista durante a própria saída; saída mais antiga que termina depois de uma mais nova | LOW | **Risco residual registrado** em "Riscos residuais" do diagnóstico (§4.1) e no plano mestre (§20.12), depois do N4 da rodada 3. No painel são improváveis: marcas só ligam e a transição é uniforme. |
| L3 — a reentrega forçava `click()` num dono que poderia não ser `HTMLElement` | LOW | **Corrigido.** Dono sem `click()` só tem o clique impedido, sem erro; teste e mutante R18. |
| L4 — o foco não acompanhava a reentrega | LOW | **Corrigido.** O foco vai ao dono de origem antes do `click()`, com `preventScroll`; teste e mutante R17. |
| L5 — a reentrega pode ir a um aviso que já está saindo | LOW | **Risco residual registrado** no diagnóstico (§4.1) e no plano mestre, com a variante do "Excluir para mim" (abre a confirmação de um aviso que está saindo, que pode ser cancelada). Repete um arquivamento idempotente ou navega para o aviso arquivado, o que ainda é melhor que antes, quando a ação caía no vizinho. |
| L6 — processo e ambiente: desvios antes das 12:41Z; "sem afrouxar" inexato; comparação de diretório por prefixo; `loopback-proxy.cjs` fora das evidências | LOW | **Corrigido e precisado.** O texto diz que a regra relaxa um eixo e o compensa com a prova de conexões TCP. A comparação de diretório passou a ser igualdade ou subdiretório exato, e o proxy foi para `diagnostico/ferramentas/`. |
| L7 — espaços no fim de linha e JSON sem quebra de linha final nas evidências | LOW | **Corrigido** nos arquivos de texto de `evidence/p5e11`. |
| L8 — diálogo: regiões focáveis sem papel nem nome; foco cai no `body` se o conteúdo deixa de rolar com a região focada; o E2E não cobria a citação longa nem a ordem do Tab | LOW | **E2E ampliado:** pergunta longa (a citação rola e fica com `tabindex="0"`, axe sem violação) e ordem do Tab a 360 px (Fechar → corpo → Cancelar). Sem papel nem nome, por decisão: a WCAG não exige, o axe não acusa, e um papel `region` criaria um marco a mais dentro do diálogo. O foco no `body` ao girar o aparelho fica registrado como resíduo: o próximo Tab volta ao diálogo pela armadilha de foco. |
| R05 sobreviveu na bateria das 13:15 | — | **Já tratado:** casos novos de teclado sem `pointerId`; o R05 morreu na passada 2 (`mutacoes.md`). |

## Rodada 3 (árvore final, depois das correções da rodada 2)

Avaliou a árvore final, com o `verify:all` rodando: o tratamento dos achados da rodada 2, as mudanças posteriores às 13:44Z (foco e checagem de `click()` na reentrega, regressão determinística com harness, sonda e stub de ícones, guarda com `useState(0)`, testes de acessibilidade do diálogo) e a coerência das evidências. Recalculou o delta contra `43ffbfa1` sem gravar objetos. Registro de processo: o revisor rodou `git status --short` uma vez, o que pode ter atualizado só o cache de stat do índice; nada foi staged. Texto completo: [`revisao/rodada3-completa.md`](revisao/rodada3-completa.md).

**Veredito:** nenhum BLOCKER, HIGH ou MEDIUM; quatro LOW. A Q14 e a Q15 foram fechadas depois do `verify:all`, num complemento do mesmo revisor ([`revisao/rodada3-complemento.md`](revisao/rodada3-complemento.md)): as duas OK.

### As 15 perguntas

| # | Veredito | Resumo |
| --- | --- | --- |
| 1 | OK | Só valor e participação são copiados; rótulo fixo; forma fechada; getters que lançam erro provam que o nome não é lido. |
| 2 | OK | A prova é estrutural (nome inteiro, janelas de 8 caracteres, chaves e IDs); nenhum texto promete anonimização. |
| 3 | OK | O diálogo cobre todos os blocos enviados; patrimônio só com permissão. |
| 4 | OK | Confirmação, papel relido, relatório sem ranking de clientes; só dados e pergunta vão ao provedor; viewer fora. |
| 5 | OK | Centavos e pontos-base intactos; teto de 5; mutante X17 morto. |
| 6 | OK, com limite | A regra está só na instrução; sem filtro de saída nem teste com o modelo real. |
| 7 | OK | A pergunta vai inteira; só o hash da intenção é persistido; o diálogo mostra e avisa. |
| 8 | OK | Ordem mantida: confirmação, contexto, admissão e só então o provedor. |
| 9 | OK | Rules idênticas à base; a fusão nunca liga marca nova; "Excluir" só com `canDelete`. |
| 10 | OK | Grava só o estado do próprio usuário; E2E 02 e 19. |
| 11 | OK, com limite | Spec original intacta; as duas causas tratadas; rodada 5 com 80/80 e a regressão determinística. Limites: L2, L5, N1, N2. |
| 12 | OK | O fundo é dono de gesto; gesto iniciado no painel é impedido ou reentregue à origem; E2E 15 e 16. |
| 13 | OK, com limite | 20 de 20 encerramentos com identidade, propriedade, não uso e SIGTERM; desvios anteriores às 12:41Z divulgados. |
| 14 | OK | Respondida depois do `verify:all` ([complemento](revisao/rodada3-complemento.md)): saída 0 das 14:58:50Z às 15:43:50Z, 2.883 testes sem falha, skip, `todo`, cancelamento ou `flaky`, sobre a árvore `025e13ef`, que só difere da revisada em evidências. A primeira execução, interrompida pelo limite de tempo do executor, não conta. |
| 15 | OK | E2E inteiro (191/191, todas as specs dos outros módulos), integração (969/969) e Rules (273/273) com o roteador global ativo; a spec F original e a regressão da corrida também passaram. |

### Achados e tratamento

| Achado | Classe | Tratamento |
| --- | --- | --- |
| N1 — caneta que se comporta como mouse: deslizar para fora de "Arquivar" e soltar arquiva (antes, abria o aviso quando soltava sobre ele, ou não fazia nada quando soltava fora) | LOW | **Risco residual registrado** (diagnóstico §4.1 e plano mestre), com a correção recomendada: reentregar só quando o `pointerup` estiver no dono de origem, ou tratar caneta como mouse. Não aplicada nesta milestone: mudaria `pressOrigin.ts` depois do `verify:all`, o que exigiria repetir o gate integral (§11.3 do pedido), por um caso raro cujo efeito (arquivar em vez de abrir) é da mesma classe do comportamento anterior. |
| N2 — o foco só acompanha a reentrega quando o dono é focável; no corpo do aviso (`div`) fica onde caiu o `mousedown` | LOW | **Frase do diagnóstico corrigida e risco residual registrado**, com a correção recomendada (`blur()` se o elemento ativo ficar fora do dono). Mesmo motivo do N1 para não mudar o código agora. |
| N3 — a regressão determinística não tem controle positivo na suíte | LOW | **Risco residual registrado.** Hoje a não vacuidade é provada pelos mutantes R13r, R14r e R16r, com o framer-motion fixado em 10.16.4 no `package.json` e no lockfile. Recomendado acrescentar o caso de controle na próxima mudança que tocar o painel ou atualizar a biblioteca. |
| N4 — riscos residuais citados em lugares onde não estavam | LOW | **Corrigido.** "Riscos residuais" acrescentado ao §4.1 do diagnóstico (L2a, L2b, L5 com a variante do "Excluir para mim", N1, N2, N3, L8b) e repetido na seção 20.12 do plano mestre; linhas L2 e L5 desta página ajustadas. |
| Mutações: conciliar o lote 1 com a tabela final; E01–E03 citavam linhas da cópia das 13:05Z | — | **Tratado em [`mutacoes.md`](mutacoes.md):** E01–E05 refeitos na cópia da árvore final, depois de uma execução de controle; gravação do JSON serializada com trava. |
