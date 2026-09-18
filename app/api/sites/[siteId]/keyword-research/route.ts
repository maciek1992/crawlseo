import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runKeywordResearch, KeywordToolBlockedError } from "@/lib/keyword-research";

const querySchema = z.object({
  q: z.string().min(1),
  provider: z.enum(["dataforseo", "keywordtool", "autocomplete"]).default("autocomplete"),
  engine: z.enum(["google", "bing"]).default("google"),
  country: z.string().default("global"),
  language: z.string().default("en"),
  type: z.enum(["suggestions", "questions", "prepositions"]).default("suggestions"),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { siteId } = await params;
    const site = await db.site.findUnique({
      where: { id: siteId },
      select: { userId: true, domain: true },
    });
    if (!site || site.userId !== session.user.id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
      engine: url.searchParams.get("engine") ?? undefined,
      country: url.searchParams.get("country") ?? undefined,
      language: url.searchParams.get("language") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
    });

    if (!parsed.success) {
      return Response.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const response = await runKeywordResearch(session.user.id, {
      query: parsed.data.q,
      provider: parsed.data.provider,
      engine: parsed.data.engine,
      country: parsed.data.country,
      language: parsed.data.language,
      type: parsed.data.type,
    });

    return Response.json(response);
  } catch (error) {
    if (error instanceof KeywordToolBlockedError) {
      return Response.json(
        { error: "Keyword Tool rate limit reached", blockedUntil: error.blockedUntil.toISOString() },
        { status: 429 }
      );
    }
    console.error("Keyword research error:", error);
    return Response.json(
      { error: "Keyword research failed" },
      { status: 500 }
    );
  }
}
