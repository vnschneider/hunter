import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { hasDatabase } from "@/lib/session";
import { applications } from "@hunter/db/schema";
import { and, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ApplicationNotes = {
  tailoredResume?: {
    pdfStoragePath?: string | null;
  };
};

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parsePdfStoragePath(notes: string | null): string | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as ApplicationNotes;
    const storagePath = parsed?.tailoredResume?.pdfStoragePath;
    return storagePath ? String(storagePath) : null;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, context: RouteContext) {
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
  const db = getDb();

  const rows = await db
    .select({
      id: applications.id,
      notes: applications.notes,
    })
    .from(applications)
    .where(
      and(eq(applications.id, applicationId), eq(applications.userId, userId)),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return NextResponse.json(
      { error: "Candidatura nao encontrada." },
      { status: 404 },
    );
  }

  const storagePath = parsePdfStoragePath(row.notes);
  if (!storagePath) {
    return NextResponse.json(
      { error: "CV tailorizado nao encontrado para esta candidatura." },
      { status: 404 },
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase nao configurado para gerar download." },
      { status: 503 },
    );
  }

  const bucket = process.env.CV_STORAGE_BUCKET || "cvs";
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 5);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      {
        error:
          error?.message ||
          "Falha ao gerar URL assinada para o PDF tailorizado.",
      },
      { status: 500 },
    );
  }

  return NextResponse.redirect(data.signedUrl, 302);
}
