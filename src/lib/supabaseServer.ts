import "server-only";

import { createClient } from "@supabase/supabase-js";

export {
  createRequestSupabaseClient,
  getSupabaseConfig,
} from "@/lib/supabase-server";

// This client bypasses RLS. Callers must enforce authorization, ownership,
// allowed columns and statuses explicitly. Never attach a user's session.
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
