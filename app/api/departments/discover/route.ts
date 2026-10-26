import { NextResponse } from "next/server";
import { getSettings, listDepartments } from "@/lib/db";
import { fetchDepartments } from "@/lib/suri";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// Lista os setores cadastrados na Suri (via /api/departments) que ainda não
// foram adicionados aqui, para o usuário adicionar com um clique.
export async function POST() {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
    const settings = await getSettings();
    if (!settings.chatbotUrl || !settings.bearerToken) {
      return NextResponse.json({ error: "Configure a URL do chatbot e o token primeiro." }, { status: 400 });
    }

    const [suriDepartments, known] = await Promise.all([
      fetchDepartments(settings.chatbotUrl, settings.bearerToken),
      listDepartments().then((deps) => new Set(deps.map((d) => d.departmentId))),
    ]);

    const departments = suriDepartments
      .filter((d) => !known.has(d.id))
      .map((d) => ({ departmentId: d.id, name: d.name }));

    return NextResponse.json({ departments });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
