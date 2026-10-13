import sys, re, glob, os
# Para cada execução: atraso entre o último "exitComplete" antes do início da saída de f_04 e esse início,
# e se a execução passou. Mostra que as falhas caem na janela logo após um exitComplete.
rows = []
for f in sorted(glob.glob(sys.argv[1] + '/*.log')):
    status = 'FAIL' if os.path.basename(f).startswith('FAIL') else 'PASS'
    last_complete = None; gap = None
    for l in open(f):
        m = re.match(r'^(\d+) P (.*)$', l.strip())
        if not m: continue
        t, rest = int(m.group(1)), m.group(2)
        if rest.startswith('ANIM exitComplete'): last_complete = t
        if rest.startswith('ANIM start f_04 {"opacity":0'):
            gap = t - last_complete if last_complete else None
            break
    rows.append((status, gap, os.path.basename(f)[:32]))
for status in ('FAIL', 'PASS'):
    gaps = sorted(g for s, g, _ in rows if s == status and g is not None)
    print(status, len([r for r in rows if r[0] == status]), 'atrasos (ms) do início da saída de f_04 após o último exitComplete:', gaps)
