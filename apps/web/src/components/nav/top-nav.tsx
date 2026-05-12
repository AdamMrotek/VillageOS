import NavBrand from "./nav-brand";
import NavLinks from "./nav-links";
import UserMenu from "./user-menu";

export default function TopNav() {
  return (
    <header className="border-b border-hairline bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-12 px-10 py-4">
        <div className="flex items-center gap-12">
          <NavBrand />
          <NavLinks />
        </div>
        <div className="flex items-center gap-6">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
