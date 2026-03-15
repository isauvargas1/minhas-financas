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
    priceId: 'price_1TAyyCJvdLQmRJDshibLb4QF', // COLOQUE O ID REAL AQUI
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
    priceId: 'price_1TAyyCJvdLQmRJDshibLb4QF', // COLOQUE O ID REAL AQUI
    limits: {
      workspaces: 999,
      members: 999,
      transactionsMonth: 99999,
      splitGroups: 999
    }
  }
};