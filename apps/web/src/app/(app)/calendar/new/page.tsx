import EventExtraction from "@/components/extraction/event-extraction";
import PageLayout from "@/components/page-layout";

export default function NewEventPage() {
  return (
    <PageLayout title="New event" backHref="/calendar" backLabel="Back to calendar">
      <EventExtraction />
    </PageLayout>
  );
}
