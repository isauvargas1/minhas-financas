import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import '../../src/index.css';
import NotificationsPanel from '../../src/components/NotificationsPanel.tsx';
import type { NotificationItem } from '../../src/modules/notifications/types.ts';

/*
 * P5-GATE-FINAL (PTBR-02 e PTBR-03) — página de teste com o NotificationsPanel real e o CSS real do app (Tailwind
 * do build, com as variáveis de tema que a página define). Só é empacotada por `e2e/a11y-keyboard-p5gate.spec.ts`.
 * O estado do painel vem da página (`__setPanel`), e cada chamada de retorno fica em `__calls`, na ordem.
 */
type PanelState = {
  status: 'loading' | 'error' | 'ready';
  hasMore: boolean;
  isLoadingMore: boolean;
  notifications: NotificationItem[];
};

type HarnessWindow = Window & {
  __setPanel?: (state: Partial<PanelState>) => void;
  __calls?: string[];
};

const harnessWindow = window as HarnessWindow;
harnessWindow.__calls = [];
const record = (call: string) => harnessWindow.__calls?.push(call);

const Harness = () => {
  const [state, setState] = useState<PanelState>({ status: 'ready', hasMore: false, isLoadingMore: false, notifications: [] });
  harnessWindow.__setPanel = (next) => flushSync(() => setState((current) => ({ ...current, ...next })));
  return (
    <div className="relative ml-[520px] mt-2 h-12 w-12">
      <NotificationsPanel
        notifications={state.notifications}
        status={state.status}
        errorMessage={state.status === 'error' ? 'Não foi possível carregar as notificações. Tente novamente.' : null}
        unreadChip={String(state.notifications.filter((item) => item.status === 'unread').length)}
        unreadChipLabel="não lidas"
        hasMore={state.hasMore}
        isLoadingMore={state.isLoadingMore}
        isMarking={false}
        canDelete
        isDeleting={false}
        onLoadMore={() => record('loadMore')}
        onRetry={() => record('retry')}
        onClose={() => record('close')}
        onMarkAllRead={() => record('markAllRead')}
        onMarkAsRead={(id) => record(`markAsRead:${id}`)}
        onArchive={(id) => record(`archive:${id}`)}
        onDeleteForMe={(id) => record(`deleteForMe:${id}`)}
        onNavigate={(route) => record(`navigate:${route}`)}
      />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Harness />);
