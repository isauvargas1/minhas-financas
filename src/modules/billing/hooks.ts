import { useAuth } from '../../contexts/AuthContext';
import { PLANS } from '../../constants/plans';

export const useSubscription = () => {
  const { user } = useAuth();
  
  // No futuro, isso virá do Firestore /users/{uid}/subscription
  const userPlanId = user?.planId || 'free'; 
  const currentPlan = PLANS[userPlanId.toUpperCase() as keyof typeof PLANS] || PLANS.FREE;

  const checkLimit = (feature: keyof typeof currentPlan.limits, currentCount: number) => {
    return currentCount < currentPlan.limits[feature];
  };

  return {
    plan: currentPlan,
    checkLimit,
    isPro: userPlanId === 'pro' || userPlanId === 'business',
    isAdmin: user?.isAdmin || false // Para o ambiente do dono
  };
};