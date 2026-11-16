# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work-time-p5f.spec.ts >> ADV-01 (R3.2): sem conexão, a estimativa indisponível continua com o motivo real, sem "calculando" nem "em atualização"; a conversão em uso sai e volta com a conexão
- Location: e2e/work-time-p5f.spec.ts:1310:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: getByTestId('work-time-preview-unavailable')
Expected: "Estimativa indisponível. A fonte escolhida é um espaço PJ. Confirme que quer usar a receita empresarial, ou escolha um espaço PF."
Timeout: 12000ms
Error: element(s) not found

Call log:
  - Expect "toHaveText" with timeout 12000ms
  - waiting for getByTestId('work-time-preview-unavailable')

```

```yaml
- complementary "Menu principal":
  - text: F Finanças
  - navigation:
    - list:
      - listitem:
        - link "Dashboard":
          - /url: "#"
          - img
          - text: Dashboard
      - listitem:
        - link "Empréstimos":
          - /url: "#"
          - img
          - text: Empréstimos
      - listitem:
        - link "Cartões de Crédito":
          - /url: "#"
          - img
          - text: Cartões de Crédito
      - listitem:
        - link "Metas":
          - /url: "#"
          - img
          - text: Metas
      - listitem:
        - link "Dividir Gastos":
          - /url: "#"
          - img
          - text: Dividir Gastos
      - listitem:
        - link "Assinaturas":
          - /url: "#"
          - img
          - text: Assinaturas
      - listitem:
        - link "Relatórios":
          - /url: "#"
          - img
          - text: Relatórios
      - listitem:
        - link "Meu Plano":
          - /url: "#"
          - img
          - text: Meu Plano
      - listitem:
        - link "Configurações":
          - /url: "#"
          - img
          - text: Configurações
  - button "Sair":
    - img
    - text: Sair
- main:
  - heading "Minhas Finanças" [level=1]
  - button "Mês anterior":
    - img
  - button "Selecionar Mês e Ano":
    - text: Novembro de 2026
    - img
  - button "Hoje"
  - button "Próximo mês":
    - img
  - button "Notificações, nenhuma não lida":
    - img
  - button "Mostrar valores em tempo de trabalho" [pressed]
  - button "Ativar modo escuro":
    - img
  - text: Olá, Usuário PESSOAL
  - button "Abrir menu da conta": U
  - paragraph:
    - text: "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações."
    - button "Mostrar em R$"
  - button "Voltar para Configurações":
    - img
  - heading "Tempo de trabalho equivalente" [level=2]
  - paragraph: Veja quanto do seu tempo de trabalho um valor representa. É opcional e só você vê.
  - region "Exibição":
    - heading "Exibição" [level=3]
    - paragraph: Ativar tempo de trabalho equivalente
    - paragraph: Ativado, o botão do relógio no topo alterna entre reais e tempo nas telas financeiras. Desativar guarda a configuração.
    - switch "Ativar tempo de trabalho equivalente" [checked]
    - group "Exibir valores em":
      - text: Exibir valores em
      - radio "Reais (R$)"
      - text: Reais (R$)
      - radio "Tempo de trabalho" [checked]
      - text: Tempo de trabalho
  - region "Rotina de trabalho":
    - heading "Rotina de trabalho" [level=3]
    - paragraph: Dias, horários, intervalos e escalas. As horas de cada mês saem daqui.
    - group "Rotina 1":
      - text: Rotina 1
      - radiogroup "Tipo da rotina 1":
        - radio "Semanal" [checked]
        - text: Semanal
        - radio "Escala cíclica"
        - text: Escala cíclica
      - group "Quais dias da semana você costuma trabalhar?":
        - text: Quais dias da semana você costuma trabalhar?
        - checkbox "Segunda-feira" [checked]
        - checkbox "Terça-feira" [checked]
        - checkbox "Quarta-feira" [checked]
        - checkbox "Quinta-feira" [checked]
        - checkbox "Sexta-feira" [checked]
        - checkbox "Sábado" [checked]
        - checkbox "Domingo" [checked]
        - paragraph: "Nenhum dia é presumido de folga: marque também sábado ou domingo, se trabalhar."
      - group "Jornada para aplicar a vários dias":
        - paragraph: Jornada para aplicar a vários dias
        - text: Como informar
        - combobox "Como informar":
          - option "Início e fim" [selected]
          - option "Só a duração"
        - text: Início
        - textbox "Início": 08:00
        - text: Fim
        - textbox "Fim": 17:00
        - text: Intervalo (min)
        - textbox "Intervalo (min)": "60"
        - paragraph: "Horas efetivas: 8 h"
        - button "Aplicar aos dias marcados"
      - group "Segunda-feira":
        - paragraph: Segunda-feira
        - text: Como informar
        - combobox "Como informar":
          - option "Não trabalho"
          - option "Início e fim" [selected]
          - option "Só a duração"
        - text: Início
        - textbox "Início": 08:00
        - text: Fim
        - textbox "Fim": 17:00
        - text: Intervalo (min)
        - textbox "Intervalo (min)": "60"
        - paragraph: "Horas efetivas: 8 h"
      - group "Terça-feira":
        - paragraph: Terça-feira
        - text: Como informar
        - combobox "Como informar":
          - option "Não trabalho"
          - option "Início e fim" [selected]
          - option "Só a duração"
        - text: Início
        - textbox "Início": 08:00
        - text: Fim
        - textbox "Fim": 17:00
        - text: Intervalo (min)
        - textbox "Intervalo (min)": "60"
        - paragraph: "Horas efetivas: 8 h"
      - group "Quarta-feira":
        - paragraph: Quarta-feira
        - text: Como informar
        - combobox "Como informar":
          - option "Não trabalho"
          - option "Início e fim" [selected]
          - option "Só a duração"
        - text: Início
        - textbox "Início": 08:00
        - text: Fim
        - textbox "Fim": 17:00
        - text: Intervalo (min)
        - textbox "Intervalo (min)": "60"
        - paragraph: "Horas efetivas: 8 h"
      - group "Quinta-feira":
        - paragraph: Quinta-feira
        - text: Como informar
        - combobox "Como informar":
          - option "Não trabalho"
          - option "Início e fim" [selected]
          - option "Só a duração"
        - text: Início
        - textbox "Início": 08:00
        - text: Fim
        - textbox "Fim": 17:00
        - text: Intervalo (min)
        - textbox "Intervalo (min)": "60"
        - paragraph: "Horas efetivas: 8 h"
      - group "Sexta-feira":
        - paragraph: Sexta-feira
        - text: Como informar
        - combobox "Como informar":
          - option "Não trabalho"
          - option "Início e fim" [selected]
          - option "Só a duração"
        - text: Início
        - textbox "Início": 08:00
        - text: Fim
        - textbox "Fim": 17:00
        - text: Intervalo (min)
        - textbox "Intervalo (min)": "60"
        - paragraph: "Horas efetivas: 8 h"
      - group "Sábado":
        - paragraph: Sábado
        - text: Como informar
        - combobox "Como informar":
          - option "Não trabalho"
          - option "Início e fim" [selected]
          - option "Só a duração"
        - text: Início
        - textbox "Início": 08:00
        - text: Fim
        - textbox "Fim": 17:00
        - text: Intervalo (min)
        - textbox "Intervalo (min)": "60"
        - paragraph: "Horas efetivas: 8 h"
      - group "Domingo":
        - paragraph: Domingo
        - text: Como informar
        - combobox "Como informar":
          - option "Não trabalho"
          - option "Início e fim" [selected]
          - option "Só a duração"
        - text: Início
        - textbox "Início": 08:00
        - text: Fim
        - textbox "Fim": 17:00
        - text: Intervalo (min)
        - textbox "Intervalo (min)": "60"
        - paragraph: "Horas efetivas: 8 h"
      - paragraph:
        - text: "Semana típica desta rotina:"
        - strong: 56 h
    - button "Adicionar outra rotina"
    - paragraph: "Use mais de uma rotina para atividades diferentes (por exemplo, dois trabalhos). Se os horários se cruzarem, o tempo em comum conta uma vez só. Informe horas efetivas: o intervalo é descontado uma vez. Uma rotina com intervalo só pode cruzar outra se ficar inteira dentro de horários sem intervalo, porque não dá para saber onde cai a pausa."
  - region "Feriados e localização":
    - heading "Feriados e localização" [level=3]
    - text: Estado (UF)
    - combobox "Estado (UF)":
      - option "Prefiro não informar" [selected]
      - option "AC"
      - option "AL"
      - option "AP"
      - option "AM"
      - option "BA"
      - option "CE"
      - option "DF"
      - option "ES"
      - option "GO"
      - option "MA"
      - option "MT"
      - option "MS"
      - option "MG"
      - option "PA"
      - option "PB"
      - option "PR"
      - option "PE"
      - option "PI"
      - option "RJ"
      - option "RN"
      - option "RS"
      - option "RO"
      - option "RR"
      - option "SC"
      - option "SP"
      - option "SE"
      - option "TO"
    - text: Município (opcional)
    - textbox "Município (opcional)"
    - paragraph: Trabalho normalmente em feriados
    - paragraph: Desligado, os feriados que caem num dia de trabalho saem das horas previstas. Feriado em dia de folga não muda nada.
    - switch "Trabalho normalmente em feriados" [checked]
    - note: "Cobertura do calendário: só os feriados nacionais entram automaticamente. Os feriados estaduais e municipais ainda não têm fonte oficial verificada no FênixGran. Inclua os da sua cidade abaixo. Pontos facultativos nunca entram sozinhos."
    - group: Feriados nacionais de 2026 (9)
    - paragraph: Feriados locais
    - radiogroup "Tipo de feriado local":
      - radio "Data única" [checked]
      - text: Data única
      - radio "Todo ano"
      - text: Todo ano
    - text: Data
    - textbox "Data"
    - button "Incluir feriado"
    - text: Ano
    - textbox "Ano": "2026"
    - button "+ Segunda-feira de Carnaval"
    - button "+ Terça-feira de Carnaval"
    - button "+ Sexta-feira da Paixão"
    - button "+ Corpus Christi"
    - button "+ Eleições (1º turno)"
    - button "+ Eleições (2º turno)"
    - paragraph: "Carnaval e Corpus Christi são pontos facultativos; a Sexta-feira da Paixão é definida por lei municipal. Eleições: 1º turno no primeiro domingo de outubro e, onde houver, 2º turno no último. Inclua só se forem folga para você."
    - paragraph: Nenhum feriado local incluído.
  - region "Exceções da jornada":
    - heading "Exceções da jornada" [level=3]
    - paragraph: Férias, folgas, plantões, horas extras e mudanças pontuais.
    - button "Mês anterior"
    - paragraph: Novembro de 2026 · 240 h previstas
    - button "Próximo mês"
    - group "Calendário de novembro de 2026":
      - button "1 de novembro de 2026, domingo, 8h previstas"
      - 'button "2 de novembro de 2026, segunda-feira, 8h previstas, feriado: Finados"'
      - button "3 de novembro de 2026, terça-feira, 8h previstas"
      - button "4 de novembro de 2026, quarta-feira, 8h previstas"
      - button "5 de novembro de 2026, quinta-feira, 8h previstas"
      - button "6 de novembro de 2026, sexta-feira, 8h previstas"
      - button "7 de novembro de 2026, sábado, 8h previstas"
      - button "8 de novembro de 2026, domingo, 8h previstas"
      - button "9 de novembro de 2026, segunda-feira, 8h previstas"
      - button "10 de novembro de 2026, terça-feira, 8h previstas"
      - button "11 de novembro de 2026, quarta-feira, 8h previstas"
      - button "12 de novembro de 2026, quinta-feira, 8h previstas"
      - button "13 de novembro de 2026, sexta-feira, 8h previstas"
      - button "14 de novembro de 2026, sábado, 8h previstas"
      - 'button "15 de novembro de 2026, domingo, 8h previstas, feriado: Proclamação da República"'
      - button "16 de novembro de 2026, segunda-feira, 8h previstas"
      - button "17 de novembro de 2026, terça-feira, 8h previstas"
      - button "18 de novembro de 2026, quarta-feira, 8h previstas"
      - button "19 de novembro de 2026, quinta-feira, 8h previstas"
      - 'button "20 de novembro de 2026, sexta-feira, 8h previstas, feriado: Dia Nacional de Zumbi e da Consciência Negra"'
      - button "21 de novembro de 2026, sábado, 8h previstas"
      - button "22 de novembro de 2026, domingo, 8h previstas"
      - button "23 de novembro de 2026, segunda-feira, 8h previstas"
      - button "24 de novembro de 2026, terça-feira, 8h previstas"
      - button "25 de novembro de 2026, quarta-feira, 8h previstas"
      - button "26 de novembro de 2026, quinta-feira, 8h previstas"
      - button "27 de novembro de 2026, sexta-feira, 8h previstas"
      - button "28 de novembro de 2026, sábado, 8h previstas"
      - button "29 de novembro de 2026, domingo, 8h previstas"
      - button "30 de novembro de 2026, segunda-feira, 8h previstas"
    - paragraph: Clique numa data para escolhê-la; para um intervalo (férias, por exemplo), clique depois na data final. Com o teclado, use as setas.
    - text: Tipo de exceção
    - combobox "Tipo de exceção":
      - option "Férias" [selected]
      - option "Folga"
      - option "Ausência"
      - option "Feriado trabalhado"
      - option "Plantão"
      - option "Hora extra"
      - option "Jornada reduzida"
      - option "Alteração de escala"
    - text: De
    - textbox "De"
    - text: Até (opcional)
    - textbox "Até (opcional)"
    - paragraph: Só guardamos o tipo e as datas. Não informe motivos nem dados de saúde.
    - button "Incluir exceção"
    - paragraph: Exceções incluídas (0)
    - paragraph: Nenhuma exceção. As horas previstas seguem só a rotina e os feriados.
  - region "Renda considerada":
    - heading "Renda considerada" [level=3]
    - paragraph: As receitas vêm dos seus lançamentos oficiais; nada é digitado.
    - text: De qual espaço vem a sua renda?
    - combobox "De qual espaço vem a sua renda?":
      - option "Pessoal P5F · PF (pessoal)"
      - option "Empresa P5F · PJ (empresa)" [selected]
    - paragraph: "Uma fonte por vez: receitas de espaços diferentes nunca são somadas."
    - note: "Faturamento de empresa (PJ) não é necessariamente renda pessoal: o valor bruto pode incluir custos, impostos e o que fica na empresa. Use essa fonte só se ela representar a sua remuneração. A estimativa passa a ser identificada como baseada em receita empresarial."
    - checkbox "Quero usar a receita deste espaço PJ como referência da minha renda."
    - text: Quero usar a receita deste espaço PJ como referência da minha renda.
    - group "Como estimar":
      - text: Como estimar
      - 'radio "Habitual (recomendado): últimos meses completos. Mais estável para comissões e renda variável." [checked]'
      - strong: "Habitual (recomendado):"
      - text: últimos meses completos. Mais estável para comissões e renda variável.
      - 'radio "Mês atual: receitas já efetivadas neste mês ÷ horas previstas do mês inteiro. Muda até o fim do mês."'
      - strong: "Mês atual:"
      - text: receitas já efetivadas neste mês ÷ horas previstas do mês inteiro. Muda até o fim do mês.
    - text: Meses completos considerados
    - combobox "Meses completos considerados":
      - option "1 mês"
      - option "3 meses (recomendado)" [selected]
      - option "6 meses"
      - option "12 meses"
    - button "Receitas consideradas"
  - heading "Como funciona" [level=3]
  - paragraph: "O valor é dividido pelo que uma hora da sua renda representa: soma das receitas elegíveis ÷ soma das horas previstas dos mesmos meses. Exemplo: R$ 3.520,00 em 176 horas dão R$ 20,00 por hora, e R$ 482,35 equivalem a cerca de 24 h 7 min."
  - paragraph: É uma estimativa aproximada e informativa, arredondada ao minuto mais próximo. Não é custo contábil, preço do seu trabalho, salário líquido, produtividade nem retorno. Seus registros, saldos e relatórios continuam em reais, e pagamentos, formulários e confirmações sempre mostram reais.
  - paragraph: Sua rotina, seus feriados, suas exceções e o valor da sua hora ficam só na sua conta. Ninguém dos seus espaços consegue vê-los, inclusive proprietários e administradores, e eles não vão para o assistente de IA, notificações nem relatórios. Você pode excluir esses dados quando quiser.
  - alert:
    - paragraph: "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais."
    - button "Tentar de novo"
  - paragraph: Nada foi salvo ainda.
  - button "Salvar alterações"
  - button "Descartar alterações"
  - button "Refazer assistente"
  - button "Excluir meus dados"
  - button "Consultar a memória de cálculo"
```

# Test source

```ts
  1233 |   await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time' });
  1234 |   // O espaço ativo é o PJ (sem lançamentos); a renda vem do PF: o saldo do PJ em tempo só muda com a hora.
  1235 |   await startOn(page, A.uid, tenant.pj.workspaceId);
  1236 |   await login(page, A.email);
  1237 |   await expect(page.getByText(COMPANY).first()).toBeVisible({ timeout: 20_000 });
  1238 |   const pjBalance = 35_200;
  1239 |   const pjMinutes = roundedMinutes(pjBalance, tenant.workMinutes, tenant.incomeCents);
  1240 |   await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(pjMinutes), { timeout: 30_000 });
  1241 |   const stale = 'Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações.';
  1242 |   const unavailable = 'Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações.';
  1243 |   const approximate = 'Valores em tempo de trabalho equivalente: uma estimativa aproximada, não o valor exato.';
  1244 |   await expect(notice(page)).not.toContainText(stale);
  1245 |   // A conta fica suspensa e outra sessão toca a projeção de um mês da janela no PF: a escuta aberta da
  1246 |   // estimativa em uso recebe a recusa das Rules e é encerrada (o SDK não a reabre). Sem o retorno do servidor nada
  1247 |   // é confirmado, também com uma base e nenhuma desconsiderada (P5-F.1-R3.2, RR-R31-05): os valores voltam a reais,
  1248 |   // sem conversão pela leitura anterior, e o topo diz que a estimativa está indisponível.
  1249 |   const [firstMonth, , lastMonth] = habitualMonths();
  1250 |   await db().doc(`users/${A.uid}`).update({ status: 'suspended' });
  1251 |   await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${firstMonth}`)
  1252 |     .update({ updatedAt: adminSdk().firestore.FieldValue.serverTimestamp() });
  1253 |   await expect(notice(page)).toContainText(unavailable, { timeout: 30_000 });
  1254 |   await expect(page.locator('[data-work-time]')).toHaveCount(0);
  1255 |   await expect(balanceCard(page)).toContainText(brl(pjBalance));
  1256 |   await expect(notice(page)).not.toContainText(stale);
  1257 |   // De volta a conta, a pessoa segue o aviso e abre Configurações: a escuta da prévia recebe o
  1258 |   // servidor e reabre a da estimativa em uso, que não tem botão próprio.
  1259 |   await db().doc(`users/${A.uid}`).update({ status: 'active' });
  1260 |   await openWorkTimeSettings(page);
  1261 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  1262 |   await expect(notice(page)).toContainText(approximate, { timeout: 30_000 });
  1263 |   await expect(notice(page)).not.toContainText(stale);
  1264 |   // De volta ao Dashboard, sem a prévia: o saldo convertido de novo e uma receita retroativa de outra sessão no PF
  1265 |   // chega à estimativa em uso.
  1266 |   await openDashboard(page);
  1267 |   await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(pjMinutes), { timeout: 30_000 });
  1268 |   const officialBefore = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data()?.incomeCents as number;
  1269 |   await createIncome(request, tenant.pf, `${lastMonth}-16`, 50_000, 'Retroativa depois da reabertura');
  1270 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  1271 |   await expect(balanceCard(page).locator('[data-work-time]'))
  1272 |     .toContainText(timeText(roundedMinutes(pjBalance, tenant.workMinutes, tenant.incomeCents + 50_000)), { timeout: 45_000 });
  1273 |   await expect(notice(page)).not.toContainText(stale);
  1274 | });
  1275 | 
  1276 | /** Grava cada estado da prévia de Configurações e cada texto do aviso do topo, na ordem (P5-F.1-R3.2, ADV-01). */
  1277 | const recordEstimateStates = (page: Page) => page.evaluate(() => {
  1278 |   const state = window as unknown as { __p5fStates: { preview: string[]; notice: string[] } };
  1279 |   state.__p5fStates = { preview: [], notice: [] };
  1280 |   const push = (list: string[], value: string) => {
  1281 |     if (list[list.length - 1] !== value) list.push(value);
  1282 |   };
  1283 |   const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  1284 |   const read = () => {
  1285 |     const loading = text('work-time-preview-loading');
  1286 |     const error = text('work-time-preview-error');
  1287 |     const hourly = text('work-time-preview-hourly');
  1288 |     const unavailable = text('work-time-preview-unavailable');
  1289 |     push(state.__p5fStates.preview, loading !== null ? `calculando|${loading}`
  1290 |       : error !== null ? `erro|${error}`
  1291 |         : hourly !== null ? `hora|${hourly}`
  1292 |           : unavailable !== null ? `indisponivel|${unavailable}` : 'nenhum');
  1293 |     push(state.__p5fStates.notice, text('work-time-notice') ?? 'nenhum');
  1294 |   };
  1295 |   read();
  1296 |   new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  1297 | });
  1298 | const recordedEstimateStates = (page: Page) =>
  1299 |   page.evaluate(() => (window as unknown as { __p5fStates: { preview: string[]; notice: string[] } }).__p5fStates);
  1300 | 
  1301 | /**
  1302 |  * P5-F.1-R3.2 (ADV-01): a estimativa indisponível não converte e aparece como está, com o motivo real, também sem
  1303 |  * conexão. A estimativa em uso (renda do PF) converte; a prévia de Configurações, com a fonte trocada para o espaço PJ
  1304 |  * sem a confirmação da receita empresarial, mostra o motivo. A conexão cai: a estimativa em uso perde a conversão (o
  1305 |  * sinal de que o SDK passou a servir só do cache local), e a prévia continua com o motivo, sem "calculando" nem "em
  1306 |  * atualização", por mais que o tempo de interface (30 s). Antes da correção, o retorno só do cache local tirava a
  1307 |  * confirmação da projeção e a prévia trocava o motivo por "calculando" e, depois, por "em atualização". Com a conexão de
  1308 |  * volta, a conversão da estimativa em uso volta e o motivo continua; nada é gravado.
  1309 |  */
  1310 | test('ADV-01 (R3.2): sem conexão, a estimativa indisponível continua com o motivo real, sem "calculando" nem "em atualização"; a conversão em uso sai e volta com a conexão', async ({ page, request, context }) => {
  1311 |   test.setTimeout(300_000);
  1312 |   const tenant = await seedTenant(request);
  1313 |   await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time' });
  1314 |   await startOn(page, A.uid, tenant.pf.workspaceId);
  1315 |   await login(page, A.email);
  1316 |   const approximate = 'Valores em tempo de trabalho equivalente: uma estimativa aproximada, não o valor exato.';
  1317 |   const unavailable = 'Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações.';
  1318 |   const reason = 'Estimativa indisponível. A fonte escolhida é um espaço PJ. Confirme que quer usar a receita empresarial, ou escolha um espaço PF.';
  1319 |   await expect(notice(page)).toContainText(approximate, { timeout: 60_000 });
  1320 |   await openWorkTimeSettings(page);
  1321 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 60_000 });
  1322 |   await page.getByLabel('De qual espaço vem a sua renda?').selectOption(tenant.pj.workspaceId);
  1323 |   await expect(page.getByTestId('work-time-preview-unavailable')).toHaveText(reason, { timeout: 30_000 });
  1324 |   await expect(notice(page)).toContainText(approximate);
  1325 |   await recordEstimateStates(page);
  1326 | 
  1327 |   // Sem conexão: a estimativa em uso perde a conversão; a prévia indisponível fica como está, passado o tempo de
  1328 |   // interface (a estimativa em uso, que esperava a prova, passa a "indisponível agora" no topo).
  1329 |   await context.setOffline(true);
  1330 |   await expect(notice(page)).not.toContainText(approximate, { timeout: 60_000 });
  1331 |   await page.waitForTimeout(35_000);
  1332 |   await expect(notice(page)).toContainText(unavailable);
> 1333 |   await expect(page.getByTestId('work-time-preview-unavailable')).toHaveText(reason);
       |                                                                   ^ Error: expect(locator).toHaveText(expected) failed
  1334 |   const offline = await recordedEstimateStates(page);
  1335 |   await test.info().attach('adv-01-sem-conexao', { body: JSON.stringify(offline, null, 2), contentType: 'application/json' });
  1336 |   expect(offline.preview, 'sem conexão, a prévia só mostrou o motivo real').toEqual([`indisponivel|${reason}`]);
  1337 |   expect(offline.notice[0], 'antes da queda, a estimativa em uso convertia').toContain(approximate);
  1338 |   expect(offline.notice.slice(1).some((entry) => entry.includes(approximate)), 'sem conexão, nenhuma conversão em uso').toBe(false);
  1339 | 
  1340 |   // A conexão volta: a conversão da estimativa em uso volta sozinha, e a prévia continua com o motivo.
  1341 |   await context.setOffline(false);
  1342 |   await expect(notice(page)).toContainText(approximate, { timeout: 60_000 });
  1343 |   await expect(page.getByTestId('work-time-preview-unavailable')).toHaveText(reason);
  1344 |   const seen = await recordedEstimateStates(page);
  1345 |   await test.info().attach('adv-01', { body: JSON.stringify(seen, null, 2), contentType: 'application/json' });
  1346 |   expect(seen.preview, 'do começo ao fim, a prévia só mostrou o motivo real').toEqual([`indisponivel|${reason}`]);
  1347 |   await page.getByRole('button', { name: 'Descartar alterações' }).click();
  1348 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  1349 |   expect(await storedPreference(A.uid), 'nada gravado').toMatchObject({
  1350 |     incomeWorkspaceId: tenant.pf.workspaceId, allowBusinessIncome: false, displayMode: 'time',
  1351 |   });
  1352 | });
  1353 | 
  1354 | 
  1355 | // ------------------------------------------------------------- vazamentos
  1356 | 
  1357 | /** Valores derivados da estimativa de A, que só podem existir em memória. */
  1358 | const derivedNeedles = (tenant: Tenant) => ({
  1359 |   numbers: [tenant.incomeCents, tenant.workMinutes],
  1360 |   /** Em reais formatados: comparados em qualquer texto (documentos, payloads, logs e armazenamento local). */
  1361 |   money: [brlText(tenant.incomeCents), brlText(2_500)],
  1362 |   /** Todas as formas, só para logs, payloads e armazenamento local (em documentos, ids poderiam conter os dígitos). */
  1363 |   texts: [brlText(tenant.incomeCents), brlText(2_500), String(tenant.incomeCents), String(tenant.workMinutes)],
  1364 | });
  1365 | 
  1366 | /** Algum valor folha igual a um derivado (número exato ou texto em reais que o contém). Carimbos de tempo ficam de fora. */
  1367 | const carriesDerived = (value: unknown, needles: ReturnType<typeof derivedNeedles>): boolean => {
  1368 |   if (value === null || value === undefined) return false;
  1369 |   if (typeof (value as { toMillis?: unknown }).toMillis === 'function') return false;
  1370 |   if (typeof value === 'number') return needles.numbers.includes(value);
  1371 |   if (typeof value === 'string') return needles.money.some((needle) => value.includes(needle));
  1372 |   if (Array.isArray(value)) return value.some((item) => carriesDerived(item, needles));
  1373 |   if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => carriesDerived(item, needles));
  1374 |   return false;
  1375 | };
  1376 | 
  1377 | /** Console e erros não tratados de cada página do teste, para provar que nada derivado chega aos logs do navegador. */
  1378 | const watchBrowserLogs = (page: Page, lines: string[] = []): string[] => {
  1379 |   page.on('console', (message) => lines.push(message.text()));
  1380 |   page.on('pageerror', (error) => lines.push(String(error)));
  1381 |   return lines;
  1382 | };
  1383 | 
  1384 | const expectNoDerivedInLogs = (lines: string[], needles: ReturnType<typeof derivedNeedles>) => {
  1385 |   const joined = lines.join('\n');
  1386 |   for (const needle of needles.texts) expect(joined, `log do navegador com "${needle}"`).not.toContain(needle);
  1387 |   expect(joined).not.toMatch(/W:08:00|excludedIncomeIds|incomeWorkspaceId/);
  1388 | };
  1389 | 
  1390 | /** Chaves locais com qualquer dado da preferência (deve ser nenhuma). */
  1391 | const localStorageKeysWithPreference = (entries: Array<[string, string]>, needles: ReturnType<typeof derivedNeedles>) =>
  1392 |   entries.filter(([key, value]) => /work.?time|private_preferences/i.test(key)
  1393 |     || needles.texts.some((needle) => value.includes(needle)) || /W:08:00|excludedIncomeIds/.test(value))
  1394 |     .map(([key]) => key);
  1395 | 
  1396 | // ------------------------------------------------------------------ P5-F.1-R1
  1397 | 
  1398 | /** Grava, na página, cada valor da hora que a prévia mostra (para provar que nenhum estado intermediário aparece). */
  1399 | const recordPreviewHourly = (page: Page) => page.evaluate(() => {
  1400 |   const state = window as unknown as { __p5fHourly: string[] };
  1401 |   state.__p5fHourly = [];
  1402 |   const read = () => {
  1403 |     const text = document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim() ?? '';
  1404 |     if (text && state.__p5fHourly[state.__p5fHourly.length - 1] !== text) state.__p5fHourly.push(text);
  1405 |   };
  1406 |   read();
  1407 |   new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  1408 | });
  1409 | const recordedPreviewHourly = async (page: Page) =>
  1410 |   (await page.evaluate(() => (window as unknown as { __p5fHourly: string[] }).__p5fHourly)).map((text) => text.replace(/\s+/g, ' '));
  1411 | 
  1412 | test('B01 (P5-F.1-R1): recebimento de cliente desconsiderado e estornado em outra sessão: a exclusão perde o efeito e a prévia nunca desconta duas vezes', async ({ page, request }) => {
  1413 |   test.setTimeout(360_000);
  1414 |   const tenant = await seedTenant(request);
  1415 |   // Clientes e recebíveis existem só em espaço PJ: a renda vem do PJ, com a confirmação de renda empresarial,
  1416 |   // e o faturamento dos três meses é o mesmo da jornada de referência (R$ 25,00 por hora).
  1417 |   const workspaceId = tenant.pj.workspaceId;
  1418 |   const billed: Record<string, number> = {};
  1419 |   for (const month of habitualMonths()) {
  1420 |     billed[month] = daysIn(month) * A_DAY_CENTS;
  1421 |     await createIncome(request, tenant.pj, `${month}-05`, billed[month], `Faturamento ${month}`);
  1422 |   }
  1423 |   await waitForReceipts(workspaceId, billed);
  1424 |   const lastMonth = habitualMonths()[2];
  1425 |   const officialBefore = billed[lastMonth];
  1426 |   // Um recebimento de cliente de R$ 1.000,00 no último mês completo, pelas callables oficiais.
  1427 |   const clientId = await createClientByApi(request, tenant.pj.token, workspaceId, { name: 'Cliente P5F1-R1' });
  1428 |   const receivableId = await createReceivableByApi(request, tenant.pj.token, workspaceId, clientId, {
  1429 |     description: 'Projeto P5F1-R1', amountCents: 100_000, dueDate: saoPauloToday(),
  1430 |   });
  1431 |   const received = await callCallable(request, tenant.pj.token, 'receiveReceivable', {
  1432 |     workspaceId, idempotencyKey: intentKey('p5f1r1-receive'), receivableId,
  1433 |     expectedUpdatedAt: versionOf(await docOf(workspaceId, 'receivables', receivableId)),
```