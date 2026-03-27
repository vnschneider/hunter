import Link from "next/link";
import Image from "next/image";
import type { User } from "next-auth";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { NotificationsCenter } from "@/components/notifications-center";
import {
  Briefcase,
  ChartColumn,
  ClipboardList,
  LayoutDashboard,
  Settings,
  LogOut,
  Target,
} from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Resumo", icon: LayoutDashboard },
  { href: "/dashboard/strategies", label: "Estratégias", icon: Target },
  { href: "/dashboard/hunts", label: "Caçadas", icon: Briefcase },
  {
    href: "/dashboard/applications",
    label: "Candidaturas",
    icon: ClipboardList,
  },
  { href: "/dashboard/reports", label: "Relatórios", icon: ChartColumn },
  { href: "/dashboard/settings", label: "Definições", icon: Settings },
];

export function DashboardShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card shadow-sm">
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Briefcase className="h-5 w-5" aria-hidden />
          </div>
          <span className="font-semibold tracking-tight">Hunter</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
            {user.image ? (
              <Image
                src={user.image}
                alt=""
                width={36}
                height={36}
                className="rounded-full"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {user.name ?? "Conta"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <Button
              type="submit"
              variant="outline"
              className="w-full justify-start gap-2"
              size="sm"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sair
            </Button>
          </form>
        </div>
      </aside>
      <div className="flex flex-1 flex-col pl-64">
        <header className="flex items-center justify-end border-b border-border bg-card/60 px-8 py-3">
          <NotificationsCenter />
        </header>
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
