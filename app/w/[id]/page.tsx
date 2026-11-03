"use client";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { SingleCard } from "@/components/SingleCard";

function Inner() {
  const { id } = useParams<{ id: string }>();
  return <SingleCard kind="w" id={id} />;
}

export default function CuratedWorkPage() {
  return (
    <main>
      <Suspense>
        <Inner />
      </Suspense>
    </main>
  );
}
