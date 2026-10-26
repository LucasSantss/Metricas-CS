import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { fetchDepartments } from "@/lib/suri";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// Proxy para GET {CHATBOT-URL}/api/departments — usado pela tela de Ajustes
// para listar os setores existentes na Suri e permitir selecioná-los.
export async function GET() {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
    const settings = await getSettings();
    if (!settings.chatbotUrl || !settings.bearerToken) {
      return NextResponse.json({ error: "Configure a URL do chatbot e o token primeiro." }, { status: 400 });
    }
    const departments = await fetchDepartments(settings.chatbotUrl, settings.bearerToken);
    return NextResponse.json({ departments });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
