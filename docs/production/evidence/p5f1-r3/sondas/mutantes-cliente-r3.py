#!/usr/bin/env python3
"""P5-F.1-R3: mutantes do cliente (prova pelas marcas, regra 5, gancho da estimativa, leitura por id) e da correção do
RR-R2A-04 (releitura do Dashboard). Roda numa cópia da árvore: aplica um mutante por vez (a troca tem de casar uma
vez só), roda os testes de unidade, restaura o arquivo e confere que voltou byte a byte. Uso: <dir da cópia>."""
import subprocess, sys, os, hashlib
D = sys.argv[1]
TESTS = ['tests/unit/work-time-projection-proof.test.ts', 'tests/unit/work-time-consistency.test.ts',
         'tests/unit/work-time-income-estimate.test.ts', 'tests/unit/work-time-estimate.test.ts',
         'tests/unit/work-time-guard.test.ts', 'tests/unit/report-live-refresh.test.ts',
         'tests/unit/report-live-refresh-freshness.test.ts', 'tests/unit/report-basis-sync.test.ts']
PP = 'src/modules/work-time/projectionProof.ts'
CO = 'src/modules/work-time/consistency.ts'
HK = 'src/modules/work-time/useIncomeEstimateWith.ts'
RR = 'src/modules/work-time/receivableReversal.ts'
QK = 'src/modules/reports/queryKeys.ts'
M = [
 ('P01 mês sem etiqueta aceito', PP, "    if (seen.generation === null) return { proven: false, reason: 'generation' };\n", ''),
 ('P02 gerações diferentes aceitas', PP, "    else if (!sameGeneration(generation, seen.generation)) return { proven: false, reason: 'generation' };\n", ''),
 ('P03 bases sem conferência com os meses', PP, "    if ((input.basisIncome[month] ?? 0) !== (seen?.exists ? seen.incomeCents : 0)) return { proven: false, reason: 'bases' };\n", ''),
 ('P04 marca quebrada vale como nada', PP, "  if (view.kind === 'broken') return 'mark_broken';", "  if (view.kind === 'broken') return { document: null };"),
 ('P05 pendência ignorada', PP, "  if (view.pending > 0) return 'mark_pending';\n", ''),
 ('P06 impressão não comparada', PP, "found.fingerprint !== view.node.fp", "false"),
 ('P07 estorno sem recebimento aceito', PP, "      if (reversal !== null && own.document === null) return { proven: false, reason: 'content' };\n", ''),
 ('P08 âncora depois de raiz absent aceita', PP, "    if (chain.root === 'absent') return { kind: 'broken', code: 'anchor_after_absent' };\n", ''),
 ('P09 geração mais nova na posição ignorada', PP, "    if (others.some((part) => newer(part?.cut ?? null, generation.cutoff))) return { kind: 'broken', code: 'superseded' };\n", ''),
 ('P10 raiz event sem âncora aceita', PP, "  if (chain.root !== 'absent' || chain.node === null) return { kind: 'broken', code: 'base_without_anchor' };", "  if (chain.node === null) return { kind: 'broken', code: 'base_without_anchor' };"),
 ('P11 criação casa com qualquer nó', PP, "before.k === 'none' ? node.k === 'absent' || node.k === 'deleted' :", "before.k === 'none' ? true :"),
 ('P12 chaves do mapa sem ordenar', PP, "Object.keys(record).sort().map(", "Object.keys(record).map("),
 ('P13 Timestamp sem nanossegundos', PP, "return { $t: [value.seconds, value.nanoseconds] };", "return { $t: [value.seconds, 0] };"),
 ('P14 posições diferentes aceitas', PP, "  if (anchorSlot !== undefined && chainSlot !== undefined && anchorSlot !== chainSlot) return { kind: 'broken', code: 'slot_mismatch' };\n", ''),
 ('P15 absorção ignora o conteúdo', PP, "    const index = remaining.findIndex((item) => matches(current, item.b));", "    const index = remaining.length > 0 ? 0 : -1;"),
 ('P16 nó ausente com o lido presente prova (A02)', PP, "  if (view.node.k !== 'alive') return read[id] ? 'content' : { document: null };", "  if (view.node.k !== 'alive') return { document: null };"),
 ('C01 regra 5 ignorada', CO, "  if (!input.exclusionsProof.proven) return { proven: false, reason: 'projection_marks' };\n", ''),
 ('C02 prova ausente vale como provada', CO, "  if (started === null || input.exclusionsProof === null) return { proven: false, reason: 'loading' };", "  if (started === null) return { proven: false, reason: 'loading' };\n  if (input.exclusionsProof === null) return { proven: true };"),
 ('H01 itens das leituras mesmo provado', HK, "    if (needsExcluded && excluded.data && exclusionsProof?.proven) {", "    if (false) {"),
 ('H02 leitura de outra janela aceita', HK, "read.window !== windowMonths.join(',')", "false"),
 ('H03 marcas dos estornos não lidas', HK, "[...new Set([...ids, ...Object.values(read.reversalIds)])]", "[...ids]"),
 ('H04 sem estimativa em atualização', HK, "  if (waitingProof && waitedTooLong) return { status: 'error', message: ESTIMATE_UPDATING, retry };\n", ''),
 ('H05 sem releitura por motivo passageiro', HK, "(unprovenReason === 'exclusions_read' || marksTransient)", "unprovenReason === 'exclusions_read'"),
 ('R01 impressão do normalizado, não do bruto', RR, "raw === undefined ? null : await transactionFingerprint(raw as Record<string, unknown>)", "await transactionFingerprint(document as Record<string, unknown>)"),
 ('Q01 releitura cancela sempre (comportamento antigo)', QK, "): boolean => !(query.fetching && query.fetchStartedOrder !== null && query.fetchStartedOrder > changeOrder);", "): boolean => true;"),
 ('Q02 começo igual à mudança conta como depois', QK, "query.fetchStartedOrder > changeOrder", "query.fetchStartedOrder >= changeOrder"),
 ('Q03 primeira leitura sem releitura depois', QK, "return firstRead ? refetch().then(refetch, refetch) : refetch();", "return refetch();"),
 ('Q04 começo da leitura não anotado', QK, "    reportFetchStarts.set(queryHash, nextFinancialReportOrder());", "    nextFinancialReportOrder();"),
 ('Q05 leitura em curso nunca relida', QK, "): boolean => !(query.fetching && query.fetchStartedOrder !== null && query.fetchStartedOrder > changeOrder);", "): boolean => !query.fetching;"),
]
def run():
    p = subprocess.run(['node', '--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--test', *TESTS],
                       cwd=D, capture_output=True, text=True, timeout=1800)
    fails = [l for l in p.stdout.splitlines() if l.startswith('not ok') or l.startswith('    not ok')]
    return p.returncode, fails
code, fails = run()
print(f'base: saída {code}, {len(fails)} falha(s)', flush=True)
if code != 0:
    print('\n'.join(fails[:10])); sys.exit(2)
dead = 0
for name, path, a, b in M:
    full = os.path.join(D, path); orig = open(full).read(); h = hashlib.sha256(orig.encode()).hexdigest()
    if orig.count(a) != 1:
        print(f'NÃO APLICOU ({orig.count(a)}) {name}', flush=True); continue
    open(full, 'w').write(orig.replace(a, b))
    try:
        code, fails = run()
    finally:
        open(full, 'w').write(orig)
    assert hashlib.sha256(open(full).read().encode()).hexdigest() == h
    status = 'MORTO' if code != 0 else 'SOBREVIVEU'
    dead += code != 0
    print(f'{status:10s} {name} ({len(fails)} falha(s); ex.: {fails[0][:110] if fails else "-"})', flush=True)
print(f'total: {dead}/{len(M)} mortos')
