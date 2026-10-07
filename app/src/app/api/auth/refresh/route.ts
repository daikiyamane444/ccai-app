import { handleRefresh } from "@/server/handlers";
import { getDeps } from "@/server/deps";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return handleRefresh(req, getDeps());
}
