import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import SignInForm from "@repo/ui/custom_components/sign-in-form";

/** Email + password sign-in. Admins use their normal VillageOS account; the API
 *  enforces that the account actually has role = 'admin'. No sign-up, password
 *  reset or Google here — accounts are managed in the main web app. */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center px-5">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-center text-xl">VillageOS Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <SignInForm redirectTo="/" showHeading={false} />
        </CardContent>
      </Card>
    </main>
  );
}
