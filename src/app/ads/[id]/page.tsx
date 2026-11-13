import { redirect } from "next/navigation";

// The conversion audit is the dashboard's lead report.
export default async function AdsDashboardClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/ads/${id}/conversions`);
}
