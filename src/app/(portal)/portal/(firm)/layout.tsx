import { PortalSignOutButton } from "../../_components/sign-out-button";
import { requirePortalPage } from "../../_lib/session";

export const dynamic = "force-dynamic";

/** The signed-in frame: firm name, email, sign out. No internal navigation. */
export default async function PortalFirmLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalPage();
  return (
    <div className="min-h-full">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{session.firmName}</p>
            {session.email && (
              <p className="truncate text-sm text-muted-foreground">{session.email}</p>
            )}
          </div>
          <PortalSignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
