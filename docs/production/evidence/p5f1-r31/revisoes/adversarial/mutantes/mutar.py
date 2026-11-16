import sys, pathlib
base = pathlib.Path(sys.argv[1])
name = sys.argv[2]
hook = base / 'src/modules/work-time/useIncomeEstimateWith.ts'
src = hook.read_text(encoding='utf-8')
HOLD = "): IncomeEstimateState => (state.status === 'done' && (!proven || settling) ? unproven : state);"
TIMER = "if (waitingProof && waitedTooLong) return { status: 'error', message: ESTIMATE_UPDATING, retry };"
WAIT = "const waitingProof = current.status === 'done' && shown.status === 'loading';"
SHOWN = "const shown = holdEstimate(proof.proven, holding, current, unproven);"
RET = "  return shown;\n};"
muts = {
  'M1-ignora-sincronizacao': [(HOLD, "): IncomeEstimateState => (state.status === 'done' && !proven ? unproven : state);")],
  'M2-ignora-prova': [(HOLD, "): IncomeEstimateState => (state.status === 'done' && settling ? unproven : state);")],
  'M3-prazo-aprova': [(TIMER, "if (waitingProof && waitedTooLong) return current;")],
  'M4-espera-so-sem-prova': [(WAIT, "const waitingProof = !proof.proven && current.status === 'done' && shown.status === 'loading';")],
  'M5-retencao-sem-identidade': [
    (SHOWN, SHOWN + "\n  const lastShownAny = useRef<any>(null);\n  if (shown.status === 'done') lastShownAny.current = shown;"),
    (RET, "  if (shown.status !== 'done' && lastShownAny.current !== null && params.workspaceId === lastShownAny.current.__ws) return lastShownAny.current;\n  if (shown.status === 'done') lastShownAny.current = { ...shown, __ws: params.workspaceId };\n  return shown;\n};"),
  ],
  'M6-retencao-com-aviso': [
    (SHOWN, SHOWN + "\n  const keep = useRef<any>(null);"),
    (RET, "  if (shown.status === 'done') { keep.current = { s: shown, ws: params.workspaceId, ex: params.excludedIds.join(',') }; return shown; }\n  if (keep.current && keep.current.ws === params.workspaceId && keep.current.ex === params.excludedIds.join(',')) return { ...keep.current.s, refreshFailed: true, retry };\n  return shown;\n};"),
  ],
  'M7-atual-sem-prova-com-aviso': [(HOLD, "): IncomeEstimateState => (state.status === 'done' && (!proven || settling) ? { ...state, refreshFailed: true } : state);")],
  'M8-espera-nao-zera': [("      waitingSince.current = null;\n      setWaitedTooLong(false);\n      return undefined;", "      waitingSince.current = null;\n      return undefined;")],
}
for old, new in muts[name]:
    if src.count(old) != 1:
        print(f'ERRO {name}: trecho encontrado {src.count(old)} vezes: {old[:60]!r}'); sys.exit(2)
    src = src.replace(old, new)
hook.write_text(src, encoding='utf-8')
print(f'mutante {name} aplicado')
