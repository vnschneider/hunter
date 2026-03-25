import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Briefcase, Shield } from "lucide-react";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-background via-background to-muted/40">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]" />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-16 md:px-10 md:py-24">
        <header className="mb-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Briefcase className="h-5 w-5" aria-hidden />
            </div>
            <span className="text-lg font-semibold tracking-tight">Hunter</span>
          </div>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <Button type="submit" size="sm">
              Entrar com Google
            </Button>
          </form>
        </header>

        <main className="flex flex-1 flex-col justify-center gap-10 md:gap-14">
          <div className="max-w-2xl space-y-6">
            <p className="text-sm font-medium uppercase tracking-wider text-primary">
              Plataforma de caça a vagas
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-foreground md:text-5xl">
              Estratégia, vagas e candidaturas num só painel.
            </h1>
            <p className="text-lg leading-relaxed text-muted-foreground">
              Define critérios com apoio de IA, acompanha caçadas em tempo real e
              mantém o link original de cada vaga — com interface pensada para
              clareza e confiança.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
              <Shield className="mb-3 h-8 w-8 text-primary" aria-hidden />
              <h2 className="font-semibold">Dados sob controlo</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                CV e critérios ficam na tua conta; login com Google e acesso
                servidor seguro.
              </p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
              <Briefcase className="mb-3 h-8 w-8 text-primary" aria-hidden />
              <h2 className="font-semibold">Pipeline visível</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Candidaturas com estados e URL canónica, prontos para integrar
                com o worker de caça.
              </p>
            </div>
          </div>
        </main>

        <footer className="mt-20 border-t border-border/60 pt-8 text-center text-xs text-muted-foreground">
          Hunter — uso pessoal / equipa. Consulta a documentação em{" "}
          <code className="rounded bg-muted px-1 py-0.5">docs/</code>.
        </footer>
      </div>
    </div>
  );
}
