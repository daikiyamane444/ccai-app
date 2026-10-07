import { handleLogout } from "@/server/handlers";
import { getDeps } from "@/server/deps";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return handleLogout(req, getDeps());
}
