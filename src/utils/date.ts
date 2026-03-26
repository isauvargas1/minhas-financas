import { Timestamp } from 'firebase/firestore';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const toDateOnlyString = (value: unknown): string => {
  if (!value) return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (DATE_ONLY_REGEX.test(trimmed)) {
      return trimmed;
    }

    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    return '';
  }

  if (value instanceof Timestamp) {
    return value.toDate().toISOString().split('T')[0];
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }

  return '';
};

export const parseDateInputAsLocalDate = (value: unknown): Date => {
  const dateOnly = toDateOnlyString(value);

  if (dateOnly) {
    const [year, month, day] = dateOnly.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  if (value instanceof Date) {
    return value;
  }

  return new Date(String(value ?? ''));
};

export const formatDateBR = (value: unknown): string => {
  const parsed = parseDateInputAsLocalDate(value);

  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }

  return parsed.toLocaleDateString('pt-BR');
};

export const isSameMonthYear = (value: unknown, referenceDate: Date): boolean => {
  const parsed = parseDateInputAsLocalDate(value);

  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return (
    parsed.getMonth() === referenceDate.getMonth() &&
    parsed.getFullYear() === referenceDate.getFullYear()
  );
};

export const toFirestoreDateTimestamp = (value: unknown): Timestamp | undefined => {
  const dateOnly = toDateOnlyString(value);

  if (!dateOnly) {
    return undefined;
  }

  return Timestamp.fromDate(new Date(`${dateOnly}T12:00:00.000Z`));
};