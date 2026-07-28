import type { Context, Config } from "@netlify/edge-functions";

// Protege o site inteiro com autenticação HTTP Basic enquanto o CRM não tem
// autenticação real (Fase 4). A password vive só na variável de ambiente
// SITE_ACCESS_PASSWORD do site (nunca no código, nunca no Git).
export default async (req: Request, context: Context) => {
  const expected = Netlify.env.get("SITE_ACCESS_PASSWORD");
  if (!expected) return context.next();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice("Basic ".length));
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (password === expected) return context.next();
  }

  return new Response("Autenticação necessária", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="OpportunityBox CRM"' },
  });
};

export const config: Config = {
  path: "/*",
};
