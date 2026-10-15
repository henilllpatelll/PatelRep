import { useCallback, useEffect, useRef, useState } from "react";
import { getOwnProfile, type OwnProfile } from "@/lib/api/profile";
import { useAppStore } from "@/stores/appStore";

export type OwnProfileStatus = "loading" | "ready" | "error";

/** Mirrors confirmed server profile data into the central user store, preserving every other field. */
export function applyProfileToStore(profile: Pick<OwnProfile, "preferred_name" | "avatar_url">) {
  const { user, setUser } = useAppStore.getState();
  if (!user) return;
  setUser({
    ...user,
    preferred_name: profile.preferred_name ?? undefined,
    avatar_url: profile.avatar_url,
  });
}

/** Loads the caller's own profile (email, hotel, photo). Session identity stays visible while it loads. */
export function useOwnProfile() {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [status, setStatus] = useState<OwnProfileStatus>("loading");
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const next = await getOwnProfile();
      if (!mounted.current) return;
      setProfile(next);
      setStatus("ready");
      applyProfileToStore(next);
    } catch {
      if (mounted.current) setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  /** Adopt a profile the server just returned from an edit. */
  const adopt = useCallback((next: OwnProfile) => {
    setProfile(next);
    setStatus("ready");
    applyProfileToStore(next);
  }, []);

  return { profile, status, reload: load, adopt };
}
