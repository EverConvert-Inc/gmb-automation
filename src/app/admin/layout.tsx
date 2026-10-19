import { AdminTabs } from "@/components/leads/admin-tabs";

// Wraps every /admin page with its tab bar. Holds no data: each page still
// checks for staff itself (and the middleware already keeps non-staff out).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminTabs />
      {children}
    </>
  );
}
