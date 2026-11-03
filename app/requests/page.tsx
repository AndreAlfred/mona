import type { Metadata } from "next";
import { RequestsView } from "@/components/RequestsView";

export const metadata: Metadata = { title: "Requests" };

export default function Page() {
  return (
    <main>
      <RequestsView />
    </main>
  );
}
