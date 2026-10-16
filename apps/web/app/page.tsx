import { redirect } from "next/navigation";
import { getUser, homeFor } from "@/lib/auth";

export default async function Home() {
  const user = await getUser();
  redirect(user ? homeFor(user.role) : "/login");
}
