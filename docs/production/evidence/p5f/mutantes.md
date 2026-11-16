# P5-F — mutantes: os testes novos não são vazios

Cada mutante introduz um defeito plausível e roda o teste que deveria pegá-lo. Os mutantes de unidade, guarda e Rules rodam em cópias fora do worktree. O mutante do E2E roda numa cópia temporária da spec em `e2e/`, apagada ao fim. Nenhum arquivo do worktree foi alterado. A troca precisa casar exatamente uma vez, senão o roteiro para.

**Resultado:** 59/59 mutantes de unidade e guarda mortos; 15/15 mutantes das Rules mortos no Emulator, depois do reforço da suíte de Rules descrito abaixo (na 1ª rodada, R11 sobreviveu). A cópia original passa nos três arquivos unitários e na suíte de Rules final (# pass 10 # fail 0).

## Unidade e guarda (Node, sem Emulator)

Roteiro: `mutantes.py.txt`. Cada cópia leva `src`, `functions/src`, `firestore.rules`, `package.json` e os três testes; `node_modules` por link simbólico. Rodada final no código definitivo, depois das quatro revisões independentes. C11, C12, F3 e G21–G36 cobrem as correções e os reforços finais:
- eixo compacto e eixo no modo dinheiro (C11, C12);
- renda acima do máximo (F3);
- Header da prévia (G21);
- ponto ao lado de ação de um clique (G22);
- eixo longo (G23);
- confirmação de anulação de lançamento e de despesa dividida com o valor em reais (G24, G28);
- import dinâmico (G25);
- curinga recursivo com outro nome (G26);
- largura e margem do eixo só no modo tempo (G27, G29);
- ponto em BRL que ganha a versão convertida ao lado (G30, G31);
- sessão: estado exposto sem conferir o uid, listener não cancelado na troca de conta, resposta gravada sem o uid e valor exposto lido de `state` (G32–G35);
- versão convertida com outro nome de variável do hook, `moneyDisplay` (G36).

Na primeira rodada, antes das correções, os 40 mutantes C1–C10, K1–K8, F1–F2 e G1–G20 também morreram.

### Cálculo (`calculation.ts`)

| ID | Mutante | Teste | Resultado | Primeiro teste que reprova |
| --- | --- | --- | --- | --- |
| C1 | arredondamento vira truncamento | `work-time-calculation.test.ts` | morto | arredondamento ao minuto mais próximo: meio minuto vai para longe de zero (+3) |
| C2 | menos de 1 minuto vira zero | `work-time-calculation.test.ts` | morto | zero, menos de 1 minuto e sinal (+1) |
| C3 | sinal negativo perdido | `work-time-calculation.test.ts` | morto | arredondamento ao minuto mais próximo: meio minuto vai para longe de zero (+3) |
| C4 | sem teto do maior inteiro seguro | `work-time-calculation.test.ts` | morto | limite seguro: valores muito grandes calculam em BigInt e só ficam indisponíveis acima do maior inteiro seguro |
| C5 | sem piso de R$ 0,01 por hora | `work-time-calculation.test.ts` | morto | valores e configurações inválidos ficam indisponíveis (a interface mostra o dinheiro) |
| C6 | reais de exibição devolvem -0 | `work-time-calculation.test.ts` | morto | volta de reais de exibição a centavos é exata até o teto e recusa o resto |
| C7 | sem teto dos reais de exibição | `work-time-calculation.test.ts` | morto | volta de reais de exibição a centavos é exata até o teto e recusa o resto |
| C8 | sem a marca de estimativa (≈) | `work-time-calculation.test.ts` | morto | exemplo de referência: R$ 482,35 com hora de R$ 20,00 vira 24 h 7 min (+3) |
| C9 | espaço comum no lugar do espaço inseparável | `work-time-calculation.test.ts` | morto | formatação pt-BR em horas e minutos, sem quebra de linha e com marca de estimativa (+1) |
| C10 | leitor de tela sem o valor exato em reais | `work-time-calculation.test.ts` | morto | apresentação: texto curto, falado, dica e tooltip trazem o valor exato em reais |
| C11 | eixo compacto trunca as horas | `work-time-calculation.test.ts` | morto | rótulo compacto de eixo: horas inteiras arredondadas e minutos abaixo de 1 h |
| C12 | eixo no modo dinheiro deixa de usar o formatador da tela | `work-time-calculation.test.ts` | morto | eixo e tooltip de gráfico: modo dinheiro devolve o texto exato do formatador da tela |

### Contrato do documento (`contract.ts`)

| ID | Mutante | Teste | Resultado | Primeiro teste que reprova |
| --- | --- | --- | --- | --- |
| K1 | campo a mais aceito na leitura | `work-time-preference.test.ts` | morto | leitura estrita: campo a mais, campo a menos, tipo errado ou configuração inválida não valem |
| K2 | enabled sem verificação de tipo | `work-time-preference.test.ts` | morto | leitura estrita: campo a mais, campo a menos, tipo errado ou configuração inválida não valem |
| K3 | updatedAt sem verificação | `work-time-preference.test.ts` | morto | leitura estrita: campo a mais, campo a menos, tipo errado ou configuração inválida não valem |
| K4 | modo tempo com a preferência desativada | `work-time-preference.test.ts` | morto | modo efetivo: tempo só com preferência válida, ativa e em modo tempo; o padrão é dinheiro |
| K5 | uid com barra vira caminho | `work-time-preference.test.ts` | morto | caminho privado por usuário, fora do perfil server-owned e de qualquer workspace |
| K6 | valor convertido gravado no documento | `work-time-preference.test.ts` | morto | campos gravados pelo cliente: lista exata, sem updatedAt e sem valor convertido |
| K7 | schemaVersion ignorado | `work-time-preference.test.ts` | morto | leitura estrita: campo a mais, campo a menos, tipo errado ou configuração inválida não valem |
| K8 | configuração inválida aceita na leitura | `work-time-preference.test.ts` | morto | leitura estrita: campo a mais, campo a menos, tipo errado ou configuração inválida não valem |

### Formulário (`form.ts`)

| ID | Mutante | Teste | Resultado | Primeiro teste que reprova |
| --- | --- | --- | --- | --- |
| F1 | minutos até 60 | `work-time-preference.test.ts` | morto | carga mensal: horas inteiras e minutos de 0 a 59, dentro de 1 h a 744 h |
| F2 | renda zero cai na mensagem de mínimo | `work-time-preference.test.ts` | morto | renda: formato pt-BR, recusa de ambíguo, zero, negativo e limites |
| F3 | renda bem formada acima do inteiro seguro vira erro de formato | `work-time-preference.test.ts` | morto | renda: formato pt-BR, recusa de ambíguo, zero, negativo e limites |

### Guarda estática de privacidade e da matriz (`work-time-guard.test.ts`)

| ID | Mutante | Teste | Resultado | Primeiro teste que reprova |
| --- | --- | --- | --- | --- |
| G1 | contexto da IA recebe a renda | `work-time-guard.test.ts` | morto | IA, notificações e relatórios autoritativos não recebem a preferência |
| G2 | Function lê a preferência | `work-time-guard.test.ts` | morto | nenhuma Function lê, grava ou menciona a preferência privada |
| G3 | cópia da preferência no localStorage | `work-time-guard.test.ts` | morto | nenhuma cópia local da preferência e nenhuma leitura do cache do SDK no app |
| G4 | leitura do cache local do Firestore | `work-time-guard.test.ts` | morto | nenhuma cópia local da preferência e nenhuma leitura do cache do SDK no app |
| G5 | log com o objeto de erro inteiro | `work-time-guard.test.ts` | morto | logs da preferência só levam mensagem fixa e código de erro |
| G6 | Rules liberam a listagem ao titular | `work-time-guard.test.ts` | morto | Rules: bloco explícito do titular, campos e limites iguais ao contrato do cliente |
| G7 | Rules sem hasOnly (campo extra) | `work-time-guard.test.ts` | morto | Rules: bloco explícito do titular, campos e limites iguais ao contrato do cliente |
| G8 | Rules aceitam updatedAt do cliente | `work-time-guard.test.ts` | morto | Rules: bloco explícito do titular, campos e limites iguais ao contrato do cliente |
| G9 | transferência (BRL obrigatório) usa a camada | `work-time-guard.test.ts` | morto | matriz: entradas, confirmações, termos, históricos e preços ficam em BRL |
| G10 | ponto elegível sem a camada (LoanCard) | `work-time-guard.test.ts` | morto | matriz: os pontos elegíveis usam a camada de exibição, e a prévia do tema força reais |
| G11 | modo dinheiro ganha elemento novo | `work-time-guard.test.ts` | morto | modo dinheiro idêntico: a camada devolve o formatador da tela, sem elemento novo |
| G12 | DTO de relatório com tempo de trabalho | `work-time-guard.test.ts` | morto | DTOs, chamadas e adaptadores financeiros não carregam tempo de trabalho |
| G13 | preferência no cache do React Query | `work-time-guard.test.ts` | morto | nenhuma cópia local da preferência e nenhuma leitura do cache do SDK no app |
| G14 | API da preferência com caminho de workspace | `work-time-guard.test.ts` | morto | a preferência só é lida e gravada no documento privado do próprio usuário |
| G15 | notificação carrega a renda | `work-time-guard.test.ts` | morto | IA, notificações e relatórios autoritativos não recebem a preferência |
| G16 | prévia do tema (gráfico e lista) sem ForceMoneyDisplay | `work-time-guard.test.ts` | morto | matriz: os pontos elegíveis usam a camada de exibição, e a prévia do tema força reais |
| G17 | Header registra a preferência no log | `work-time-guard.test.ts` | morto | logs da preferência só levam mensagem fixa e código de erro |
| G18 | rótulo do log com a renda digitada | `work-time-guard.test.ts` | morto | logs da preferência só levam mensagem fixa e código de erro |
| G19 | Rules sem conta ativa | `work-time-guard.test.ts` | morto | Rules: bloco explícito do titular, campos e limites iguais ao contrato do cliente |
| G20 | Rules com teto de renda diferente do contrato | `work-time-guard.test.ts` | morto | Rules: bloco explícito do titular, campos e limites iguais ao contrato do cliente |
| G21 | Header da prévia ignora o ForceMoneyDisplay | `work-time-guard.test.ts` | morto | matriz: os pontos elegíveis usam a camada de exibição, e a prévia do tema força reais |
| G22 | parte da divisão volta a converter (ação de um clique) | `work-time-guard.test.ts` | morto | matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G23 | eixo de gráfico volta ao texto longo | `work-time-guard.test.ts` | morto | matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G24 | confirmação de anulação sem o valor em reais no modo tempo | `work-time-guard.test.ts` | morto | matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G25 | import dinâmico da camada num arquivo que fica em BRL | `work-time-guard.test.ts` | morto | matriz: entradas, confirmações, termos, históricos e preços ficam em BRL |
| G27 | eixo mais largo também no modo dinheiro | `work-time-guard.test.ts` | morto | matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G28 | anulação de despesa dividida sem o valor em reais no modo tempo | `work-time-guard.test.ts` | morto | matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G29 | margem negativa no gráfico de fluxo também no modo tempo | `work-time-guard.test.ts` | morto | matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G26 | curinga recursivo com outro nome nas Rules | `work-time-guard.test.ts` | morto | Rules: bloco explícito do titular, campos e limites iguais ao contrato do cliente |
| G30 | principal do empréstimo ganha a versão convertida ao lado dos reais | `work-time-guard.test.ts` | morto | matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G31 | limite usado do cartão ganha a versão convertida ao lado dos reais | `work-time-guard.test.ts` | morto | matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G32 | estado exposto sem conferir o uid (resposta de outra conta aparece) | `work-time-guard.test.ts` | morto | sessão: troca de conta e respostas atrasadas não expõem a preferência de outra conta |
| G33 | listener não é cancelado na troca de conta | `work-time-guard.test.ts` | morto | sessão: troca de conta e respostas atrasadas não expõem a preferência de outra conta |
| G34 | resposta grava o estado sem o uid do listener | `work-time-guard.test.ts` | morto | sessão: troca de conta e respostas atrasadas não expõem a preferência de outra conta |
| G35 | valor exposto lido de state, e não de current (janela da troca de conta) | `work-time-guard.test.ts` | morto | sessão: troca de conta e respostas atrasadas não expõem a preferência de outra conta |
| G36 | valor original do recebível ganha a versão convertida via moneyDisplay | `work-time-guard.test.ts` | morto | matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |

### Reforço da guarda de logs

Na primeira versão, o teste de logs só procurava palavras como `income` ou `preference` dentro de cada `console.error`. Rodado contra essa versão (`mutantes-guarda-anterior.py.txt`):
- **G5** (`console.error(mensagem, error)`, com o objeto de erro inteiro) passava;
- **G18** (rótulo do `logCode` montado com a renda digitada) passava;
- G17 (`workTime.preference` no log) já era pego.

O teste passou a exigir o formato fixo: mensagem literal e só o código do erro, em todo `console.error` do módulo, da tela de Configurações e do Header, e rótulo literal em todo `logCode`. Com isso G5 e G18 morrem, e o código real continua passando. Nenhuma asserção foi afrouxada.

### Reforço da guarda linha a linha (revisão 3)

A revisão 3 apontou que 13 das 19 entradas de `BRL_POINTS_IN_ELIGIBLE_FILES` só exigiam a presença da expressão em reais. Rodados contra essa versão (`mutantes-guarda-r3.py.txt`), G30 e G31 passavam. Os dois mantêm a expressão em reais e acrescentam a versão convertida ao lado.

Doze dessas entradas ganharam o campo `converted`. A única que ficou sem ele é a anulação da despesa dividida, porque o total da despesa no mesmo modal é convertido de propósito (T na matriz). Com isso G30 e G31 morrem e o código real continua passando. Cada uma das 19 expressões aparece uma única vez no seu arquivo (conferido).

### Varredura de renda no E2E (revisão 3)

A revisão 3 também apontou que o teste 4 do E2E deixaria passar uma cópia da renda em reais. O roteiro `mutante-e2e-r3.py.txt` injeta, no teste 4, documentos fora do documento privado: um com o número `4400`, outro com o texto `renda 4400.00` e, desde a revisão 4, um com o texto puro `'4400'`.
- **Spec anterior à revisão 3:** com os dois primeiros documentos, o teste passa (mutante vivo).
- **Spec anterior à revisão 4:** acusa `numero` e `texto`, mas não `texto_puro`. Essa era a lacuna I10.
- **Spec final:** o teste reprova, com os três caminhos na lista de infratores: `…/mutante_r3/numero (renda)`, `…/texto (renda)` e `…/texto_puro (renda)` (mutante morto).

A cópia temporária (`e2e/zz-mutante-r3-*.spec.ts`) foi apagada depois de cada execução; `git status -- e2e` mostra só a spec da P5-F.

### Sessão: troca de conta e respostas atrasadas

O provedor (`WorkTimeContext.tsx`) tem JSX e não roda no `node --test` com remoção de tipos. A guarda passou a travar a estrutura que protege a troca de conta:
- todo `setState` leva o uid do listener;
- o estado exposto só vale para o uid atual;
- o efeito devolve o cancelamento do listener e depende do uid.

Contra a guarda anterior (`mutantes-guarda-sessao.py.txt`), G32, G33 e G34 passavam; agora morrem. A troca de conta real fica coberta pelo E2E 2.

### Reforços da revisão 4

Contra a guarda anterior à revisão 4 (`mutantes-guarda-r4.py.txt`), dois mutantes passavam e agora morrem:
- **G35:** o valor exposto é lido de `state` em vez de `current`. A guarda da sessão passou a exigir `current` no `snapshot` e no `status`, e `state.` só na derivação.
- **G36:** uma célula convertida via `moneyDisplay` ao lado do valor original do recebível. O `converted` passou a procurar o método da camada (`.cents(`, `.reais(`), sem o nome da variável.

### Logs do navegador no E2E

Os quatro testes da P5-F capturam o console e os erros não tratados de cada página, inclusive a segunda aba e o segundo dispositivo, e exigem que a renda não apareça em nenhuma forma. O roteiro `mutante-e2e-logs.py.txt` injeta, no teste 4, a renda vinda da própria página:
- **`console`:** um `console.error` com `renda 4.400,00`. O teste reprova com `log do navegador com "4.400,00"` (mutante morto).
- **`pageerror`:** um erro não tratado com `{"monthlyIncome":4400}`. O teste reprova com `log do navegador com a renda como número` (mutante morto).

Nas execuções normais a captura não fica vazia: ela registra, por exemplo, os avisos de recurso externo do navegador. As cópias temporárias (`e2e/zz-mutante-logs-*.spec.ts`) foram apagadas.

## Rules no Emulator

Roteiro: `mutantes-rules.py.txt`. Cada mutante roda numa pasta própria com `firebase.json`, `.firebaserc`, `firestore.indexes.json` e `package.json` copiados, o `firestore.rules` mutado e a suíte `tests/firestore/work-time-p5f.rules.integration.test.mjs`. Emulator só com Auth e Firestore, projeto `minhas-financas-local`, loopback-proxy seguro; a JVM de cada execução foi encerrada com checagem de identidade.

### 1ª rodada (R1–R13)

| ID | Mutante | Resultado | Primeiro teste que reprova |
| --- | --- | --- | --- |
| R1 | sem a checagem do titular (uid) | morto | owner, admin, member e viewer do workspace não leem a renda do titular (+3) |
| R2 | listagem liberada ao titular | morto | sem listagem e sem consulta de collection group, nem da própria subcoleção |
| R3 | sem hasOnly (campo extra aceito) | morto | campos extras, ausentes, tipos e limites inválidos são negados |
| R4 | updatedAt do cliente aceito | morto | campos extras, ausentes, tipos e limites inválidos são negados |
| R5 | sem piso de R$ 0,01 por hora | morto | campos extras, ausentes, tipos e limites inválidos são negados |
| R6 | sem conta ativa (suspensa passa) | morto | usuário de outro workspace, anônimo e conta suspensa são negados |
| R7 | qualquer id na subcoleção | morto | outro id na subcoleção é negado mesmo com campos válidos |
| R8 | displayMode livre | morto | campos extras, ausentes, tipos e limites inválidos são negados |
| R9 | qualquer conta apaga | morto | usuário de outro workspace, anônimo e conta suspensa são negados (+1) |
| R10 | qualquer conta lê a renda | morto | owner, admin, member e viewer do workspace não leem a renda do titular (+3) |
| R11 | renda abaixo do mínimo aceita | **VIVO** | — |
| R12 | schemaVersion acima de 1 aceito | morto | campos extras, ausentes, tipos e limites inválidos são negados |
| R13 | carga acima de 744 h aceita | morto | campos extras, ausentes, tipos e limites inválidos são negados |

**R11 sobreviveu.** A suíte já tinha o caso "renda abaixo do mínimo" (R$ 0,99), mas com a carga padrão (173 h 20 min) a hora daria menos de R$ 0,01, e o piso do valor por hora também barrava a gravação: o limite mínimo da renda nunca era o único a decidir. Entraram dois casos em que só ele barra, sem remover nenhum: criação com R$ 0,99 e 1 h por mês (hora de R$ 0,99) e atualização para esses mesmos valores. Na mesma rodada entraram dois mutantes de tipo (R14 e R15).

### 2ª rodada (suíte reforçada)

| ID | Mutante | Resultado | Primeiro teste que reprova |
| --- | --- | --- | --- |
| R11 | renda abaixo do mínimo aceita | morto | campos extras, ausentes, tipos e limites inválidos são negados |
| R14 | renda sem exigência de inteiro | morto | campos extras, ausentes, tipos e limites inválidos são negados |
| R15 | enabled sem exigência de booleano | morto | campos extras, ausentes, tipos e limites inválidos são negados |

Na 2ª rodada a suíte original passa (# pass 10 # fail 0) e os três mutantes morrem. Total: 15/15.

Nos roteiros copiados como `.txt`, `<scratchpad>` substitui o diretório temporário da sessão. Nenhum segredo, credencial ou dado real aparece neles.
