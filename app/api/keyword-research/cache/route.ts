import { auth } from "@/lib/auth";
import { clearKeywordResearchCache } from "@/lib/keywordtool/quota";

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const count = await clearKeywordResearchCache();
    return Response.json({ success: true, cleared: count });
  } catch (error) {
    console.error("Keyword research cache DELETE error:", error);
    return Response.json({ error: "Failed to clear cache" }, { status: 500 });
  }
}
