import { redirect } from "next/navigation";

export default function EntryPage() {
  // Root path is always valid and redirects to login first.
  redirect("/login");
}
