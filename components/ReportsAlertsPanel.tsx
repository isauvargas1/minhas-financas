
import React from 'react';
import { motion } from 'framer-motion';
import { useFinancialAlerts } from '../modules/reports/hooks.ts';
import { FinancialReportSnapshot, AlertSeverity } from '../modules/reports/types.ts';
import { WarningIcon, BellIcon, CheckIcon, CloseIcon, TrendingUpIcon } from './Icons.tsx';

interface ReportsAlertsPanelProps {
    snapshot: FinancialReportSnapshot;
}

const ReportsAlertsPanel: React.FC<ReportsAlertsPanelProps> = ({ snapshot }) => {
    const { alerts, markAsRead } = useFinancialAlerts(snapshot);
    const MotionDiv = motion.div as any;

    if (alerts.length === 0) {
        return (
            <MotionDiv 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-surface rounded-card border border-border p-6 text-center shadow-sm"
            >
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckIcon className="w-6 h-6" />
                </div>
                <h3 className="text-on-surface font-medium">Tudo certo por aqui!</h3>
                <p className="text-muted text-sm mt-1">Nenhum alerta financeiro encontrado para o período.</p>
            </MotionDiv>
        );
    }

    const getSeverityStyles = (severity: AlertSeverity) => {
        switch (severity) {
            case 'critical':
                return {
                    bg: 'bg-red-50 dark:bg-red-900/10',
                    border: 'border-red-100 dark:border-red-900/30',
                    hoverBorder: 'hover:border-red-200 dark:hover:border-red-800',
                    iconBg: 'bg-red-100 dark:bg-red-900/30',
                    iconColor: 'text-red-600 dark:text-red-400',
                    icon: <WarningIcon className="w-5 h-5" />
                };
            case 'warning':
                return {
                    bg: 'bg-yellow-50 dark:bg-yellow-900/10',
                    border: 'border-yellow-100 dark:border-yellow-900/30',
                    hoverBorder: 'hover:border-yellow-200 dark:hover:border-yellow-800',
                    iconBg: 'bg-yellow-100 dark:bg-yellow-900/30',
                    iconColor: 'text-yellow-600 dark:text-yellow-400',
                    icon: <WarningIcon className="w-5 h-5" />
                };
            case 'info':
            default:
                return {
                    bg: 'bg-blue-50 dark:bg-blue-900/10',
                    border: 'border-blue-100 dark:border-blue-900/30',
                    hoverBorder: 'hover:border-blue-200 dark:hover:border-blue-800',
                    iconBg: 'bg-blue-100 dark:bg-blue-900/30',
                    iconColor: 'text-blue-600 dark:text-blue-400',
                    icon: <TrendingUpIcon className="w-5 h-5" />
                };
        }
    };

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                <BellIcon className="w-5 h-5 text-primary" />
                Alertas e Insights
                <span className="text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded-full font-bold">
                    {alerts.length}
                </span>
            </h3>
            <div className="space-y-3">
                {alerts.map((alert, index) => {
                    const styles = getSeverityStyles(alert.severity);
                    return (
                        <MotionDiv 
                            key={alert.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className={`
                                relative p-4 rounded-xl border flex items-start gap-4 transition-all duration-200 
                                ${styles.bg} ${styles.border} ${styles.hoverBorder} hover:shadow-md group
                            `}
                        >
                            <div className={`p-2 rounded-lg flex-shrink-0 ${styles.iconBg} ${styles.iconColor} shadow-sm`}>
                                {styles.icon}
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <h4 className={`text-sm font-bold mb-1 ${styles.iconColor}`}>{alert.title}</h4>
                                    <button 
                                        onClick={() => markAsRead(alert.id)}
                                        className="p-1.5 -mt-2 -mr-2 text-muted/60 hover:text-on-surface hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                        title="Marcar como lido"
                                    >
                                        <CloseIcon className="w-4 h-4" />
                                    </button>
                                </div>
                                <p className="text-sm text-on-surface opacity-90 leading-relaxed">
                                    {alert.message}
                                </p>
                                <div className="flex justify-between items-center mt-3">
                                    <span className="text-xs text-muted/80">
                                        {new Date(alert.createdAt).toLocaleDateString('pt-BR')}
                                    </span>
                                </div>
                            </div>
                        </MotionDiv>
                    );
                })}
            </div>
        </div>
    );
};

export default ReportsAlertsPanel;
