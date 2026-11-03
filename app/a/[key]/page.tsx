"use client";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { SingleCard } from "@/components/SingleCard";

function Inner() {
  const { key } = useParams<{ key: string }>();
  return <SingleCard kind="a" id={key} />;
}

export default function ArchiveWorkPage() {
  return (
    <main>
      <Suspense>
        <Inner />
      </Suspense>
    </main>
  );
}
