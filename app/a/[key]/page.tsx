"use client";
import { useParams } from "next/navigation";
import { SingleCard } from "@/components/SingleCard";

export default function ArchiveWorkPage() {
  const { key } = useParams<{ key: string }>();
  return (
    <main>
      <SingleCard kind="a" id={key} />
    </main>
  );
}
