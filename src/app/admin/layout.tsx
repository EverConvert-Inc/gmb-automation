import { AdminTabs } from "@/components/leads/admin-tabs";
import "./admin-theme.css";

// Wraps every /admin page with its tab bar. Holds no data: each page still
// checks for staff itself (and the middleware already keeps non-staff out).
// .admin-ui sets the admin's focus ring (admin-theme.css).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-ui">
      <AdminTabs />
      {children}
    </div>
  );
}
