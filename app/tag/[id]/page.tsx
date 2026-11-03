"use client";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TagPage } from "@/components/TagPage";

function Inner() {
  const { id } = useParams<{ id: string }>();
  const term = useSearchParams().get("term") ?? undefined;
  return <TagPage id={id} term={term} />;
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
