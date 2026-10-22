import type { Metadata } from "next";
import "@flaticon/flaticon-uicons/css/regular/rounded.css";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import BrandBackground from "@/components/BrandBackground";
import SplashScreen from "@/components/SplashScreen";
import { SPLASH_SCRIPT } from "@/lib/splash";

export const metadata: Metadata = {
  title: "Termômetro Operacional",
  description: "Comparativo semanal de TME, TMA, TMR, CSAT e volume por departamento",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: o script abaixo pode pôr a classe "splash" no <html> antes do React assumir
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_SCRIPT }} />
      </head>
      <body>
        <BrandBackground />
        <SplashScreen />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
