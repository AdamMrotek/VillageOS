import NavBrand from "./nav-brand";
import NavLinks from "./nav-links";
import UserMenu from "./user-menu";

export default function TopNav() {
  return (
    <header className="border-b border-hairline bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 md:gap-12 lg:px-10">
        <div className="flex items-center gap-4 md:gap-12">
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
