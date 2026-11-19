import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hitRateLimit } from "./db";

// Gerações com IA (botões "Gerar"): por pessoa, somando todas as telas.
const AI_MAX = 10;
const AI_WINDOW_SEC = 10 * 60;

/** null = pode gerar; senão, a resposta 429 pronta. Evita que alguém esgote a cota do Gemini em loop. */
export async function limitAiGeneration(): Promise<NextResponse | null> {
  const email = (await auth())?.user?.email?.toLowerCase() ?? "anon";
  if (await hitRateLimit(`ai:${email}`, AI_MAX, AI_WINDOW_SEC)) return null;
  return NextResponse.json(
    { error: `Limite de ${AI_MAX} gerações com IA a cada ${AI_WINDOW_SEC / 60} minutos atingido. Tente de novo em alguns minutos.` },
    { status: 429 }
  );
}
