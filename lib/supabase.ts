"use client";
/**
 * Mona's one connection to Supabase, made only when needed (the library is
 * loaded on demand, so readers who never sign in don't download it).
 *
 * The URL and the publishable key are public by design: they are in every
 * visitor's browser. What protects each person's data is row-level security
 * in the database (supabase/migrations/), which only lets a signed-in person
 * see and change their own rows. No secret key is ever used in Mona.
 *
 * If either variable is unset, accounts are off and Mona behaves as if they
 * didn't exist.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// Written out in full so Next.js can inline them into the browser bundle.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const accountsEnabled = Boolean(url && key);

/**
 * Small requests are sent with `keepalive`, so changes still reach the
 * account when the reader switches away and the page is put to sleep.
 * Browsers cap keepalive bodies at 64 KB, so bigger ones go normally.
 */
const keepaliveFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, keepalive: typeof init?.body === "string" && init.body.length < 48_000 });

let client: Promise<SupabaseClient> | null = null;

export function supabase(): Promise<SupabaseClient> | null {
  if (!accountsEnabled) return null;
  return (client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(url!, key!, {
      auth: { storageKey: "mona:auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: keepaliveFetch },
    }),
  ));
}
