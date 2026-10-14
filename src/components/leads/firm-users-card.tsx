import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type FirmUser = {
  id: string;
  email: string;
  isActive: boolean;
};

/**
 * Read-only for now. Creating a portal user means creating a Supabase auth
 * user with its role set, which needs the service-role key — that arrives
 * with the portal phase, along with the middleware allowlist that makes a
 * client role mean anything. Listing them here now so the firm page is
 * complete and so an existing membership row is visible.
 */
export function FirmUsersCard({ users }: { users: FirmUser[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portal users</CardTitle>
        <CardDescription>
          Read-only. Creating client logins waits for the portal phase, which
          brings the service-role key and the middleware allowlist with it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No portal users yet.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="truncate">{u.email}</span>
                {u.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="outline">Inactive</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
