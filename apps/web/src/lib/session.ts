import { auth } from "@/auth";
import { redirect } from "next/navigation";

export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    redirect("/");
  }
  return id;
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
