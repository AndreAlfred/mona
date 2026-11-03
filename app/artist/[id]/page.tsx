"use client";
import { useParams } from "next/navigation";
import { ArtistPage } from "@/components/ArtistIntro";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <main>
      <ArtistPage id={id} />
    </main>
  );
}
