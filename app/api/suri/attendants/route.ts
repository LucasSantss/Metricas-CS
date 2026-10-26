import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { fetchAttendants } from "@/lib/suri";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// Proxy para GET {CHATBOT-URL}/api/attendants — usado pela tela de Ajustes
// para escolher quais atendentes de um setor entram no relatório.
// ?departmentId= é repassado como query param para a API da Suri.
export async function GET(req: NextRequest) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
    const settings = await getSettings();
    if (!settings.chatbotUrl || !settings.bearerToken) {
      return NextResponse.json({ error: "Configure a URL do chatbot e o token primeiro." }, { status: 400 });
    }
    const departmentId = req.nextUrl.searchParams.get("departmentId") ?? undefined;
    const attendants = await fetchAttendants(settings.chatbotUrl, settings.bearerToken, departmentId);
    return NextResponse.json({ attendants });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
