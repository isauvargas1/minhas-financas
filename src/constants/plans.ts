export const PLANS = {
  FREE: {
    id: 'free',
    name: 'Gratuito',
    limits: {
      workspaces: 1,
      members: 2,
      transactionsMonth: 50,
      splitGroups: 2
    }
  },
  PRO: {
    id: 'pro',
    name: 'Pro',
    priceId: 'price_XXXXXX', // ID do Stripe
    limits: {
      workspaces: 5,
      members: 10,
      transactionsMonth: 1000,
      splitGroups: 10
    }
  },
  BUSINESS: {
    id: 'business',
    name: 'Business',
    priceId: 'price_YYYYYY', // ID do Stripe
    limits: {
      workspaces: 999, // Ilimitado
      members: 999,
      transactionsMonth: 99999,
      splitGroups: 999
    }
  }
};