import { redirect } from "next/navigation";

// Decided per request, like every other admin page (never a build-time
// static redirect).
export const dynamic = "force-dynamic";

// /admin has no page of its own: it opens the firms list, the admin area's
// starting point. Every admin page checks for staff itself.
export default function AdminIndexPage() {
  redirect("/admin/firms");
}
