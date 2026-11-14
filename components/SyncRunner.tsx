"use client";
/** Keeps a signed-in reader's account in step in the background. Renders nothing. */
import { useEffect } from "react";
import { startSync } from "@/lib/sync";

export function SyncRunner() {
  useEffect(() => startSync(), []);
  return null;
}
