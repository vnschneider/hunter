import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { hasDatabase } from "@/lib/session";
import { applications } from "@hunter/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const statusSchema = z.object({
  status: z.enum(["shortlisted", "queued", "skipped", "applied"]),
});

type NextStatus = z.infer<typeof statusSchema>["status"];

const ALLOWED_TRANSITIONS: Record<
  NextStatus,
  Array<
    | "suggested"
    | "shortlisted"
    | "queued"
    | "applying"
    | "failed"
    | "skipped"
    | "applied"
  >
> = {
  shortlisted: ["suggested", "failed", "skipped"],
  queued: ["suggested", "shortlisted", "failed", "skipped"],
  skipped: ["suggested", "shortlisted", "queued", "applying", "failed"],
  applied: ["queued", "applying", "shortlisted"],
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL nao configurado." },
      { status: 503 },
    );
  }

  const { id: applicationId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = statusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Payload invalido." },
      { status: 400 },
    );
  }

  const nextStatus = parsed.data.status;
  const db = getDb();

  try {
    const now = new Date();
    const rows = await db
      .update(applications)
      .set({
        status: nextStatus,
        updatedAt: now,
        appliedAt: nextStatus === "applied" ? now : undefined,
      })
      .where(
        and(
          eq(applications.id, applicationId),
          eq(applications.userId, userId),
          inArray(applications.status, ALLOWED_TRANSITIONS[nextStatus]),
        ),
      )
      .returning({
        id: applications.id,
        status: applications.status,
        updatedAt: applications.updatedAt,
      });

    if (!rows[0]) {
      return NextResponse.json(
        { error: "Estado atual nao permite essa transicao." },
        { status: 409 },
      );
    }

    return NextResponse.json({ data: rows[0] }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao atualizar candidatura.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
