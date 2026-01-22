
import React from 'react';

interface NotificationProps {
    message: string;
    isVisible: boolean;
}

const Notification: React.FC<NotificationProps> = ({ message, isVisible }) => {
    if (!isVisible) return null;

    return (
        <div className="fixed bottom-5 right-5 bg-green-600 dark:bg-green-700 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in-out">
            {message}
             <style>{`
                @keyframes fade-in-out {
                    0% { opacity: 0; transform: translateY(20px); }
                    10% { opacity: 1; transform: translateY(0); }
                    90% { opacity: 1; transform: translateY(0); }
                    100% { opacity: 0; transform: translateY(20px); }
                }
                .animate-fade-in-out {
                    animation: fade-in-out 3s ease-in-out forwards;
                }
            `}</style>
        </div>
    );
};

export default Notification;
