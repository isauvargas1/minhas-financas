# Evidências da P5-E1.1 — Minimização adicional, estabilização mobile e gate de regressão

Estado: ver a declaração final em [`VEREDITOS.md`](VEREDITOS.md). Nenhum commit, push, merge, rebase, reset, tag, deploy ou publicação foi feito. Nenhum segredo foi lido, criado ou alterado. Nenhuma chamada real ao Google foi feita: as suítes usam o gateway de IA falso, no Emulator do projeto `minhas-financas-local`.

| Arquivo | Conteúdo |
| --- | --- |
| [`minimizacao-contexto-v2.md`](minimizacao-contexto-v2.md) | (A) O que vai ao provedor: contrato v2 do contexto da análise (categorias só pela posição), comparação v1 × v2, regra do consultor, transparência do diálogo e prova estrutural |
| [`contexto-amostras-sinteticas-v2.json`](contexto-amostras-sinteticas-v2.json) | Pedido completo ao provedor (instrução, dados e pergunta) para PF e PJ, gerado de relatórios sintéticos com nomes de categoria propositalmente pessoais e fictícios |
| [`gerador/context-samples.cjs`](gerador/context-samples.cjs) | Gerador das amostras; falha se qualquer nome, ID ou chave de entrada aparecer na saída |
| [`capturas/`](capturas/) | Diálogo de envio ao provedor (análise, comprovante e voz) em desktop 1280×800 e mobile 390×844, tema claro, dados sintéticos (gravadas pela spec `ai-consent-extraction` com `E2E_CAPTURE_DIR`) |
| [`visual/`](visual/) | Antes (árvore da P5-E1) e depois (árvore final), no mesmo estado, viewport e tema: painel de notificações e sino (owner, viewer, vazio, indisponível, depois de arquivar; desktop e celular) e diálogo da análise (1440×900, 390×844, 360×740), temas claro e escuro, 30 capturas de cada lado; diferença de pixels por captura em `diferencas-pixels.txt` (0,00% em todas as do painel e do sino; o diálogo muda pelo texto novo de transparência) e a spec que gerou as capturas |
| [`diagnostico-notificacoes.md`](diagnostico-notificacoes.md) | (B) Falha intermitente do celular: método, as duas causas (clique de compatibilidade redirecionado; aviso arquivado preso no DOM pelo `AnimatePresence` do framer-motion 10.16.4), hipótese refutada, correções e testes |
| [`diagnostico/`](diagnostico/) | Logs instrumentados antes e depois, falhas capturadas (`saida-presa/`, `forcerender/`), contagens e ferramentas (cópia de diagnóstico, instrumentação da spec e do app, análise de atrasos, reprodução determinística do defeito do framer-motion em `ferramentas/harness/`) |
| [`feed-resposta-antiga-antes.txt`](feed-resposta-antiga-antes.txt) | Saída dos testes da resposta antiga do feed antes da correção (4 falhas) |
| [`repeticoes-mobile.md`](repeticoes-mobile.md) | Todas as rodadas de repetição do teste do celular, com falhas, e o critério de 20 consecutivas por variante |
| [`repeticoes/`](repeticoes/) | Logs das rodadas oficiais (sem as linhas do servidor web) |
| [`ambiente-porta-8080.md`](ambiente-porta-8080.md) | (C) Porta 8080: inspeção, causa da liberação, JVM órfã depois do E2E, procedimento de encerramento com identidade comprovada e wrappers seguros |
| [`encerramentos-emulator.txt`](encerramentos-emulator.txt) | Registro de cada encerramento de JVM órfã: identidade, propriedade, ausência de uso, SIGTERM e porta liberada |
| [`mutacoes.md`](mutacoes.md) | Mutações dirigidas (privacidade, roteamento do clique, fusão de marcas, remoção no fim da saída e E2E), com as passadas e a conferência de restauração |
| [`mutacoes.json`](mutacoes.json) | Resultado de cada mutante (camada, alvo, troca, código de saída, evidência da asserção reprovada e restauração conferida por SHA-256), da passada final |
| [`execucoes.md`](execucoes.md) | `verify:all` na árvore final e demais execuções de validação |
| [`execucoes/`](execucoes/) | Logs filtrados (sem as linhas do servidor web): `verify:all` da árvore final, a primeira execução interrompida pelo limite de tempo do executor (registrada, não conta) e o pré-teste dirigido das três specs da P5-E1.1 |
| [`revisao-independente.md`](revisao-independente.md) | Revisões adversariais (Opus, somente leitura), as 15 perguntas do §13 e o tratamento dos achados |
| [`revisao/`](revisao/) | Textos completos das revisões, como entregues pelo revisor |
| [`VEREDITOS.md`](VEREDITOS.md) | Vereditos das skills e do gate de regressão; declaração final |
