import React, { useState } from 'react';

import { DeleteIcon } from '../Icons.tsx';
import type { LocalHoliday } from '../../modules/work-time/calendar';
import { BRAZILIAN_UFS, type BrazilianUf } from '../../modules/work-time/contract';
import { addLocalHoliday, describeLocalHoliday, formatCivilDateBR, normalizeMunicipalityInput } from '../../modules/work-time/draft';
import {
  MOVABLE_OBSERVANCES,
  electionSundayDate,
  movableObservanceDate,
  nationalHolidaysOfYear,
} from '../../modules/work-time/holidays';
import { MAX_MUNICIPALITY_LENGTH, isMunicipality } from '../../modules/work-time/grammar';
import {
  Switch,
  cardClass,
  compactInputClass,
  errorTextClass,
  helpTextClass,
  labelClass,
  linkButtonClass,
  noticeClass,
  secondaryButtonClass,
} from './ui';

export interface HolidaysValue {
  uf: BrazilianUf | '';
  municipality: string;
  worksOnHolidays: boolean;
  localHolidays: readonly LocalHoliday[];
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/**
 * Feriados e localização (etapa C e Configurações). Automáticos são só os
 * feriados nacionais por lei federal; estaduais, municipais, pontos
 * facultativos e a Sexta-feira da Paixão entram só se a pessoa os incluir.
 */
const HolidaysEditor: React.FC<{
  idPrefix: string;
  value: HolidaysValue;
  onChange: (value: HolidaysValue) => void;
  year: number;
}> = ({ idPrefix, value, onChange, year }) => {
  const [mode, setMode] = useState<'date' | 'annual'>('date');
  const [date, setDate] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('1');
  const [helperYear, setHelperYear] = useState(String(year));
  const [message, setMessage] = useState<string | null>(null);

  const add = (holiday: LocalHoliday) => {
    const result = addLocalHoliday(value.localHolidays, holiday);
    if ('message' in result) {
      setMessage(result.message);
      return;
    }
    setMessage(null);
    onChange({ ...value, localHolidays: result.holidays });
  };

  const addTyped = () => {
    if (mode === 'date') add({ kind: 'date', date });
    else add({ kind: 'annual', month: Number(month), day: /^\d{1,2}$/.test(day.trim()) ? Number(day.trim()) : 0 });
  };

  const national = nationalHolidaysOfYear(year);
  const municipalityInvalid = value.municipality !== '' && !isMunicipality(value.municipality);
  const location = [value.municipality.trim(), value.uf].filter(Boolean).join(' – ');

  return (
    <div className="space-y-4">
      <div className={`${cardClass} min-w-0 space-y-4`}>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor={`${idPrefix}-uf`} className={labelClass}>Estado (UF)</label>
            <select id={`${idPrefix}-uf`} value={value.uf} className={compactInputClass}
              onChange={(event) => onChange({ ...value, uf: event.target.value as BrazilianUf | '' })}>
              <option value="">Prefiro não informar</option>
              {BRAZILIAN_UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${idPrefix}-municipality`} className={labelClass}>Município (opcional)</label>
            <input id={`${idPrefix}-municipality`} type="text" autoComplete="address-level2" maxLength={MAX_MUNICIPALITY_LENGTH}
              value={value.municipality} className={compactInputClass}
              aria-invalid={municipalityInvalid || undefined}
              aria-describedby={municipalityInvalid ? `${idPrefix}-municipality-error` : undefined}
              onChange={(event) => onChange({ ...value, municipality: normalizeMunicipalityInput(event.target.value) })} />
            {municipalityInvalid && (
              <p id={`${idPrefix}-municipality-error`} className={errorTextClass} role="alert">
                Use só letras, espaços, ponto, apóstrofo e hífen, começando por uma letra (até {MAX_MUNICIPALITY_LENGTH} caracteres).
              </p>
            )}
          </div>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p id={`${idPrefix}-holidays-label`} className="text-sm font-bold text-on-surface">Trabalho normalmente em feriados</p>
            <p id={`${idPrefix}-holidays-help`} className={helpTextClass}>
              Desligado, os feriados que caem num dia de trabalho saem das horas previstas. Feriado em dia de folga não muda nada.
            </p>
          </div>
          <Switch checked={value.worksOnHolidays} labelledBy={`${idPrefix}-holidays-label`} describedBy={`${idPrefix}-holidays-help`}
            onChange={(worksOnHolidays) => onChange({ ...value, worksOnHolidays })} testId={`${idPrefix}-works-on-holidays`} />
        </div>
        <p className={noticeClass} role="note" data-testid={`${idPrefix}-coverage`}>
          Cobertura do calendário: só os feriados nacionais entram automaticamente.
          {' '}Os feriados estaduais e municipais{location ? ` de ${location}` : ''} ainda não têm fonte oficial verificada no FênixGran.
          {' '}Inclua os da sua cidade abaixo. Pontos facultativos nunca entram sozinhos.
        </p>
      </div>

      <details className={`${cardClass} min-w-0`}>
        <summary className="cursor-pointer text-sm font-bold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary rounded">
          Feriados nacionais de {year} ({national.length})
        </summary>
        <ul className="mt-3 space-y-1 text-sm text-on-surface">
          {national.map((holiday) => (
            <li key={holiday.date} className="flex flex-wrap justify-between gap-x-3">
              <span>{formatCivilDateBR(holiday.date)} · {holiday.name}</span>
              <span className="text-xs text-muted">{holiday.law}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className={`${cardClass} min-w-0 space-y-3`}>
        <p className="text-sm font-bold text-on-surface">Feriados locais</p>
        <div role="radiogroup" aria-label="Tipo de feriado local" className="flex flex-wrap gap-4">
          {([['date', 'Data única'], ['annual', 'Todo ano']] as const).map(([kind, label]) => (
            <label key={kind} className="inline-flex cursor-pointer items-center gap-2 text-sm text-on-surface">
              <input type="radio" name={`${idPrefix}-local-kind`} checked={mode === kind} onChange={() => setMode(kind)}
                className="h-4 w-4 text-primary focus:ring-primary" />
              {label}
            </label>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          {mode === 'date' ? (
            <div className="min-w-[10rem] flex-1">
              <label htmlFor={`${idPrefix}-local-date`} className="mb-1 block text-xs text-muted">Data</label>
              <input id={`${idPrefix}-local-date`} type="date" min="2000-01-01" max="2099-12-31" value={date}
                onChange={(event) => setDate(event.target.value)} className={compactInputClass} />
            </div>
          ) : (
            <>
              <div className="w-20">
                <label htmlFor={`${idPrefix}-local-day`} className="mb-1 block text-xs text-muted">Dia</label>
                <input id={`${idPrefix}-local-day`} type="text" inputMode="numeric" value={day}
                  onChange={(event) => setDay(event.target.value)} className={compactInputClass} />
              </div>
              <div className="min-w-[8rem] flex-1">
                <label htmlFor={`${idPrefix}-local-month`} className="mb-1 block text-xs text-muted">Mês</label>
                <select id={`${idPrefix}-local-month`} value={month} onChange={(event) => setMonth(event.target.value)} className={compactInputClass}>
                  {MONTHS.map((name, index) => <option key={name} value={String(index + 1)}>{name}</option>)}
                </select>
              </div>
            </>
          )}
          <button type="button" className={`${secondaryButtonClass} text-sm`} onClick={addTyped}>Incluir feriado</button>
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="w-24">
            <label htmlFor={`${idPrefix}-helper-year`} className="mb-1 block text-xs text-muted">Ano</label>
            <input id={`${idPrefix}-helper-year`} type="text" inputMode="numeric" value={helperYear}
              onChange={(event) => setHelperYear(event.target.value)} className={compactInputClass} />
          </div>
          {MOVABLE_OBSERVANCES.map((observance) => (
            <button key={observance.id} type="button" title={observance.nature}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-on-surface hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              onClick={() => {
                const target = movableObservanceDate(observance.id, Number(helperYear));
                if (!target) {
                  setMessage('Informe um ano entre 2000 e 2099.');
                  return;
                }
                add({ kind: 'date', date: target });
              }}>
              + {observance.label}
            </button>
          ))}
          {(['first', 'second'] as const).map((round) => (
            <button key={round} type="button" title="Domingo de eleição (Constituição Federal, arts. 28, 29 e 77); o 2º turno só existe onde houver"
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-on-surface hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              onClick={() => {
                const target = electionSundayDate(round, Number(helperYear));
                if (!target) {
                  setMessage(Number(helperYear) === 2020
                    ? 'Em 2020, as eleições municipais foram adiadas para 15 e 29 de novembro (EC nº 107/2020): inclua essas datas como data única.'
                    : 'Eleições acontecem nos anos pares: informe um ano par entre 2000 e 2099.');
                  return;
                }
                add({ kind: 'date', date: target });
              }}>
              + Eleições ({round === 'first' ? '1º turno' : '2º turno'})
            </button>
          ))}
        </div>
        <p className={helpTextClass}>
          Carnaval e Corpus Christi são pontos facultativos; a Sexta-feira da Paixão é definida por lei municipal. Eleições: 1º turno no primeiro domingo de outubro e, onde houver, 2º turno no último. Inclua só se forem folga para você.
        </p>
        {message && <p className={errorTextClass} role="alert">{message}</p>}
        {value.localHolidays.length === 0 ? (
          <p className="text-sm text-muted">Nenhum feriado local incluído.</p>
        ) : (
          <ul className="space-y-1" aria-label="Feriados locais incluídos">
            {value.localHolidays.map((holiday) => (
              <li key={describeLocalHoliday(holiday)} className="flex items-center justify-between gap-3 text-sm text-on-surface">
                <span>{describeLocalHoliday(holiday)}</span>
                <button type="button" className={`${linkButtonClass} inline-flex items-center gap-1`}
                  aria-label={`Remover feriado local ${describeLocalHoliday(holiday)}`}
                  onClick={() => onChange({ ...value, localHolidays: value.localHolidays.filter((item) => item !== holiday) })}>
                  <DeleteIcon className="h-4 w-4" aria-hidden="true" /> Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default HolidaysEditor;
