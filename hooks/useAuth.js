/**
 * React `useAuth` reference — for a future React port of AchieveMate.
 * The live app uses auth.js + guest-migration.js (vanilla JS) with the same flow.
 *
 * @example
 * import { useAuth } from './hooks/useAuth';
 * function App() { const { user, loading } = useAuth(); ... }
 */

import { useEffect, useState } from "react";
import { supabase } from "../supabase-client.js";
import { migrateGuestDataToSupabase } from "../guest-migration.js";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function bootstrap(session) {
      if (!mounted || !session?.user) {
        return;
      }
      await migrateGuestDataToSupabase(session.user);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) {
        return;
      }
      setUser(session?.user ?? null);
      setLoading(false);
      bootstrap(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) {
        return;
      }

      setUser(session?.user ?? null);

      if (event === "SIGNED_IN" && session?.user) {
        await migrateGuestDataToSupabase(session.user);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    user,
    loading,
    isSignedIn: Boolean(user),
    signOut: () => supabase.auth.signOut(),
  };
}
