import { NextRequest } from "next/server";
import { runTicketReportCron } from "@/lib/ticketReportCron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// até 2 relatórios (semana anterior + atual), cada um com busca no bot + Gemini — 300s é o máximo do Hobby com Fluid compute
export const maxDuration = 300;

export const GET = (req: NextRequest) => runTicketReportCron(req, "all");
