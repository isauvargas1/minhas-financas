# P5-F.1 — Matriz de cálculos e exemplos

Fórmula (`src/modules/work-time/estimate.ts` + `calculation.ts`, inteiros):

```
valor da hora (centavos) = round(Σ renda elegível × 60 ÷ Σ minutos previstos)      (meio centavo para cima)
minutos de um valor      = round(|centavos| × Σ minutos ÷ Σ renda)                 (BigInt; meio minuto para longe de zero)
```

As somas são dos mesmos meses: não é média de valores por hora. Renda em centavos inteiros, horas em minutos inteiros. Limites da janela: renda de R$ 1,00 a R$ 1,2 bilhão (12 × R$ 100 mi), minutos de 60 a 535.680 (12 × 744 h), hora de pelo menos R$ 0,01.

## Modos

| Modo | Meses | Renda | Horas | Estado |
| --- | --- | --- | --- | --- |
| Habitual (padrão, 3 meses) | os 3 meses completos anteriores ao mês da data de referência do servidor | Σ `receiptsCents` oficiais − exclusões do usuário | Σ minutos previstos dos mesmos meses | provisória se, depois de tirar os meses iniciais sem renda, sobrar menos que o pedido |
| Habitual 1, 6 ou 12 meses | idem, com N meses (o 12º vem do bloco `cash` de um mês) | idem | idem | idem |
| Mês atual | o mês corrente | receitas efetivadas até a data de referência | minutos previstos do mês inteiro | sempre marcada "mês incompleto"; receita futura não entra |

Indisponível (valores ficam em reais, com o motivo): fonte PJ sem confirmação; relatório oficial não exato; nenhuma renda na janela (ou total ≤ 0); nenhuma hora; renda abaixo de R$ 1,00 ou acima do teto; hora abaixo de R$ 0,01. Nada é inventado.

## Exemplos verificados nos testes

| Caso | Renda | Horas | Hora | Conversão | Teste |
| --- | --- | --- | --- | --- | --- |
| Referência da P5-F | R$ 3.520,00 | 176 h | R$ 20,00 | R$ 482,35 → ≈ 24 h 7 min | `work-time-calculation.test.ts` |
| Habitual 3 meses, agosto a outubro/2026, segunda a sexta 8 h | R$ 10.560,00 (3 × R$ 3.520,00) | 504 h (168 + 168 + 168: 07/09 e 12/10 são segundas) | round(1.056.000 × 60 ÷ 30.240) = R$ 20,95 | — | `work-time-estimate.test.ts` |
| Mês atual, novembro/2026 até 04/11 | R$ 1.000,00 | 152 h (mês inteiro) | R$ 6,58 | sempre "mês incompleto" | idem |
| Exclusão de R$ 520,00 em outubro | R$ 10.040,00 | 504 h | — | o mês guarda o oficial (R$ 3.520,00) e o elegível (R$ 3.000,00) | idem |
| Só outubro com renda (agosto e setembro zerados) | R$ 3.520,00 | 168 h (só outubro) | — | provisória: 1 de 3 meses | idem |
| E2E: 8 h todos os dias, trabalho em feriados, salário = dias × 8 × R$ 25,00 | dias × R$ 200,00 | dias × 8 h | **R$ 25,00** | saldo R$ 352,00 → ≈ 14 h 5 min (844,8 min) | `e2e/work-time-p5f.spec.ts` |
| E2E: sem o domingo | a mesma | − 8 h por domingo | sobe | prévia antes de salvar | idem |
| E2E: mês atual, R$ 1.000,00 + R$ 1.000,00 lançados por outra sessão | 100.000 → 200.000 centavos | mês inteiro | dobra | atualiza sem recarregar | idem |
| E2E: receita retroativa de R$ 500,00 no último mês completo do PF, com o PJ ativo, lançada por outra sessão | dias × R$ 200,00 + R$ 500,00 | dias × 8 h | R$ 25,00 → **R$ 25,68** | a prévia muda sem recarregar (escuta das projeções da janela) | idem |

## Horas por mês (motor de calendário)

Ver `calendario-feriados.md`: fevereiro/2026 = 160 h, novembro/2026 = 152 h (19 dias úteis), julho/2026 com férias e exceções = 93 h; 12×36 em janeiro/2026 = 176 h; noturno + manhã com sobreposição descontada uma vez; rotina repetida ou contida em outra sem intervalo em dobro (o dia vale pelo menos a maior janela sozinha).

## Arredondamento determinístico

- Minutos: inteiro mais próximo do quociente exato; meio minuto para longe de zero; negativo espelha o positivo; diferente de zero que arredonda a 0 vira "menos de 1 minuto" (propriedade testada com gerador determinístico).
- Hora: inteiro mais próximo em centavos, meio para cima.
- Nada em ponto flutuante: BigInt nos produtos, centavos e minutos inteiros nas somas.
