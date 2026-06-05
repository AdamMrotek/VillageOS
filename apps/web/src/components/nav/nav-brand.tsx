import Link from "next/link";

export default function NavBrand() {
  return (
    <Link href="/events" className="flex items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-sm bg-ink text-surface font-display text-base leading-none">
        V
      </span>
      <span className="font-display text-lg tracking-tight text-ink">
        VillageOS
      </span>
    </Link>
  );
}
