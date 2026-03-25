import { auth } from "@/auth";
import { ensureProfile } from "@/lib/profile";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  await ensureProfile({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
  });

  return (
    <DashboardShell user={session.user}>{children}</DashboardShell>
  );
}
