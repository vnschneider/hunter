import { auth } from "@/auth";
import { hasDatabase } from "@/lib/session";
import { enqueueHuntForUser, listUserHunts } from "@/lib/hunts";
import { NextResponse } from "next/server";
import { z } from "zod";

const createHuntSchema = z.object({
  strategyId: z.string().uuid("strategyId invalido"),
});

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 30;

  const rows = await listUserHunts({ userId, limit });
  return NextResponse.json({ data: rows }, { status: 200 });
}

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);
  const parsed = createHuntSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Payload invalido." },
      { status: 400 },
    );
  }

  try {
    const hunt = await enqueueHuntForUser({
      userId,
      strategyId: parsed.data.strategyId,
    });

    return NextResponse.json(
      {
        data: {
          huntId: hunt.id,
          status: hunt.status,
          createdAt: hunt.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
