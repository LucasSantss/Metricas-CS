export type ConfigResponse = {
  chatbotUrl: string | null;
  hasToken: boolean;
  useBusinessHours: boolean;
  getCurrent: boolean;
  connectionLocked: boolean;
  /** Metas de SLA de resolução dos tickets, em horas, por prioridade */
  ticketSlaHours?: { P0: number; P1: number; P2: number; P3: number };
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

/** Contato listado na tela temporária /conversas (filas Esperando, Atendimentos e Automático). */
export type ConversationContactDto = {
  id: string;
  name: string;
  /** agent.status: 0 = Automático (bot), 1 = Esperando, 2 = Atendimentos */
  status: number;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  channelType: number;
  identificationDocument: string | null;
  note: string | null;
  departmentId: string | null;
  departmentName: string | null;
  attendantId: string | null;
  attendantName: string | null;
  dateRequest: string | null;
  dateAnswer: string | null;
  lastMessageAt: string | null;
  lastActivity: string | null;
  unreadMessages: number;
  isTransferred: boolean;
  dateCreate: string | null;
  sessionWindowEnd: string | null;
};
