"use client";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { ArtistPage } from "@/components/ArtistIntro";

function Inner() {
  const { id } = useParams<{ id: string }>();
  return <ArtistPage id={id} />;
}

export default function Page() {
  return (
    <main>
      <Suspense>
        <Inner />
      </Suspense>
    </main>
  );
}
