import Logo from "@repo/ui/custom_components/logo";
import Navbar from "@repo/ui/custom_components/navbar";
import UserMenu from "@repo/ui/custom_components/user-menu";
import NavLinks from "./nav-links";

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
