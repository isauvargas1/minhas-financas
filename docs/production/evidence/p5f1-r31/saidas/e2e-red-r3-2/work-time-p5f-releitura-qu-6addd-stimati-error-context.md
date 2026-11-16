# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work-time-p5f.spec.ts >> releitura que falha: sem confirmar a receita nova, nada convertido e erro com "Tentar de novo", que a traz com o relatório de volta; com a projeção de volta à última leitura, a estimativa volta com o aviso
- Location: e2e/work-time-p5f.spec.ts:1038:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('work-time-preview-error')
Expected substring: "Não foi possível carregar o relatório. Tente novamente."
Timeout: 45000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 45000ms
  - waiting for getByTestId('work-time-preview-error')

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
    - text: "Valores em tempo de trabalho equivalente: uma estimativa aproximada, não o valor exato. Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações."
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
      - option "Pessoal P5F · PF (pessoal)" [selected]
      - option "Empresa P5F · PJ (empresa)"
    - paragraph: "Uma fonte por vez: receitas de espaços diferentes nunca são somadas."
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
  - paragraph: Valor estimado da sua hora
  - paragraph: R$ 25,00
  - status:
    - paragraph: Não foi possível atualizar a estimativa com os lançamentos mais recentes agora. Ela usa a última leitura.
    - button "Tentar de novo"
  - term: "Fonte:"
  - definition: Pessoal P5F (PF)
  - term: "Modo:"
  - definition: "Habitual: últimos 3 meses completos"
  - term: "Período:"
  - definition: agosto de 2026 a outubro de 2026
  - term: "Receitas elegíveis:"
  - definition: R$ 18.400,00
  - term: "Horas previstas:"
  - definition: 736 h
  - paragraph: Uma compra de R$ 150,00 equivale a ≈ 6 h de trabalho.
  - button "Como este valor foi calculado?"
  - button "Salvar alterações" [disabled]
  - button "Refazer assistente"
  - button "Excluir meus dados"
  - button "Consultar a memória de cálculo"
```

# Test source

```ts
  981  |   await timeToggle(page).click();
  982  |   await expect(timeToggle(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
  983  |   await expect.poll(async () => (await storedPreference(A.uid))?.displayMode, { timeout: 20_000 }).toBe('time');
  984  |   // O rascunho adota o modo novo (a pessoa não tinha mexido nele), a edição continua e nada acusa "outra aba".
  985  |   await expect(modeRadio('Tempo de trabalho')).toBeChecked({ timeout: 20_000 });
  986  |   await expect(page.getByRole('checkbox', { name: 'Domingo' }).first()).not.toBeChecked();
  987  |   await expect(page.getByTestId('work-time-unsaved')).toBeVisible();
  988  |   await expect(page.getByText('A configuração foi alterada em outra aba ou dispositivo', { exact: false })).toHaveCount(0);
  989  |   // Salvar grava a edição e mantém o modo escolhido no Header.
  990  |   await saveButton(page).click();
  991  |   await expect(page.getByText('Alterações salvas.')).toBeVisible({ timeout: 20_000 });
  992  |   const saved = await storedPreference(A.uid);
  993  |   expect(saved?.displayMode).toBe('time');
  994  |   expect(String(saved?.routines).split(',').at(-1), 'domingo sem trabalho').toBe('-');
  995  |   await expect(timeToggle(page)).toHaveAttribute('aria-pressed', 'true');
  996  |   await expect(page.getByText('A configuração foi alterada em outra aba ou dispositivo', { exact: false })).toHaveCount(0);
  997  | });
  998  | 
  999  | test('falha na leitura das receitas desconsideradas: mensagem fixa em pt-BR, nada do SDK, e "Tentar de novo"', async ({ page, request }) => {
  1000 |   test.setTimeout(180_000);
  1001 |   const tenant = await seedTenant(request);
  1002 |   await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money' });
  1003 |   await startOn(page, A.uid, tenant.pf.workspaceId);
  1004 |   await login(page, A.email);
  1005 |   await openWorkTimeSettings(page);
  1006 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  1007 |   await page.getByTestId('work-time-income-panel-open').click();
  1008 |   const panel = page.getByRole('dialog', { name: 'Receitas consideradas' });
  1009 |   const lastMonth = habitualMonths()[2];
  1010 |   const salary = panel.getByRole('checkbox', { name: new RegExp(`Considerar Salário ${lastMonth}`) });
  1011 |   await expect(salary).toBeChecked({ timeout: 30_000 });
  1012 |   // A conta fica suspensa: as Rules negam a leitura por id da exclusão nova.
  1013 |   await db().doc(`users/${A.uid}`).update({ status: 'suspended' });
  1014 |   await salary.click();
  1015 |   // A leitura falha: o painel não monta a lista sem a estimativa e pede para fechar e tentar de novo.
  1016 |   await expect(panel.getByRole('alert')).toHaveText('A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo.', { timeout: 30_000 });
  1017 |   await panel.getByRole('button', { name: 'Concluir' }).click();
  1018 |   const failure = page.getByTestId('work-time-preview-error');
  1019 |   await expect(failure).toContainText('Não foi possível conferir as receitas desconsideradas agora. Tente de novo.', { timeout: 30_000 });
  1020 |   await expect(failure).not.toContainText(/permission|insufficient|firestore|firebase/i);
  1021 |   await expect(previewHourly(page)).toHaveCount(0);
  1022 |   // De volta a conta, "Tentar de novo" traz a estimativa sem o salário desconsiderado; nada foi gravado.
  1023 |   await db().doc(`users/${A.uid}`).update({ status: 'active' });
  1024 |   await failure.getByRole('button', { name: 'Tentar de novo' }).click();
  1025 |   const without = tenant.incomeCents - daysIn(lastMonth) * A_DAY_CENTS;
  1026 |   const hourlyWithout = Number((2n * BigInt(without) * 60n + BigInt(tenant.workMinutes)) / (2n * BigInt(tenant.workMinutes)));
  1027 |   await expect(previewHourly(page)).toHaveText(brl(hourlyWithout), { timeout: 30_000 });
  1028 |   expect((await storedPreference(A.uid))?.excludedIncomeIds, 'nada gravado antes de salvar').toBe('');
  1029 | });
  1030 | 
  1031 | // Contrato da P5-F.1-R3.1 (R3-AUD-01). Desde a R1, este teste afirmava que, com a releitura em falha e uma receita
  1032 | // nova ainda não lida, a prévia seguia com a hora anterior (R$ 25,00) e o aviso de leitura anterior: a conversão
  1033 | // anterior aparecia enquanto a sincronização não confirmava o estado atual. Agora, sem essa confirmação, nada é
  1034 | // convertido (o erro do relatório, com "Tentar de novo"), e o "Tentar de novo" com o relatório de volta traz a receita
  1035 | // nova, como antes. O aviso de leitura anterior continua, para o estado atual confirmado pela escuta (a projeção de
  1036 | // volta ao que a última leitura trouxe). As asserções de texto, de ausência de detalhe interno e de recuperação seguem
  1037 | // abaixo. Justificativa: docs/production/evidence/p5f1-r31/testes-substituidos.md.
  1038 | test('releitura que falha: sem confirmar a receita nova, nada convertido e erro com "Tentar de novo", que a traz com o relatório de volta; com a projeção de volta à última leitura, a estimativa volta com o aviso', async ({ page, request }) => {
  1039 |   test.setTimeout(300_000);
  1040 |   const tenant = await seedTenant(request);
  1041 |   await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time' });
  1042 |   await startOn(page, A.uid, tenant.pf.workspaceId);
  1043 |   await login(page, A.email);
  1044 |   await openWorkTimeSettings(page);
  1045 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  1046 |   const hourlyOf = (income: number) => Number((2n * BigInt(income) * 60n + BigInt(tenant.workMinutes)) / (2n * BigInt(tenant.workMinutes)));
  1047 |   const hourlyX = hourlyOf(tenant.incomeCents + 50_000);
  1048 |   const hourlyXZ = hourlyOf(tenant.incomeCents + 80_000);
  1049 |   expect(new Set([2_500, hourlyX, hourlyXZ]).size, 'as horas de cada estado são distinguíveis').toBe(3);
  1050 |   // Daqui em diante, cada estado da prévia (hora mostrada, erro, aviso de leitura anterior) é registrado com a hora do navegador.
  1051 |   await page.evaluate(() => {
  1052 |     const state = window as unknown as { __p5fPreview: { at: number; hourly: string; error: boolean; stale: boolean }[] };
  1053 |     state.__p5fPreview = [];
  1054 |     const read = () => {
  1055 |       const entry = {
  1056 |         at: Date.now(),
  1057 |         hourly: document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim() ?? '',
  1058 |         error: document.querySelector('[data-testid="work-time-preview-error"]') !== null,
  1059 |         stale: document.querySelector('[data-testid="work-time-preview-refresh-failed"]') !== null,
  1060 |       };
  1061 |       const last = state.__p5fPreview[state.__p5fPreview.length - 1];
  1062 |       if (!last || last.hourly !== entry.hourly || last.error !== entry.error || last.stale !== entry.stale) state.__p5fPreview.push(entry);
  1063 |     };
  1064 |     read();
  1065 |     new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  1066 |   });
  1067 |   const now = () => page.evaluate(() => Date.now());
  1068 |   // O relatório oficial passa a falhar; outra sessão lança uma receita retroativa na janela.
  1069 |   const failReport = (route: Route) => route.fulfill({
  1070 |     status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'internal failure' } }),
  1071 |   });
  1072 |   await page.route('**/getFinancialReport', failReport);
  1073 |   const lastMonth = habitualMonths()[2];
  1074 |   const officialBefore = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data()?.incomeCents as number;
  1075 |   await createIncome(request, tenant.pf, `${lastMonth}-16`, 50_000, 'Retroativa sem releitura');
  1076 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  1077 |   // Fase 1. A releitura falha e a sincronização não confirma o estado atual: nenhuma hora, nem a anterior. O erro do
  1078 |   // relatório em pt-BR, sem detalhe interno, com "Tentar de novo"; no topo, os valores ficam em reais.
  1079 |   const failure = page.getByTestId('work-time-preview-error');
  1080 |   const stale = page.getByTestId('work-time-preview-refresh-failed');
> 1081 |   await expect(failure).toContainText('Não foi possível carregar o relatório. Tente novamente.', { timeout: 45_000 });
       |                         ^ Error: expect(locator).toContainText(expected) failed
  1082 |   await expect(failure).not.toContainText(/internal|INTERNAL/);
  1083 |   await expect(failure.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  1084 |   await expect(previewHourly(page)).toHaveCount(0);
  1085 |   await expect(stale).toHaveCount(0);
  1086 |   await expect(notice(page)).toContainText('Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações.');
  1087 |   await expect(converted(page)).toHaveCount(0);
  1088 |   // Fase 2. De volta o relatório, o "Tentar de novo" do erro traz a receita nova; o erro some e nenhum aviso fica.
  1089 |   await page.unroute('**/getFinancialReport', failReport);
  1090 |   const retriedAt = await now();
  1091 |   await failure.getByRole('button', { name: 'Tentar de novo' }).click();
  1092 |   await expect(previewHourly(page)).toHaveText(brl(hourlyX), { timeout: 30_000 });
  1093 |   await expect(failure).toHaveCount(0);
  1094 |   await expect(stale).toHaveCount(0);
  1095 |   await expect(notice(page)).not.toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes');
  1096 |   // Fase 3. O relatório volta a falhar e outra sessão lança mais uma receita: de novo o erro, sem hora.
  1097 |   await page.route('**/getFinancialReport', failReport);
  1098 |   const failedAgainAt = await now();
  1099 |   const secondId = await createIncome(request, tenant.pf, `${lastMonth}-17`, 20_000, 'Retroativa anulada');
  1100 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 70_000 });
  1101 |   await expect(failure).toContainText('Não foi possível carregar o relatório. Tente novamente.', { timeout: 45_000 });
  1102 |   await expect(previewHourly(page)).toHaveCount(0);
  1103 |   await expect(stale).toHaveCount(0);
  1104 |   // Outra sessão anula essa receita: a projeção volta ao que a última leitura trouxe. A escuta confirma o estado atual,
  1105 |   // e a estimativa volta com o aviso imediato de que a releitura falhou, sem detalhe interno; o topo também.
  1106 |   const voidedAt = await now();
  1107 |   const secondDoc = (await db().doc(`workspaces/${tenant.pf.workspaceId}/transactions/${secondId}`).get()).data() ?? {};
  1108 |   const voided = await callCallable(request, tenant.pf.token, 'voidCashTransaction', {
  1109 |     workspaceId: tenant.pf.workspaceId, idempotencyKey: intentKey('p5f1-r31-void'), transactionId: secondId,
  1110 |     expectedUpdatedAt: versionOf(secondDoc), reason: 'Lançada por engano',
  1111 |   });
  1112 |   expect(voided.status, JSON.stringify(voided)).toBe(200);
  1113 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  1114 |   await expect(stale).toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes agora. Ela usa a última leitura.', { timeout: 45_000 });
  1115 |   await expect(stale).not.toContainText(/internal|INTERNAL/);
  1116 |   await expect(previewHourly(page)).toHaveText(brl(hourlyX));
  1117 |   await expect(failure).toHaveCount(0);
  1118 |   await expect(notice(page)).toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações.');
  1119 |   // Fase 4. De volta o relatório, o "Tentar de novo" do aviso relê: o aviso some e a hora continua a oficial.
  1120 |   await page.unroute('**/getFinancialReport', failReport);
  1121 |   await stale.getByRole('button', { name: 'Tentar de novo' }).click();
  1122 |   await expect(stale).toHaveCount(0, { timeout: 30_000 });
  1123 |   await expect(previewHourly(page)).toHaveText(brl(hourlyX), { timeout: 30_000 });
  1124 |   await expect(notice(page)).not.toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes');
  1125 |   // Fase 5. Uma receita nova depois disso chega à estimativa: a sincronização confirma e a conversão volta normalmente.
  1126 |   await createIncome(request, tenant.pf, `${lastMonth}-18`, 30_000, 'Retroativa com releitura');
  1127 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 80_000 });
  1128 |   await expect(previewHourly(page)).toHaveText(brl(hourlyXZ), { timeout: 45_000 });
  1129 |   await expect(failure).toHaveCount(0);
  1130 |   await expect(stale).toHaveCount(0);
  1131 |   // O registro: nos dois intervalos de erro (do erro até o "Tentar de novo" e até a anulação), nenhuma hora; o aviso
  1132 |   // de leitura anterior só com a hora confirmada pela escuta; as horas novas só sem aviso e sem erro.
  1133 |   const states = await page.evaluate(() => (window as unknown as { __p5fPreview: { at: number; hourly: string; error: boolean; stale: boolean }[] }).__p5fPreview);
  1134 |   await test.info().attach('previa-releitura-que-falha', { body: JSON.stringify(states, null, 2), contentType: 'application/json' });
  1135 |   console.log(`[previa-releitura-que-falha] ${JSON.stringify(states)}`);
  1136 |   const spaced = (text: string) => text.replace(/\s+/g, ' ');
  1137 |   const firstError = states.findIndex((entry) => entry.error);
  1138 |   expect(firstError, `o primeiro erro apareceu: ${JSON.stringify(states)}`).toBeGreaterThan(0);
  1139 |   const secondError = states.findIndex((entry) => entry.error && entry.at >= failedAgainAt);
  1140 |   expect(secondError, `o segundo erro apareceu: ${JSON.stringify(states)}`).toBeGreaterThan(firstError);
  1141 |   const unconfirmed = [
  1142 |     ...states.slice(firstError).filter((entry) => entry.at < retriedAt),
  1143 |     ...states.slice(secondError).filter((entry) => entry.at < voidedAt),
  1144 |   ];
  1145 |   expect(unconfirmed.filter((entry) => entry.hourly !== ''), `nenhuma hora sem confirmar a receita nova: ${JSON.stringify(states)}`).toEqual([]);
  1146 |   expect(states.filter((entry) => entry.stale && spaced(entry.hourly) !== spaced(brlText(hourlyX))), 'aviso só com a hora confirmada').toEqual([]);
  1147 |   expect(states.filter((entry) => [hourlyX, hourlyXZ].some((cents) => spaced(entry.hourly) === spaced(brlText(cents))) && entry.error), 'hora nova nunca junto do erro').toEqual([]);
  1148 |   expect(states.filter((entry) => spaced(entry.hourly) === spaced(brlText(hourlyXZ)) && entry.stale), 'a hora da última receita sem aviso').toEqual([]);
  1149 |   expect(states.some((entry) => entry.stale), 'o aviso de leitura anterior apareceu').toBe(true);
  1150 | });
  1151 | 
  1152 | test('mutação nesta aba: anular em Receitas a receita desconsiderada não junta o item anulado com o total velho', async ({ page, request }) => {
  1153 |   test.setTimeout(240_000);
  1154 |   const tenant = await seedTenant(request);
  1155 |   // Preparo (outra sessão): uma receita de R$ 500,00 no último mês completo, desconsiderada.
  1156 |   const lastMonth = habitualMonths()[2];
  1157 |   const officialBefore = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data()?.incomeCents as number;
  1158 |   const extraId = await createIncome(request, tenant.pf, `${lastMonth}-15`, 50_000, 'Comissão desconsiderada');
  1159 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  1160 |   await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money', excludedIncomeIds: extraId });
  1161 |   await startOn(page, A.uid, tenant.pf.workspaceId);
  1162 |   await login(page, A.email);
  1163 |   await expect(balanceCard(page)).toBeVisible({ timeout: 20_000 });
  1164 |   // Desde já, toda prévia da hora que aparecer na página é registrada.
  1165 |   await page.evaluate(() => {
  1166 |     const state = window as unknown as { __p5fHourly: string[] };
  1167 |     state.__p5fHourly = [];
  1168 |     const read = () => {
  1169 |       const text = document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim() ?? '';
  1170 |       if (text && state.__p5fHourly[state.__p5fHourly.length - 1] !== text) state.__p5fHourly.push(text);
  1171 |     };
  1172 |     new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  1173 |   });
  1174 | 
  1175 |   // Nesta aba: Receitas do último mês completo, anular a receita desconsiderada.
  1176 |   await page.getByRole('button', { name: 'Mês anterior' }).click();
  1177 |   await page.getByRole('button', { name: /^Receitas\s+R\$/ }).click();
  1178 |   const row = page.locator('tr').filter({ hasText: 'Comissão desconsiderada' });
  1179 |   await row.getByRole('button', { name: 'Deletar' }).click();
  1180 |   const voidDialog = page.getByRole('dialog').filter({ hasText: 'Anular lançamento' });
  1181 |   await voidDialog.getByLabel('Motivo da anulação').fill('Lançada por engano');
```