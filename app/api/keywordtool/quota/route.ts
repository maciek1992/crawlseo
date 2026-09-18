import { auth } from "@/lib/auth";
import { getSavedOrRefreshedQuota } from "@/lib/keywordtool/quota";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "1";

    const quota = await getSavedOrRefreshedQuota(refresh);
    return Response.json(quota);
  } catch (error) {
    console.error("Keyword Tool quota error:", error);
    return Response.json({ error: "Failed to load quota" }, { status: 500 });
  }
}
