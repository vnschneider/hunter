"use server";

import { getDb } from "@/lib/db";
import { hasDatabase, requireUserId } from "@/lib/session";
import { applications } from "@hunter/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const applicationActionSchema = z.object({
  applicationId: z.string().uuid("Candidatura invalida"),
  period: z.coerce.number().int().min(1).max(90).default(7),
  minMatch: z.coerce.number().int().min(0).max(100).default(70),
});

const queueTopSchema = z.object({
  period: z.coerce.number().int().min(1).max(90).default(7),
  minMatch: z.coerce.number().int().min(0).max(100).default(70),
  limit: z.coerce.number().int().min(1).max(30).default(5),
});

type NextStatus = "shortlisted" | "queued" | "skipped" | "applied";

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

function baseApplicationsPath(period: number, minMatch: number) {
  return `/dashboard/applications?period=${period}&minMatch=${minMatch}`;
}

function ensureDatabase() {
  if (!hasDatabase()) {
    redirect("/dashboard/applications?error=DATABASE_URL%20nao%20configurado");
  }
}

async function transitionStatus(formData: FormData, nextStatus: NextStatus) {
  ensureDatabase();

  const userId = await requireUserId();
  const parsed = applicationActionSchema.safeParse({
    applicationId: String(formData.get("applicationId") ?? ""),
    period: String(formData.get("period") ?? "7"),
    minMatch: String(formData.get("minMatch") ?? "70"),
  });

  if (!parsed.success) {
    redirect("/dashboard/applications?error=Candidatura%20invalida");
  }

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
          eq(applications.id, parsed.data.applicationId),
          eq(applications.userId, userId),
          inArray(applications.status, ALLOWED_TRANSITIONS[nextStatus]),
        ),
      )
      .returning({ id: applications.id });

    if (!rows[0]) {
      throw new Error("Estado atual nao permite essa acao.");
    }

    revalidatePath("/dashboard/applications");
    redirect(
      `${baseApplicationsPath(parsed.data.period, parsed.data.minMatch)}&updated=${nextStatus}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao atualizar candidatura";
    redirect(
      `${baseApplicationsPath(parsed.data.period, parsed.data.minMatch)}&error=${encodeURIComponent(message)}`,
    );
  }
}

export async function markApplicationShortlisted(formData: FormData) {
  await transitionStatus(formData, "shortlisted");
}

export async function queueApplication(formData: FormData) {
  await transitionStatus(formData, "queued");
}

export async function skipApplication(formData: FormData) {
  await transitionStatus(formData, "skipped");
}

export async function markApplicationApplied(formData: FormData) {
  await transitionStatus(formData, "applied");
}

export async function queueTopApplications(formData: FormData) {
  ensureDatabase();

  const userId = await requireUserId();
  const parsed = queueTopSchema.safeParse({
    period: String(formData.get("period") ?? "7"),
    minMatch: String(formData.get("minMatch") ?? "70"),
    limit: String(formData.get("limit") ?? "5"),
  });

  if (!parsed.success) {
    redirect("/dashboard/applications?error=Parametros%20invalidos");
  }

  const db = getDb();
  const fromDate = new Date(
    Date.now() - parsed.data.period * 24 * 60 * 60 * 1000,
  );

  try {
    const candidates = await db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.userId, userId),
          inArray(applications.status, ["suggested", "shortlisted"]),
          gte(applications.createdAt, fromDate),
          gte(applications.matchScore, parsed.data.minMatch),
        ),
      )
      .orderBy(desc(applications.matchScore), desc(applications.createdAt))
      .limit(parsed.data.limit);

    if (candidates.length > 0) {
      await db
        .update(applications)
        .set({
          status: "queued",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(applications.userId, userId),
            inArray(
              applications.id,
              candidates.map((candidate) => candidate.id),
            ),
          ),
        );
    }

    revalidatePath("/dashboard/applications");
    redirect(
      `${baseApplicationsPath(parsed.data.period, parsed.data.minMatch)}&queuedTop=${candidates.length}`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro ao enfileirar recomendadas";
    redirect(
      `${baseApplicationsPath(parsed.data.period, parsed.data.minMatch)}&error=${encodeURIComponent(message)}`,
    );
  }
}
