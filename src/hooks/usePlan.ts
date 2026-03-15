import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { PLANS } from '../constants/plans';

export const usePlan = () => {
  const { user } = useAuth();
  // Começa assumindo que é o plano Gratuito por segurança
  const [userPlan, setUserPlan] = useState(PLANS.FREE); 
  const [isLoadingPlan, setIsLoadingPlan] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsLoadingPlan(false);
      return;
    }

    // Fica "escutando" o documento do usuário no Firestore
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const planId = data.planId || 'free';
        
        // Procura o plano correspondente no seu constants/plans.ts
        const activePlan = Object.values(PLANS).find(p => p.id === planId) || PLANS.FREE;
        setUserPlan(activePlan as any);
      }
      setIsLoadingPlan(false);
    });

    return () => unsubscribe(); // Limpa a escuta quando sai da tela
  }, [user]);

  // Função auxiliar para verificar limites facilmente
  const checkLimit = (resource: keyof typeof PLANS.FREE.limits, currentValue: number) => {
    const limit = userPlan.limits[resource];
    return currentValue < limit;
  };

  return { userPlan, isLoadingPlan, checkLimit };
};