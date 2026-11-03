"use client";
import { useParams } from "next/navigation";
import { SingleCard } from "@/components/SingleCard";

export default function CuratedWorkPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <main>
      <SingleCard kind="w" id={id} />
    </main>
  );
}
