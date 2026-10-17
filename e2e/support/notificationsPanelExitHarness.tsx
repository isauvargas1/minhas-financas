import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import NotificationsPanel from '../../src/components/NotificationsPanel.tsx';
import type { NotificationItem } from '../../src/modules/notifications/types.ts';

/*
 * P5-E1.1 — página de teste com o NotificationsPanel real (fora do app). Só é
 * empacotada por `e2e/notifications-exit-race.spec.ts`. A lista é controlada
 * pela página: `__removeNotice(id)` tira o aviso como o feed faria depois de
 * uma marca confirmada, num render síncrono.
 */
type HarnessWindow = Window & { __removeNotice?: (id: string) => void };

const notice = (id: string): NotificationItem => ({
  id,
  type: 'sistema',
  title: `Aviso ${id}`,
  message: `Mensagem do aviso ${id}.`,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  status: 'unread',
});

const noop = () => undefined;

const Harness = () => {
  const [ids, setIds] = useState(['a', 'b', 'c']);
  (window as HarnessWindow).__removeNotice = (id) =>
    flushSync(() => setIds((current) => current.filter((item) => item !== id)));
  return (
    <NotificationsPanel
      notifications={ids.map(notice)}
      status="ready"
      unreadChip={String(ids.length)}
      unreadChipLabel={`${ids.length} não lidas`}
      hasMore={false}
      isLoadingMore={false}
      isMarking={false}
      canDelete
      isDeleting={false}
      onLoadMore={noop}
      onRetry={noop}
      onClose={noop}
      onMarkAllRead={noop}
      onMarkAsRead={noop}
      onArchive={noop}
      onDeleteForMe={noop}
    />
  );
};

createRoot(document.getElementById('root')!).render(<Harness />);
