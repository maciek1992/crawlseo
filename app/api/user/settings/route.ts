import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  ALLOWED_KEYWORD_CACHE_TTL_DAYS,
  getUserSettings,
  updateUserSettings,
} from "@/lib/user-settings";

const patchSchema = z.object({
  keywordCacheTtlDays: z
    .number()
    .refine((v) => (ALLOWED_KEYWORD_CACHE_TTL_DAYS as readonly number[]).includes(v), {
      message: `keywordCacheTtlDays must be one of ${ALLOWED_KEYWORD_CACHE_TTL_DAYS.join(", ")}`,
    })
    .optional(),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await getUserSettings(session.user.id);
    return Response.json(settings);
  } catch (error) {
    console.error("User settings GET error:", error);
    return Response.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid settings", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const settings = await updateUserSettings(session.user.id, parsed.data);
    return Response.json(settings);
  } catch (error) {
    console.error("User settings PATCH error:", error);
    return Response.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
