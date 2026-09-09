// Todos os cálculos de "semana" seguem o horário de Brasília (UTC-3, fixo,
// sem horário de verão desde 2019) e a janela operacional pedida:
// segunda 00:00 até o fim do dia de sábado (segunda a sábado, dias cheios).

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

function toLocalShifted(d: Date): Date {
  return new Date(d.getTime() - SP_OFFSET_MS);
}

function toUtc(localShifted: Date): Date {
  return new Date(localShifted.getTime() + SP_OFFSET_MS);
}

export type WeekRange = {
  /** Data (YYYY-MM-DD) da segunda-feira, em horário de Brasília */
  mondayDate: string;
  /** Data (YYYY-MM-DD) do sábado, em horário de Brasília — usar como dateTo em chamadas à API */
  saturdayDate: string;
  label: string;
  /** Início real da janela (segunda 00:00 BRT), em UTC */
  start: Date;
  /** Fim real da janela (domingo 00:00 BRT, exclusivo — ou seja, sábado inteiro), em UTC */
  end: Date;
};

function mondayLocalFromLocalShifted(localShifted: Date): Date {
  const y = localShifted.getUTCFullYear();
  const m = localShifted.getUTCMonth();
  const d = localShifted.getUTCDate();
  const dow = localShifted.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (dow + 6) % 7;
  return new Date(Date.UTC(y, m, d - diffToMonday, 0, 0, 0));
}

function isoWeekNumber(mondayLocal: Date): number {
  // mondayLocal já é a segunda-feira da semana; usamos a quinta-feira dessa
  // semana (padrão ISO-8601) para achar o número da semana no ano.
  const thursday = new Date(mondayLocal.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const diffDays = Math.floor((thursday.getTime() - yearStart.getTime()) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

function dateStr(localDate: Date): string {
  const y = localDate.getUTCFullYear();
  const m = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(localDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Dada a data (qualquer instante) da segunda-feira em horário local, monta a janela completa. */
export function weekRangeForMonday(mondayDateStr: string): WeekRange {
  const [y, m, d] = mondayDateStr.split("-").map(Number);
  const mondayLocal = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const saturdayLocal = new Date(Date.UTC(y, m - 1, d + 5, 0, 0, 0));
  // fim exclusivo = domingo 00:00 BRT, ou seja, sábado inteiro entra na janela
  const sundayLocal = new Date(Date.UTC(y, m - 1, d + 6, 0, 0, 0));
  return {
    mondayDate: dateStr(mondayLocal),
    saturdayDate: dateStr(saturdayLocal),
    label: `Semana ${isoWeekNumber(mondayLocal)}`,
    start: toUtc(mondayLocal),
    end: toUtc(sundayLocal),
  };
}

export function previousWeek(mondayDateStr: string): WeekRange {
  const [y, m, d] = mondayDateStr.split("-").map(Number);
  const prevMondayLocal = new Date(Date.UTC(y, m - 1, d - 7, 0, 0, 0));
  return weekRangeForMonday(dateStr(prevMondayLocal));
}

/** Lista as semanas (segunda a segunda) cujo início cai dentro do mês informado (1-12), sempre começando pela primeira semana do mês. */
export function getWeeksForMonth(year: number, month: number): WeekRange[] {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0)); // último dia do mês

  let monday = mondayLocalFromLocalShifted(monthStart);
  if (monday.getTime() < monthStart.getTime()) {
    monday = new Date(monday.getTime() + 7 * 86400000);
  }

  const weeks: WeekRange[] = [];
  while (monday.getTime() <= monthEnd.getTime()) {
    weeks.push(weekRangeForMonday(dateStr(monday)));
    monday = new Date(monday.getTime() + 7 * 86400000);
  }
  return weeks;
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Monta o intervalo do mês inteiro (dia 1 ao último dia), horário de Brasília. */
export function monthRange(year: number, month: number): WeekRange {
  const firstLocal = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const lastLocal = new Date(Date.UTC(year, month, 0, 0, 0, 0)); // último dia do mês
  const nextMonthFirstLocal = new Date(Date.UTC(year, month, 1, 0, 0, 0)); // fim exclusivo
  return {
    mondayDate: dateStr(firstLocal),
    saturdayDate: dateStr(lastLocal),
    label: `${MONTH_NAMES[month - 1]}/${year}`,
    start: toUtc(firstLocal),
    end: toUtc(nextMonthFirstLocal),
  };
}

/** Mês anterior ao informado, pra comparação mês a mês. */
export function previousMonthRange(year: number, month: number): WeekRange {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return monthRange(prevYear, prevMonth);
}

/** Monta o intervalo de um único dia (00:00 a 23:59:59), horário de Brasília. */
export function dayRange(dayDateStr: string): WeekRange {
  const [y, m, d] = dayDateStr.split("-").map(Number);
  const dayLocal = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const nextDayLocal = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0)); // fim exclusivo
  const dd = String(dayLocal.getUTCDate()).padStart(2, "0");
  const mm = String(dayLocal.getUTCMonth() + 1).padStart(2, "0");
  return {
    mondayDate: dateStr(dayLocal),
    saturdayDate: dateStr(dayLocal),
    label: `${dd}/${mm}/${dayLocal.getUTCFullYear()}`,
    start: toUtc(dayLocal),
    end: toUtc(nextDayLocal),
  };
}

/** Dia anterior ao informado, pra comparação dia a dia. */
export function previousDayRange(dayDateStr: string): WeekRange {
  const [y, m, d] = dayDateStr.split("-").map(Number);
  const prevDayLocal = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0));
  return dayRange(dateStr(prevDayLocal));
}

/** Converte um timestamp (ISO, UTC) da API em Date, para comparar com os limites da semana. */
export function parseApiTimestamp(iso: string): Date {
  return new Date(iso);
}
