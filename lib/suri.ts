export type SuriAttendanceUser = {
  id: string;
  name: string | null;
};

export type SuriAttendance = {
  status: number;
  requestDate: string;
  startDate: string;
  endDate: string;
  attendantId: string | null;
  attendantName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  surveyGrade: string | null;
  waitingTime: number;
  attendanceTime: number;
  avgResponseTime: number;
  protocol: string;
  reason: string | null;
  /** cliente atendido — usado para montar o link direto da conversa no portal */
  user: SuriAttendanceUser | null;
};

export type FetchAttendancesOptions = {
  dateFrom: string;
  dateTo: string;
  /** Filtra na própria API por setor, exemplo real do Postman: "departmentId": "cb1020285" */
  departmentId?: string | null;
  /** Filtra na própria API por atendente(s) — aceita um único id ou uma lista (exemplo real do Postman) */
  attendantId?: string | string[] | null;
  channelId?: string | null;
  /** Inclui atendimentos ainda em andamento (não finalizados) */
  getCurrent?: boolean;
  useBusinessHours?: boolean;
};

/**
 * Busca atendimentos no período [dateFrom, dateTo] (strings "YYYY-MM-DD").
 * A API filtra por dia inteiro; o corte fino da janela (segunda a sábado)
 * é feito depois, em lib/metrics.ts, usando os timestamps reais de cada
 * atendimento.
 */
export async function fetchAttendances(
  chatbotUrl: string,
  bearerToken: string,
  options: FetchAttendancesOptions
): Promise<SuriAttendance[]> {
  const base = chatbotUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/attendances`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({
      startDate: options.dateFrom,
      endDate: options.dateTo,
      channelId: options.channelId ?? null,
      attendantId: options.attendantId ?? null,
      departmentId: options.departmentId ?? null,
      getCurrent: options.getCurrent ?? false,
      useBusinessHours: options.useBusinessHours ?? false,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao consultar a API Suri (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as { success: boolean; data: SuriAttendance[]; error: unknown };
  if (!json.success) {
    throw new Error(`API Suri retornou erro: ${JSON.stringify(json.error)}`);
  }
  return json.data ?? [];
}

/** Extrai o id do chatbot no portal (ex.: "cb1000019") do chatbotUrl configurado, onde ele sempre aparece isolado. */
export function extractChatbotId(chatbotUrl: string | null): string | null {
  if (!chatbotUrl) return null;
  const match = chatbotUrl.match(/\bcb\d+\b/i);
  return match ? match[0].toLowerCase() : null;
}

export type SuriDepartment = { id: string; name: string };
export type SuriAttendant = { id: string; name: string; email: string | null };

async function getJson(chatbotUrl: string, bearerToken: string, path: string) {
  const base = chatbotUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao consultar a API Suri (${res.status}): ${text || res.statusText}`);
  }
  const json = await res.json();
  if (!json.success) {
    throw new Error(`API Suri retornou erro: ${JSON.stringify(json.error)}`);
  }
  return json.data ?? [];
}

export async function fetchDepartments(chatbotUrl: string, bearerToken: string): Promise<SuriDepartment[]> {
  const data = await getJson(chatbotUrl, bearerToken, "/api/departments");
  return (data as any[]).map((d) => ({ id: d.id, name: d.Name ?? d.name ?? d.id }));
}

/** Se departmentId for informado, tenta filtrar via query string na própria API. */
export async function fetchAttendants(chatbotUrl: string, bearerToken: string, departmentId?: string): Promise<SuriAttendant[]> {
  const path = departmentId ? `/api/attendants?departmentId=${encodeURIComponent(departmentId)}` : "/api/attendants";
  const data = await getJson(chatbotUrl, bearerToken, path);
  return (data as any[]).map((a) => ({ id: a.id, name: a.name ?? a.Name ?? a.id, email: a.email ?? null }));
}
