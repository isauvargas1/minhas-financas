import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';

export const useCheckout = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  const startCheckout = async (priceId: string) => {
    if (!user) {
      setError("Precisa de iniciar sessão para subscrever.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Adicionamos o returnUrl na tipagem
      const createCheckoutSession = httpsCallable<{ priceId: string, returnUrl: string }, { url: string }>(
        functions, 
        'createCheckoutSession'
      );

      // Passamos o URL atual da janela (window.location.origin)
      const response = await createCheckoutSession({ 
        priceId,
        returnUrl: window.location.origin
      });

      if (response.data && response.data.url) {
        window.location.assign(response.data.url);
      } else {
        throw new Error("Não foi possível gerar a ligação de pagamento.");
      }
    } catch (err: any) {
      console.error("Erro no checkout:", err);
      setError(err.message || "Ocorreu um erro ao processar o pagamento.");
    } finally {
      setIsLoading(false);
    }
  };

  return { startCheckout, isLoading, error };
};