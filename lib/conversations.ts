import type { SuriContact } from "./suri";
import type { ConversationContactDto } from "./types";

// datas "vazias" da Suri vêm como 0001-01-01T00:00:00
const validDate = (d: string | null | undefined) => (d && !d.startsWith("0001-") ? d : null);

/** Início do dia de hoje em Brasília (sem horário de verão desde 2019), em ISO UTC. */
export function startOfTodayBrasilia(): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Date(`${day}T00:00:00-03:00`).toISOString();
}

/** Contato da Suri → item da tela /conversas. `fallbackDept` = setor pelo qual ele foi buscado. */
export function toConversationDto(
  c: SuriContact,
  names: { departments: Map<string, string>; attendants: Map<string, string> },
  fallbackDept: string | null = null
): ConversationContactDto {
  const departmentId = c.agent?.departmentId ?? fallbackDept;
  const attendantId = c.agent?.platformUserId ?? null;
  return {
    id: c.id,
    name: c.name ?? c.phone ?? c.id,
    status: c.agent?.status ?? 0,
    phone: c.phone,
    email: c.email,
    avatarUrl: c.profilePicture?.url ?? null,
    channelType: c.channelType,
    identificationDocument: c.identificationDocument,
    note: c.note,
    departmentId,
    departmentName: departmentId ? names.departments.get(departmentId) ?? null : null,
    attendantId,
    attendantName: attendantId ? names.attendants.get(attendantId) ?? attendantId : null,
    dateRequest: validDate(c.agent?.dateRequest),
    dateAnswer: validDate(c.agent?.dateAnswer),
    lastMessageAt: validDate(c.lastMessageActivity),
    lastActivity: validDate(c.lastActivity),
    unreadMessages: c.agent?.unreadMessages ?? 0,
    isTransferred: c.agent?.isTransferred ?? false,
    dateCreate: validDate(c.dateCreate),
    sessionWindowEnd: validDate(c.session?.windowEnd),
  };
}
