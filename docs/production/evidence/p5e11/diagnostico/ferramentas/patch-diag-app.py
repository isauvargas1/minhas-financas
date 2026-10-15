"""Instrumenta, SÓ na cópia de diagnóstico, o app (roteador do clique, feed, ações e
animações das linhas do painel). Nada muda no comportamento: só registra em window.__diag
(criado pelo spec instrumentado)."""
import sys
root = sys.argv[1]

def patch(path, pairs):
    p = f'{root}/{path}'
    s = open(p).read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, s.count(old), old[:80])
        s = s.replace(old, new)
    open(p, 'w').write(s)

DIAG = "const __diagPush = (s: string): void => { (globalThis as unknown as { __diag?: string[] }).__diag?.push(`${Date.now()} P ${s}`); };\n"

patch('src/lib/pressOrigin.ts', [
    ("import { useEffect } from 'react';\n", "import { useEffect } from 'react';\n" + DIAG),
    ("      applyGestureClickRoute(event, routeGestureClick(origin, event));\n",
     "      const route = routeGestureClick(origin, event);\n"
     "      __diagPush(`ROUTE ${route.action} d=${event.detail} pid=${String(event.pointerId)} originPid=${String(origin?.pointerId)} originType=${String(origin?.pointerType)} dt=${origin ? Math.round(event.timeStamp - origin.timeStamp) : -1}`);\n"
     "      applyGestureClickRoute(event, route);\n"),
])

SUMMARY = (
    "const __flags = (item: UserNotification): string => `${item.id.replace(/^f_/, '')}${item.read ? 'r' : ''}${item.dismissed ? 'd' : ''}${item.deleted ? 'x' : ''}`;\n"
    "const __summary = (data: unknown): string => {\n"
    "  const d = data as NotificationData | undefined;\n"
    "  if (!d) return 'undefined';\n"
    "  return d.pages.map((page, index) => `p${index}[${page.items.map(__flags).join(' ')}]`).join(' ');\n"
    "};\n"
)

patch('src/modules/notifications/feed.ts', [
    ("const NO_SCOPE_KEY = ['notifications', 'sem-escopo'] as const;\n",
     DIAG + SUMMARY + "const NO_SCOPE_KEY = ['notifications', 'sem-escopo'] as const;\n"),
    ("const shareNotificationData = (previous: unknown, next: unknown): unknown =>\n"
     "  replaceEqualDeep(\n"
     "    previous,\n"
     "    keepConfirmedNotificationMarks(previous as NotificationData | undefined, next as NotificationData),\n"
     "  );\n",
     "const shareNotificationData = (previous: unknown, next: unknown): unknown => {\n"
     "  const kept = keepConfirmedNotificationMarks(previous as NotificationData | undefined, next as NotificationData);\n"
     "  __diagPush(`SHARE prev=${__summary(previous)} | next=${__summary(next)} | kept=${kept === next ? 'same' : __summary(kept)}`);\n"
     "  return replaceEqualDeep(previous, kept);\n"
     "};\n"),
    ("      if (!scope) throw new Error('Notificações sem escopo.');\n      return api.listPage(scope, pageParam);\n",
     "      if (!scope) throw new Error('Notificações sem escopo.');\n"
     "      const __id = Math.random().toString(36).slice(2, 6);\n"
     "      __diagPush(`LIST start#${__id} cursor=${pageParam ? pageParam.id : 'null'}`);\n"
     "      return api.listPage(scope, pageParam).then((page) => { __diagPush(`LIST done#${__id} [${page.items.map(__flags).join(' ')}]`); return page; },\n"
     "        (error: unknown) => { __diagPush(`LIST err#${__id} ${String((error as { code?: unknown } | null)?.code ?? error)}`); throw error; });\n"),
    ("  const visible = useMemo(() => visibleNotifications(data, nowMs), [data, nowMs]);\n",
     "  const visible = useMemo(() => visibleNotifications(data, nowMs), [data, nowMs]);\n"
     "  useEffect(() => { __diagPush(`FEED data=${__summary(data)} visible=${visible.map((item) => item.id.replace(/^f_/, '')).join(',')} fetch=${result.fetchStatus}`); }, [data, visible]);\n"),
    ("    mutationFn: run,\n",
     "    mutationFn: async (variables: MarkVariables) => {\n"
     "      __diagPush(`MUT start ${JSON.stringify(patch)} ${variables.ids.join(',')}`);\n"
     "      try { const marked = await run(variables); __diagPush(`MUT ok ${JSON.stringify(patch)} marked=${marked.join(',')}`); return marked; }\n"
     "      catch (error) { __diagPush(`MUT err ${JSON.stringify(patch)} ${String((error as { code?: unknown } | null)?.code ?? error)}`); throw error; }\n"
     "    },\n"),
    ("        (data) => applyNotificationState(data, marked, patch),\n      );\n",
     "        (data) => applyNotificationState(data, marked, patch),\n      );\n"
     "      __diagPush(`MUT applied ${JSON.stringify(patch)} cache=${__summary(queryClient.getQueryData(notificationKeys.scope(scope)))}`);\n"),
    ("    onSettled: (_marked, _error, { scope }) => {\n",
     "    onSettled: (_marked, _error, { scope }) => {\n      __diagPush(`MUT settled ${JSON.stringify(patch)} error=${String(_error ?? '-')}`);\n"),
])

patch('src/components/NotificationsPanel.tsx', [
    ("const MotionDiv = motion.div as",
     DIAG + "const MotionDiv = motion.div as"),
    ("                                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}\n                                {...pressTargetProps}\n",
     "                                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}\n"
     "                                onAnimationStart={(definition: unknown) => __diagPush(`ANIM start ${notif.id} ${JSON.stringify(definition)}`)}\n"
     "                                onAnimationComplete={(definition: unknown) => __diagPush(`ANIM done ${notif.id} ${JSON.stringify(definition)}`)}\n"
     "                                {...pressTargetProps}\n"),
    ("                    <AnimatePresence initial={false}>\n",
     "                    <AnimatePresence initial={false} onExitComplete={() => __diagPush('ANIM exitComplete (AnimatePresence)')}>\n"),
])
print('app instrumentado')
