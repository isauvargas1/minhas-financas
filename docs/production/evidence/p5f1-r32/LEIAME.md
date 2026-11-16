# P5-F.1-R3.2 — evidência (2026-11-11 a 2026-11-14)

**Base.** Etapa corretiva sobre a árvore final auditada da R3.1 (`efcbd2645b8e7b08b5add2812f6b319f4a76369b`; commit-base `1730a1df`). Ela fecha dois bloqueadores:
- **RR-R31-05.** A "leitura única" provava uma estimativa sem nenhuma confirmação do servidor.
- **RR-R31-07/08.** O `npm run verify:all` não passava numa execução só.

**Árvores.**
- Código final: `5ea7fabee02c3ae4ca79400f416ce9e67e425ec7`, a mesma do `verify:all` oficial (`verify-all-r32-9`, saída 0) e da execução do gate. Antes, com saída 0 e superadas por mudanças pedidas pelas revisões: `verify-all-r32-3` (`9fddcb5a`), `verify-all-r32-4` (`ef514869`) e `verify-all-r32-6` (`698f9644`). A `verify-all-r32-5` (`698f9644`) foi interrompida pelo reinício do contêiner, a `verify-all-r32-7` (`b2b15267`) reprovou por interferência de uma revisão, e a `verify-all-r32-8` (`5ea7fabe`) reprovou pela falha intermitente de um teste das Functions anterior à etapa, com a causa comprovada (RR-R32-12; histórico, execuções 62, 66 e 70).
- Final, com os documentos: no `LEIAME.md` do pacote de auditoria.
- Depois do `verify:all` oficial, só arquivos de `docs/` mudaram. O roteiro de empacotamento confere isso e recusa o pacote em qualquer outro caso.

**Veredito global: PASS** no gate da etapa (`regression-release-gate`, rodada 1; `revisoes/gate/PARECER-RODADA-1.md`), com a execução própria do gate: `gate-verify-all-r32`, saída 0 numa execução só, na árvore final com os documentos (fora de `docs/`, igual à de código final).

Não publicar; sem commit, push ou deploy. A P5 não está concluída, e a próxima milestone não foi iniciada.

| Arquivo | Conteúdo |
| --- | --- |
| `matriz-antes-depois.md` | O que mudou no código e os cenários do pedido, cada um com o comportamento e a evidência na R3.1 e na R3.2, e a Frente B antes e depois |
| `testes-substituidos.md` | Cada teste reescrito ou ajustado (unidade, guarda e 2 E2E): o que afirmava, o que afirma e por quê; os novos |
| `testes-e-resultados.md` | Testes novos, contagens, todas as execuções em ordem (inclusive as falhas e interrupções intermediárias), provas vermelhas, o `verify:all` oficial e a memória por grupo |
| `mutantes.md` | Os mutantes na árvore de código final: 26 das novas condições do cliente (com e sem a guarda de texto), 57 da Frente B e, na R3.2, os 12 da R3.1 e os 29 da R3; as rodadas anteriores, no histórico |
| `fluxo-e2e-oficial.md` | Frente B: causas do RR-R31-07, o executor em grupos, a fiação no `package.json`, no Playwright e no CI, os testes e os riscos |
| `keepalive-rr-r31-08.md` | A investigação da hipótese do keep-alive: fatos do código, os experimentos E1 a E3h e a conclusão (não comprovada; sem mudança) |
| `revisoes/` | Pareceres independentes (financeiro, adversarial com custo do Firestore, estabilidade com a prontidão da plataforma, pt-BR), em quatro rodadas de todas e mais duas da estabilidade, os pedidos de cada revisão, as respostas a cada achado (`revisoes/LEIAME.md`) e o parecer do gate (`revisoes/gate/`) |
| `saidas/` | Saídas das execuções (`.log.txt`, porque o `.gitignore` do projeto ignora `*.log`), sem as linhas `[WebServer]` do Emulator nos E2E. Os logs completos estão no pacote de auditoria |

**Provas vermelhas.** Os testes novos e reescritos rodaram sobre o código da R3.1: os três arquivos de `src/` da R3.1 numa cópia da árvore da R3.2.
- **Unidade.** 48 dos 148 testes dos três arquivos falham, exatamente os que mudam comportamento. Os outros passam também na R3.1: são guardas do que não mudou, como as janelas com desconsiderada, a de 12 meses e o estado indisponível decidido antes das receitas. Na árvore final, 148/148 (`saidas/red-r32-na-r31-3.json`).
- **E2E B03-g.** Sem conexão, o saldo continuou convertido por 60 s.
- **E2E da escuta encerrada.** O topo continuou "Valores em tempo de trabalho equivalente… ela usa a leitura anterior", com os valores convertidos.

Na R3.2, todos passam.
