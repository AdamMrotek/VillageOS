"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import PageLayout from "@/components/page-layout";
import ProviderEventForm from "@/components/provider-event-form";
import { useCreateProviderEvent } from "@/lib/queries/provider-events";

export default function NewProviderEventPage() {
  const router = useRouter();
  const create = useCreateProviderEvent();

  return (
    <PageLayout
      title="New event"
      backHref="/provider/events"
      backLabel="My events"
    >
      <ProviderEventForm
        initial={null}
        submitLabel="Save draft"
        pending={create.isPending}
        onCancel={() => router.push("/provider/events")}
        onSubmit={(event) =>
          create.mutate(event, {
            onSuccess: () => {
              toast.success("Draft saved. Publish it when you're ready.");
              router.push("/provider/events");
            },
          })
        }
      />
    </PageLayout>
  );
}
