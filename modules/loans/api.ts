
import { Loan, LoanMovement, LoanStatus } from './types.ts';

const KEY_LOANS = 'app_loans';
const KEY_MOVEMENTS = 'app_loan_movements';

const loadFromStorage = <T>(key: string, defaultValue: T): T => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
};

const saveToStorage = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify(data));
};

export const listLoans = async (profileId: string): Promise<Loan[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const all = loadFromStorage<Loan[]>(KEY_LOANS, []);
    return all.filter(l => l.profileId === profileId);
};

export const getLoan = async (id: string): Promise<Loan | undefined> => {
    const all = loadFromStorage<Loan[]>(KEY_LOANS, []);
    return all.find(l => l.id === id);
};

export const createLoan = async (loan: Loan): Promise<Loan> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    const all = loadFromStorage<Loan[]>(KEY_LOANS, []);
    saveToStorage(KEY_LOANS, [...all, loan]);
    return loan;
};

export const updateLoan = async (loan: Loan): Promise<Loan> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const all = loadFromStorage<Loan[]>(KEY_LOANS, []);
    const updated = all.map(l => l.id === loan.id ? loan : l);
    saveToStorage(KEY_LOANS, updated);
    return loan;
};

export const deleteLoan = async (id: string): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const all = loadFromStorage<Loan[]>(KEY_LOANS, []);
    saveToStorage(KEY_LOANS, all.filter(l => l.id !== id));
    
    // Also cleanup movements
    const movements = loadFromStorage<LoanMovement[]>(KEY_MOVEMENTS, []);
    saveToStorage(KEY_MOVEMENTS, movements.filter(m => m.loanId !== id));
};

export const listMovements = async (loanId: string): Promise<LoanMovement[]> => {
    const all = loadFromStorage<LoanMovement[]>(KEY_MOVEMENTS, []);
    return all.filter(m => m.loanId === loanId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const createMovement = async (movement: LoanMovement): Promise<LoanMovement> => {
    const all = loadFromStorage<LoanMovement[]>(KEY_MOVEMENTS, []);
    saveToStorage(KEY_MOVEMENTS, [...all, movement]);
    return movement;
};
