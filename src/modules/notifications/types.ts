
export type NotificationType =
  | 'alertaFinanceiro'
  | 'meta'
  | 'cartaoCredito'
  | 'gastoRecorrente'
  | 'divisaoDespesas'
  | 'sistema'
  | 'outro';

export type NotificationStatus = 'unread' | 'read' | 'archived';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  status: NotificationStatus;
  // Route or action where the user should be taken
  actionRoute?: string;
  actionLabel?: string;
}
