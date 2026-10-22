import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/** Só contas Google deste domínio (Google Workspace) entram na plataforma. */
export const ALLOWED_DOMAIN = "chatbotmaker.io";

export const isAllowedEmail = (email?: string | null) =>
  !!email && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);

/**
 * Login só pelo Google. O parâmetro `hd` faz a tela do Google já sugerir contas do domínio,
 * mas não é garantia (dá pra burlar mexendo na URL) — quem barra de verdade é o callback
 * signIn, que confere o e-mail verificado e o `hd` devolvidos pelo Google.
 * Sessão em JWT (cookie criptografado com AUTH_SECRET): nada é gravado no banco.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      return profile?.email_verified === true && profile.hd === ALLOWED_DOMAIN && isAllowedEmail(profile.email);
    },
  },
});
