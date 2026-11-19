import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings, type TicketSlaHours } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { checkSuriUrl, errorJson, hostOf } from "@/lib/security";

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      chatbotUrl: settings.chatbotUrl,
      hasToken: Boolean(settings.bearerToken),
      useBusinessHours: settings.useBusinessHours,
      getCurrent: settings.getCurrent,
      connectionLocked: settings.connectionLocked,
      ticketSlaHours: settings.ticketSlaHours,
    });
  } catch (err: any) {
    return errorJson(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
    const body = await req.json();
    const input: { chatbotUrl?: string; bearerToken?: string; useBusinessHours?: boolean; getCurrent?: boolean; ticketSlaHours?: Partial<TicketSlaHours> } = {};
    if (typeof body.chatbotUrl === "string") input.chatbotUrl = body.chatbotUrl.trim();
    if (typeof body.bearerToken === "string" && body.bearerToken.trim() !== "") input.bearerToken = body.bearerToken.trim();
    if (typeof body.useBusinessHours === "boolean") input.useBusinessHours = body.useBusinessHours;
    if (typeof body.getCurrent === "boolean") input.getCurrent = body.getCurrent;
    if (body.ticketSlaHours && typeof body.ticketSlaHours === "object") {
      const sla: Partial<TicketSlaHours> = {};
      for (const k of ["P0", "P1", "P2", "P3"] as const) {
        const v = Number(body.ticketSlaHours[k]);
        if (body.ticketSlaHours[k] == null) continue;
        if (!isFinite(v) || v <= 0) throw new Error(`Meta de SLA inválida para ${k}: informe um número de horas maior que zero.`);
        sla[k] = v;
      }
      input.ticketSlaHours = sla;
    }
    // O token salvo nunca vai pra um endereço novo: trocar o host exige informar o token de novo
    // (senão quem trocasse o endereço receberia o token no próximo acesso à Suri).
    if (input.chatbotUrl) {
      const bad = checkSuriUrl(input.chatbotUrl);
      if (bad) return NextResponse.json({ error: bad }, { status: 400 });
      const current = await getSettings();
      if (!current.connectionLocked && current.bearerToken && !input.bearerToken && hostOf(input.chatbotUrl) !== hostOf(current.chatbotUrl)) {
        return NextResponse.json({ error: "Ao trocar o endereço do chatbot, informe o token de novo." }, { status: 400 });
      }
    }
    await saveSettings(input);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return errorJson(err);
  }
}
