import EventExtraction from "@/components/extraction/event-extraction";
import PageLayout from "@/components/page-layout";

export default function NewEventPage() {
  return (
    <PageLayout title="New event" backHref="/events" backLabel="Back to events">
      <EventExtraction />
    </PageLayout>
  );
}
