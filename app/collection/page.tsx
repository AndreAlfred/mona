import type { Metadata } from "next";
import { CollectionView } from "@/components/Shelf";

export const metadata: Metadata = { title: "Collection" };

export default function Page() {
  return (
    <main>
      <CollectionView />
    </main>
  );
}
