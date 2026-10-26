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

// ---------------------------------------------------------------------------
// Conversas em atendimento (tela temporária /conversas)
// ---------------------------------------------------------------------------

export type SuriContact = {
  id: string;
  name: string | null;
  channelId: string;
  channelType: number;
  phone: string | null;
  email: string | null;
  profilePicture: { name: string; url: string } | null;
  identificationDocument: string | null;
  note: string | null;
  dateCreate: string;
  lastActivity: string;
  lastMessageActivity: string;
  tags: string[] | null;
  agent: {
    /** fila no portal: 0 = Automático (bot), 1 = Esperando, 2 = Atendimentos */
    status: number;
    departmentId: string | null;
    dateRequest: string | null;
    dateAnswer: string | null;
    platformUserId: string | null;
    unreadMessages: number;
    isTransferred: boolean;
  } | null;
  session: { start: string; end: string; windowEnd: string } | null;
  variables: Record<string, string> | null;
};

export type SuriMessage = {
  id: string;
  type: "UserMessage" | "SystemMessage" | string;
  senderId: string;
  text: string | null;
  createdDate: string;
  attachment: { url: string; size: number; name?: string; contentType?: string } | null;
  referencedMessageId: string | null;
  custom: Record<string, string> | null;
};

/**
 * Lista os contatos de um setor/atendente pela POST /api/contacts/list.
 * A API só filtra por DepartmentId/AttendantId (não aceita filtro por status nem por nome)
 * e pagina por continuationToken, devolvendo primeiro os atendimentos iniciados mais
 * recentemente — por isso `maxPages` limita quantos contatos vêm de setores grandes.
 */
export async function fetchContacts(
  chatbotUrl: string,
  bearerToken: string,
  options: {
    departmentId?: string | null;
    attendantId?: string | null;
    pageSize?: number;
    maxPages?: number;
    /** Sem filtro, a lista vem do contato criado mais recentemente pro mais antigo: para ao passar desta data (ISO). */
    createdSince?: string;
    /** Chamado a cada página (ex.: busca que só guarda o que casa, sem acumular tudo). */
    onPage?: (items: SuriContact[]) => void;
  }
): Promise<{ contacts: SuriContact[]; truncated: boolean }> {
  const base = chatbotUrl.replace(/\/+$/, "");
  const contacts: SuriContact[] = [];
  let token: string | null = null;
  let pages = 0;
  const maxPages = options.maxPages ?? 10;
  do {
    const res: Response = await fetch(`${base}/api/contacts/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        Limit: options.pageSize ?? 200,
        ContinuationToken: token,
        DepartmentId: options.departmentId ?? null,
        AttendantId: options.attendantId ?? null,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Falha ao consultar a API Suri (${res.status}): ${text || res.statusText}`);
    }
    const json: any = await res.json();
    if (!json.success) {
      throw new Error(`API Suri retornou erro: ${JSON.stringify(json.error)}`);
    }
    const items = (json.data?.items ?? []) as SuriContact[];
    if (options.onPage) options.onPage(items);
    else contacts.push(...items);
    token = json.data?.continuationToken ?? null;
    pages++;
    const last = items[items.length - 1];
    if (options.createdSince && last && last.dateCreate < options.createdSince) {
      token = null;
      break;
    }
  } while (token && pages < maxPages);
  return { contacts, truncated: Boolean(token) };
}

/** Histórico de mensagens do contato (GET /api/contacts/{id}/messages), do mais recente pro mais antigo. Só aceita `limit`. */
export async function fetchContactMessages(
  chatbotUrl: string,
  bearerToken: string,
  userId: string,
  limit: number
): Promise<SuriMessage[]> {
  const data = await getJson(chatbotUrl, bearerToken, `/api/contacts/${encodeURIComponent(userId)}/messages?limit=${limit}`);
  return data as SuriMessage[];
}

/** Um contato pelo id ("{canal}:{telefone}"); null se não existir nesse canal. */
export async function fetchContact(chatbotUrl: string, bearerToken: string, userId: string): Promise<SuriContact | null> {
  const base = chatbotUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/contacts/${encodeURIComponent(userId)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${bearerToken}` },
    cache: "no-store",
  });
  // contato inexistente volta 400 "User not found"
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Falha ao consultar a API Suri (${res.status}): ${res.statusText}`);
  const json = await res.json();
  return json.success ? (json.data as SuriContact) : null;
}

export type SuriChannel = { id: string; name: string; type: number };

/** Canais do chatbot (GET /api/channels). type 1 = WhatsApp, 2 = WebChat. */
export async function fetchChannels(chatbotUrl: string, bearerToken: string): Promise<SuriChannel[]> {
  const data = await getJson(chatbotUrl, bearerToken, "/api/channels");
  return (data as any[]).map((c) => ({ id: c.id, name: c.name ?? c.id, type: c.type }));
}
