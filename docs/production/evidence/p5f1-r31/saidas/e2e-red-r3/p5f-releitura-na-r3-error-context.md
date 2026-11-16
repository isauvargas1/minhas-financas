# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work-time-p5f.spec.ts >> releitura que falha: sem confirmar a receita nova, nada convertido e erro com "Tentar de novo"; com a projeção de volta à última leitura, a estimativa volta com o aviso
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
  976  |   // Edição em curso, ainda não salva: tirar o domingo.
  977  |   await page.getByRole('checkbox', { name: 'Domingo' }).first().uncheck();
  978  |   await expect(page.getByTestId('work-time-unsaved')).toBeVisible();
  979  |   // A pessoa liga o modo tempo pelo Header, sem sair de Configurações.
  980  |   await expect(timeToggle(page)).toHaveAttribute('aria-pressed', 'false');
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
  1034 | // convertido (o erro do relatório, com "Tentar de novo"); o aviso de leitura anterior continua, para o estado atual
  1035 | // confirmado pela escuta (a projeção de volta ao que a última leitura trouxe). As mesmas asserções de texto, de
  1036 | // ausência de detalhe interno e de recuperação seguem abaixo. Justificativa:
  1037 | // docs/production/evidence/p5f1-r31/testes-substituidos.md.
  1038 | test('releitura que falha: sem confirmar a receita nova, nada convertido e erro com "Tentar de novo"; com a projeção de volta à última leitura, a estimativa volta com o aviso', async ({ page, request }) => {
  1039 |   test.setTimeout(300_000);
  1040 |   const tenant = await seedTenant(request);
  1041 |   await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time' });
  1042 |   await startOn(page, A.uid, tenant.pf.workspaceId);
  1043 |   await login(page, A.email);
  1044 |   await openWorkTimeSettings(page);
  1045 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  1046 |   // Daqui em diante, cada estado da prévia (hora mostrada, erro, aviso de leitura anterior) é registrado com a hora do navegador.
  1047 |   await page.evaluate(() => {
  1048 |     const state = window as unknown as { __p5fPreview: { at: number; hourly: string; error: boolean; stale: boolean }[] };
  1049 |     state.__p5fPreview = [];
  1050 |     const read = () => {
  1051 |       const entry = {
  1052 |         at: Date.now(),
  1053 |         hourly: document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim() ?? '',
  1054 |         error: document.querySelector('[data-testid="work-time-preview-error"]') !== null,
  1055 |         stale: document.querySelector('[data-testid="work-time-preview-refresh-failed"]') !== null,
  1056 |       };
  1057 |       const last = state.__p5fPreview[state.__p5fPreview.length - 1];
  1058 |       if (!last || last.hourly !== entry.hourly || last.error !== entry.error || last.stale !== entry.stale) state.__p5fPreview.push(entry);
  1059 |     };
  1060 |     read();
  1061 |     new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  1062 |   });
  1063 |   // O relatório oficial passa a falhar; outra sessão lança uma receita retroativa na janela.
  1064 |   const failReport = (route: Route) => route.fulfill({
  1065 |     status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'internal failure' } }),
  1066 |   });
  1067 |   await page.route('**/getFinancialReport', failReport);
  1068 |   const lastMonth = habitualMonths()[2];
  1069 |   const officialBefore = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data()?.incomeCents as number;
  1070 |   const lateId = await createIncome(request, tenant.pf, `${lastMonth}-16`, 50_000, 'Retroativa sem releitura');
  1071 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  1072 |   // A releitura falha e a sincronização não confirma o estado atual: nenhuma hora, nem a anterior. O erro do
  1073 |   // relatório em pt-BR, sem detalhe interno, com "Tentar de novo"; no topo, os valores ficam em reais.
  1074 |   const failure = page.getByTestId('work-time-preview-error');
  1075 |   const stale = page.getByTestId('work-time-preview-refresh-failed');
> 1076 |   await expect(failure).toContainText('Não foi possível carregar o relatório. Tente novamente.', { timeout: 45_000 });
       |                         ^ Error: expect(locator).toContainText(expected) failed
  1077 |   await expect(failure).not.toContainText(/internal|INTERNAL/);
  1078 |   await expect(failure.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  1079 |   await expect(previewHourly(page)).toHaveCount(0);
  1080 |   await expect(stale).toHaveCount(0);
  1081 |   await expect(notice(page)).toContainText('Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações.');
  1082 |   await expect(converted(page)).toHaveCount(0);
  1083 |   // Outra sessão anula a receita nova: a projeção volta ao que a última leitura trouxe. A escuta confirma o estado
  1084 |   // atual, e a estimativa volta com o aviso imediato de que a releitura falhou, sem detalhe interno; o topo também.
  1085 |   const voidedAt = await page.evaluate(() => Date.now());
  1086 |   const lateDoc = (await db().doc(`workspaces/${tenant.pf.workspaceId}/transactions/${lateId}`).get()).data() ?? {};
  1087 |   const voided = await callCallable(request, tenant.pf.token, 'voidCashTransaction', {
  1088 |     workspaceId: tenant.pf.workspaceId, idempotencyKey: intentKey('p5f1-r31-void'), transactionId: lateId,
  1089 |     expectedUpdatedAt: versionOf(lateDoc), reason: 'Lançada por engano',
  1090 |   });
  1091 |   expect(voided.status, JSON.stringify(voided)).toBe(200);
  1092 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore });
  1093 |   await expect(stale).toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes agora. Ela usa a última leitura.', { timeout: 45_000 });
  1094 |   await expect(stale).not.toContainText(/internal|INTERNAL/);
  1095 |   await expect(previewHourly(page)).toHaveText(brl(2_500));
  1096 |   await expect(failure).toHaveCount(0);
  1097 |   await expect(notice(page)).toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações.');
  1098 |   // De volta o relatório, "Tentar de novo" relê: o aviso some e a hora continua a oficial.
  1099 |   await page.unroute('**/getFinancialReport', failReport);
  1100 |   await stale.getByRole('button', { name: 'Tentar de novo' }).click();
  1101 |   await expect(stale).toHaveCount(0, { timeout: 30_000 });
  1102 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  1103 |   await expect(notice(page)).not.toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes');
  1104 |   // Uma receita nova depois disso chega à estimativa: a sincronização confirma e a conversão volta normalmente.
  1105 |   await createIncome(request, tenant.pf, `${lastMonth}-17`, 50_000, 'Retroativa com releitura');
  1106 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  1107 |   const hourlyAfter = Number((2n * BigInt(tenant.incomeCents + 50_000) * 60n + BigInt(tenant.workMinutes)) / (2n * BigInt(tenant.workMinutes)));
  1108 |   await expect(previewHourly(page)).toHaveText(brl(hourlyAfter), { timeout: 45_000 });
  1109 |   await expect(failure).toHaveCount(0);
  1110 |   await expect(stale).toHaveCount(0);
  1111 |   // O registro: do primeiro erro até a anulação, nenhuma hora; o aviso de leitura anterior só com a hora oficial
  1112 |   // (R$ 25,00); a hora nova só sem aviso e sem erro.
  1113 |   const states = await page.evaluate(() => (window as unknown as { __p5fPreview: { at: number; hourly: string; error: boolean; stale: boolean }[] }).__p5fPreview);
  1114 |   await test.info().attach('previa-releitura-que-falha', { body: JSON.stringify(states, null, 2), contentType: 'application/json' });
  1115 |   const spaced = (text: string) => text.replace(/\s+/g, ' ');
  1116 |   const firstError = states.findIndex((entry) => entry.error);
  1117 |   expect(firstError, `o erro apareceu: ${JSON.stringify(states)}`).toBeGreaterThan(0);
  1118 |   const unconfirmed = states.slice(firstError).filter((entry) => entry.at < voidedAt);
  1119 |   expect(unconfirmed.filter((entry) => entry.hourly !== ''), `nenhuma hora sem confirmar a receita nova: ${JSON.stringify(states)}`).toEqual([]);
  1120 |   expect(states.filter((entry) => entry.stale && spaced(entry.hourly) !== spaced(brlText(2_500))), 'aviso só com a hora oficial').toEqual([]);
  1121 |   expect(states.filter((entry) => spaced(entry.hourly) === spaced(brlText(hourlyAfter)) && (entry.stale || entry.error)), 'hora nova sem aviso nem erro').toEqual([]);
  1122 |   expect(states.some((entry) => entry.stale), 'o aviso de leitura anterior apareceu').toBe(true);
  1123 | });
  1124 | 
  1125 | test('mutação nesta aba: anular em Receitas a receita desconsiderada não junta o item anulado com o total velho', async ({ page, request }) => {
  1126 |   test.setTimeout(240_000);
  1127 |   const tenant = await seedTenant(request);
  1128 |   // Preparo (outra sessão): uma receita de R$ 500,00 no último mês completo, desconsiderada.
  1129 |   const lastMonth = habitualMonths()[2];
  1130 |   const officialBefore = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data()?.incomeCents as number;
  1131 |   const extraId = await createIncome(request, tenant.pf, `${lastMonth}-15`, 50_000, 'Comissão desconsiderada');
  1132 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  1133 |   await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money', excludedIncomeIds: extraId });
  1134 |   await startOn(page, A.uid, tenant.pf.workspaceId);
  1135 |   await login(page, A.email);
  1136 |   await expect(balanceCard(page)).toBeVisible({ timeout: 20_000 });
  1137 |   // Desde já, toda prévia da hora que aparecer na página é registrada.
  1138 |   await page.evaluate(() => {
  1139 |     const state = window as unknown as { __p5fHourly: string[] };
  1140 |     state.__p5fHourly = [];
  1141 |     const read = () => {
  1142 |       const text = document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim() ?? '';
  1143 |       if (text && state.__p5fHourly[state.__p5fHourly.length - 1] !== text) state.__p5fHourly.push(text);
  1144 |     };
  1145 |     new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  1146 |   });
  1147 | 
  1148 |   // Nesta aba: Receitas do último mês completo, anular a receita desconsiderada.
  1149 |   await page.getByRole('button', { name: 'Mês anterior' }).click();
  1150 |   await page.getByRole('button', { name: /^Receitas\s+R\$/ }).click();
  1151 |   const row = page.locator('tr').filter({ hasText: 'Comissão desconsiderada' });
  1152 |   await row.getByRole('button', { name: 'Deletar' }).click();
  1153 |   const voidDialog = page.getByRole('dialog').filter({ hasText: 'Anular lançamento' });
  1154 |   await voidDialog.getByLabel('Motivo da anulação').fill('Lançada por engano');
  1155 |   await voidDialog.getByRole('button', { name: 'Confirmar anulação' }).click();
  1156 |   await expect(voidDialog).toBeHidden({ timeout: 30_000 });
  1157 |   await expect(row).toHaveCount(0);
  1158 |   expect((await db().doc(`workspaces/${tenant.pf.workspaceId}/transactions/${extraId}`).get()).get('voidedAt')).toBeTruthy();
  1159 | 
  1160 |   // Logo depois, a prévia: o total oficial ainda tem os R$ 500,00 (o gatilho da projeção é assíncrono),
  1161 |   // então a exclusão continua valendo até a base nova chegar. Nada de R$ 500,00 somados a mais.
  1162 |   await openWorkTimeSettings(page);
  1163 |   await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  1164 |   await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore });
  1165 |   // Depois da base nova: a receita anulada não muda mais a estimativa, e a renda é a oficial inteira.
  1166 |   await page.getByTestId('work-time-preview-details').click();
  1167 |   const details = page.getByRole('dialog', { name: 'Como este valor foi calculado?' });
  1168 |   await expect(details.getByTestId('work-time-note-exclusions_ignored')).toBeVisible({ timeout: 30_000 });
  1169 |   await expect(details).toContainText(`Total de receitas elegíveis: ${brlText(tenant.incomeCents)}.`, { timeout: 30_000 });
  1170 |   await expect(details.getByTestId('work-time-details-hourly')).toContainText(brl(2_500));
  1171 |   await details.getByRole('button', { name: 'Entendi' }).click();
  1172 |   await expect(previewHourly(page)).toHaveText(brl(2_500));
  1173 |   const seenHourly = await page.evaluate(() => (window as unknown as { __p5fHourly: string[] }).__p5fHourly);
  1174 |   expect(seenHourly.map((text) => text.replace(/\s+/g, ' ')), 'nenhum valor intermediário na prévia').toEqual([brlText(2_500).replace(/\s+/g, ' ')]);
  1175 |   expect(await storedPreference(A.uid), 'a sincronização não grava nada').toMatchObject({ excludedIncomeIds: extraId, displayMode: 'money' });
  1176 | });
```