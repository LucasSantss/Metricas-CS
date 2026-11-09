import { NextRequest } from "next/server";
import { runTicketReportCron } from "@/lib/ticketReportCron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// agendamento separado do relatório geral: cada um tem os seus 300s (máximo do Hobby com Fluid compute)
export const maxDuration = 300;

export const GET = (req: NextRequest) => runTicketReportCron(req, "ka");
