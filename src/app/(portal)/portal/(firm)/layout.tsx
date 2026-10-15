import { PortalUserMenu } from "../../_components/user-menu";
import { requirePortalPage } from "../../_lib/session";

export const dynamic = "force-dynamic";

/**
 * The signed-in frame: the firm's name on the left, the user menu (email,
 * theme, sign out) on the right. No internal navigation.
 */
export default async function PortalFirmLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalPage();
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <p className="min-w-0 truncate font-display text-lg font-bold tracking-tight">{session.firmName}</p>
          <PortalUserMenu email={session.email} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
