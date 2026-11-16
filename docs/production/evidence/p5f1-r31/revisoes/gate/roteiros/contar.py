import re, sys
ansi = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
phase = 'antes'
tot = {}
lint = []
pw = []
scripts = []
for raw in open(sys.argv[1], encoding='utf-8', errors='replace'):
    line = ansi.sub('', raw.rstrip('\n'))
    m = re.match(r'^> \S+@\S+ (\S+)', line)
    if m:
        s = m.group(1)
        scripts.append(s)
        if s == 'verify:fast': phase = 'verify:fast'
        elif s == 'test:integration:emulator': phase = 'integracao'
        elif s == 'test:e2e': phase = 'e2e'
        continue
    m = re.match(r'^(?:#\s*)?# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', line.strip())
    if m:
        d = tot.setdefault(phase, {})
        d[m.group(1)] = d.get(m.group(1), 0) + int(m.group(2))
    m = re.search(r'✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)', line)
    if m: lint.append(m.groups())
    m = re.match(r'^\s+(\d+) (passed|failed|flaky|skipped|did not run|interrupted)', line)
    if m and phase == 'e2e': pw.append(f'{m.group(1)} {m.group(2)}')
for k, v in tot.items(): print(k, v)
print('lint', lint, '| playwright', pw, '| scripts npm', len(scripts))
