import Link from "next/link";
import type { Metadata } from "next";
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_NOTICE_VERSION,
} from "@/lib/privacy";

export const metadata: Metadata = {
  title: "Privacy notice — VillageOS",
  description:
    "How VillageOS collects, uses, and protects the data you enter during the test.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <div className="space-y-2">
        <h1 className="font-display text-3xl tracking-tight text-ink">
          Privacy notice
        </h1>
        <p className="text-sm text-ink-soft">
          Version {PRIVACY_NOTICE_VERSION} · VillageOS is an early test. This
          notice is written in plain English so you know exactly what happens to
          what you enter.
        </p>
      </div>

      <div className="mt-10 space-y-8 text-body text-ink">
        <section className="space-y-2">
          <h2 className="text-base font-medium text-ink">Who we are</h2>
          <p className="text-ink-soft">
            VillageOS is a small calendar tool for families, run by an
            independent developer. We are the &ldquo;controller&rdquo; of the
            data you enter. You can reach us about anything in this notice at{" "}
            <a
              href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
              className="text-ink underline underline-offset-4"
            >
              {PRIVACY_CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-ink">What we collect</h2>
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">
            <li>
              <strong className="text-ink">Your account:</strong> your email
              address and a password (stored securely, never in plain text).
            </li>
            <li>
              <strong className="text-ink">What you enter:</strong> the calendar
              events, messages, and images you add — which may include
              children&rsquo;s names, schools, and schedules.
            </li>
            <li>
              <strong className="text-ink">
                Sensitive details those events may reveal:
              </strong>{" "}
              because a family calendar naturally includes things like medical
              and dental appointments or vaccinations (which reveal{" "}
              <strong className="text-ink">health</strong>) and religious events
              (which reveal <strong className="text-ink">religion</strong>), the
              events you add may contain this kind of information about your
              family. Under UK law this is &ldquo;special category&rdquo; data,
              which gets extra protection — see below.
            </li>
          </ul>
          <p className="text-ink-soft">
            Because this is a test, please use realistic-but-fake family details
            where you can. You don&rsquo;t need to enter real names or schools to
            try the product.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-ink">Why we use it</h2>
          <p className="text-ink-soft">
            Only to run the product for you: to turn the messages and images you
            submit into calendar events, and to show you your calendar. Our
            lawful basis is your consent, which you give when you sign up and can
            withdraw at any time by deleting your account.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-ink">
            Sensitive (special category) information
          </h2>
          <p className="text-ink-soft">
            Some of what you enter may reveal{" "}
            <strong className="text-ink">health</strong> (for example a doctor,
            dentist, or vaccination appointment) or{" "}
            <strong className="text-ink">religion</strong> (for example a
            religious celebration). UK law treats this as &ldquo;special
            category&rdquo; data and asks for your{" "}
            <strong className="text-ink">explicit consent</strong> before we
            process it. By ticking the consent box at sign-up, you explicitly
            consent to VillageOS processing any health or religious information
            contained in the events you add, for the sole purpose of running your
            calendar. You can withdraw this consent at any time by deleting your
            account. We do not use this information for any other purpose, and we
            do not single it out, categorise it, or build health or religious
            profiles from it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-ink">
            AI extraction (Groq and OpenAI)
          </h2>
          <p className="text-ink-soft">
            To turn what you submit into calendar events, we send that content to
            specialist AI providers that read it and return structured events:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">
            <li>
              Text you paste is processed by <strong className="text-ink">Groq</strong>.
            </li>
            <li>
              Photos you upload are processed by{" "}
              <strong className="text-ink">OpenAI</strong>.
            </li>
          </ul>
          <p className="text-ink-soft">
            We do not store the original message or photo — only the calendar
            events it produces. We have enabled Groq&rsquo;s Zero Data Retention
            option, so Groq does not retain your messages. We have turned off
            OpenAI&rsquo;s use of this data to train its models; OpenAI may retain
            it briefly (around 30 days) for abuse monitoring, then deletes it.
            Both providers are based in the United States, so this content is
            transferred there.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-ink">
            Who else processes your data
          </h2>
          <p className="text-ink-soft">
            We use a small number of trusted providers to run the service:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">
            <li>
              <strong className="text-ink">Supabase</strong> — database and
              sign-in.
            </li>
            <li>
              <strong className="text-ink">Amazon Web Services</strong> —
              hosting, and storage for provider profile and cover images. (The
              photos you submit for extraction are never stored — see above.)
            </li>
            <li>
              <strong className="text-ink">Groq</strong> and{" "}
              <strong className="text-ink">OpenAI</strong> — AI extraction (see
              above).
            </li>
          </ul>
          <p className="text-ink-soft">
            Product analytics (which features are used, so we can fix problems)
            run on our own Supabase database — no third-party analytics service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-ink">How long we keep it</h2>
          <p className="text-ink-soft">
            We keep your data for as long as you have an account, and delete it
            when you ask us to. As this is a time-limited test, we may also
            delete test data once the test concludes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium text-ink">Your rights</h2>
          <p className="text-ink-soft">
            You can ask to see the data we hold about you, correct it, or have it
            deleted. The fastest way to delete everything is{" "}
            <strong className="text-ink">
              Settings → Delete account
            </strong>
            , which permanently erases your account and all associated data. You
            can also email us at{" "}
            <a
              href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
              className="text-ink underline underline-offset-4"
            >
              {PRIVACY_CONTACT_EMAIL}
            </a>
            . If you&rsquo;re in the UK and think we&rsquo;ve mishandled your
            data, you can complain to the Information Commissioner&rsquo;s Office
            (ico.org.uk).
          </p>
        </section>
      </div>

      <div className="mt-12 border-t border-hairline pt-6">
        <Link
          href="/sign-up"
          className="text-body text-ink-soft underline underline-offset-4 hover:text-ink"
        >
          Back to sign up
        </Link>
      </div>
    </main>
  );
}
