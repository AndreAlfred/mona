import type { Metadata } from "next";
import { HistoryView } from "@/components/Shelf";

export const metadata: Metadata = { title: "History" };

export default function Page() {
  return (
    <main>
      <HistoryView />
    </main>
  );
}
