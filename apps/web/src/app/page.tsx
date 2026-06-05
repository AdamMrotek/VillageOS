import SignInForm from "@/components/sign-in-form";
import TryDemoButton from "@/components/try-demo-button";

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col md:flex-row">
      {/* Left — the pitch + demo entry */}
      <section className="flex flex-1 flex-col justify-center gap-10 px-8 py-16 md:px-12 lg:px-20">
        <div className="space-y-5">
          <p className="text-eyebrow-accent">VillageOS</p>
          <h1 className="text-hero text-ink">
            Catch every event before it slips through the cracks.
          </h1>
          <p className="text-ink-soft max-w-xl text-base leading-relaxed">
            Forward a school email, paste a newsletter, or drop in a birthday
            invite. VillageOS pulls out the date, the place, and everything you
            need to do — then drops it straight onto your calendar.
          </p>
        </div>

        <div className="flex flex-col items-start gap-3">
          <TryDemoButton />
          <p className="text-meta">No signup needed — try it with sample events.</p>
        </div>
      </section>

      {/* Right — sign in for returning families */}
      <section className="flex flex-col justify-center border-t border-hairline bg-surface px-8 py-16 md:w-[440px] md:border-l md:border-t-0 md:px-12 lg:px-16">
        <SignInForm />
      </section>
    </main>
  );
}
