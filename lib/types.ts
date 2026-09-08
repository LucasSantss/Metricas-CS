export type ConfigResponse = {
  chatbotUrl: string | null;
  hasToken: boolean;
  useBusinessHours: boolean;
  getCurrent: boolean;
  connectionLocked: boolean;
};

export type DepartmentDto = {
  id: number;
  departmentId: string;
  name: string;
  active: boolean;
  sortOrder: number;
  goalTmeSeconds: number;
  goalTmaSeconds: number;
  goalTmrSeconds: number;
  goalCsat: number;
  goalTmeP50Seconds: number;
  goalTmeP75Seconds: number;
  goalTmeP90Seconds: number;
  goalTmaP50Seconds: number;
  goalTmaP75Seconds: number;
  goalTmaP90Seconds: number;
  goalTmrP50Seconds: number;
  goalTmrP75Seconds: number;
  goalTmrP90Seconds: number;
  attendantIds: string[];
};

export type WeekDto = { mondayDate: string; saturdayDate: string; label: string; start: string; end: string };

export type SuriDepartmentDto = { id: string; name: string };
export type SuriAttendantDto = { id: string; name: string; email: string | null };

/** Atendente que aparece nos resultados da busca atual (período + setores filtrados). */
export type PeriodAttendantDto = { id: string; name: string; departments: string[] };
