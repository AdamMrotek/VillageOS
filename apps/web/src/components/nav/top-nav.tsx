import Logo from "@repo/ui/custom_components/logo";
import Navbar from "@repo/ui/custom_components/navbar";
import NavLinks from "./nav-links";
import UserMenu from "./user-menu";

export default function TopNav() {
  return (
    <Navbar
      left={
        <>
          <Logo href="/calendar" />
          <NavLinks />
        </>
      }
      right={<UserMenu />}
    />
  );
}
