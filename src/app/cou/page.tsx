import type { Metadata } from "next";
import { CouApp } from "@/components/cou/CouApp";

export const metadata: Metadata = { title: "DemoPay · Customer app" };

export default function CouPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas min-[480px]:py-6">
      <CouApp />
    </main>
  );
}
