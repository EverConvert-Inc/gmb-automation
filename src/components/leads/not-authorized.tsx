import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown instead of an admin page when the session is not staff-tagged.
 *
 * Not a redirect: reaching a page at all means the middleware already found
 * a session, so bouncing to /login would loop. Saying plainly what is wrong
 * is also what makes the "nobody is tagged yet" state diagnosable rather
 * than looking like an outage.
 */
export function NotAuthorized() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            Not authorized
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            This page is limited to staff accounts. Your session is signed in
            but is not tagged as staff.
          </p>
          <p>
            Staff are identified by <code className="font-mono">app_metadata.role</code>{" "}
            in Supabase. An account that has just been tagged keeps its old
            claims until its access token refreshes — sign out and back in if
            you were tagged a moment ago.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
