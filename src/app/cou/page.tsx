import type { Metadata } from "next";
import { CouApp } from "@/components/cou/CouApp";

export const metadata: Metadata = { title: "MeterPe · Customer app" };

export default function CouPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-canvas max-[479px]:min-h-dvh min-[480px]:py-3">
      <CouApp />
    </main>
  );
}
