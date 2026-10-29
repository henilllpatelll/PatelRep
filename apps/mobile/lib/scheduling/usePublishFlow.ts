import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyPublishFailure,
  fetchNotificationStatus,
  fetchReview,
  newPublishKey,
  publishRevision,
  retryNotifications,
  type NotificationStatus,
  type PublicationResult,
  type PublishFailure,
  type Review,
} from "@/lib/api/schedulingRevisions";

/* ─── Reviewing and publishing a draft ──────────────────────────────────────
   review_loading → review → publishing → published
                       ↘ review_failed        ↘ failed (blocked / stale / edited since review / refused)
                                              ↘ unconfirmed (no answer: the publication MAY have committed)

   - "published" is only ever set from a server answer that carries the committed publication.
   - One idempotency key per open flow. After a lost answer `retryUnconfirmed` asks again with the SAME key: if the first
     attempt committed the server returns it (`replayed`), if it did not the publication runs now. It can never apply twice.
   - A failure that changes the facts (stale shift, edited draft) asks for a NEW review before anything can be published. */

export type PublishPhase = "review_loading" | "review_failed" | "review" | "publishing" | "published" | "failed" | "unconfirmed";

const POLL_MS = 4000;
const POLL_LIMIT = 8;

export interface PublishFlow {
  phase: PublishPhase;
  review: Review | null;
  result: PublicationResult | null;
  failure: PublishFailure | null;
  notifications: NotificationStatus | null;
  notificationsFailed: boolean;
  reload: () => Promise<void>;
  publish: () => Promise<void>;
  retryUnconfirmed: () => Promise<void>;
  retryFailedNotifications: () => Promise<void>;
}

export function usePublishFlow(revisionId: string | null): PublishFlow {
  const [phase, setPhase] = useState<PublishPhase>("review_loading");
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<PublicationResult | null>(null);
  const [failure, setFailure] = useState<PublishFailure | null>(null);
  const [notifications, setNotifications] = useState<NotificationStatus | null>(null);
  const [notificationsFailed, setNotificationsFailed] = useState(false);
  const key = useRef(newPublishKey());
  const mounted = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!revisionId) return;
    const mine = ++seq.current;
    setPhase("review_loading");
    setFailure(null);
    try {
      const next = await fetchReview(revisionId);
      if (!mounted.current || mine !== seq.current) return;
      setReview(next);
      setPhase("review");
    } catch {
      if (!mounted.current || mine !== seq.current) return;
      setPhase("review_failed");
    }
  }, [revisionId]);

  useEffect(() => {
    key.current = newPublishKey();
    setResult(null);
    setNotifications(null);
    setReview(null);
    void reload();
  }, [revisionId, reload]);

  const attempt = useCallback(async () => {
    if (!revisionId || !review) return;
    setPhase("publishing");
    setFailure(null);
    try {
      const committed = await publishRevision(revisionId, review.revision.version, key.current);
      if (!mounted.current) return;
      setResult(committed);
      setPhase("published");
    } catch (error) {
      if (!mounted.current) return;
      const classified = classifyPublishFailure(error);
      setFailure(classified);
      setPhase(classified.kind === "unconfirmed" ? "unconfirmed" : "failed");
    }
  }, [revisionId, review]);

  /** Delivery status after publishing: polled a few times while messages are still being processed, then left alone. */
  useEffect(() => {
    if (phase !== "published" || !revisionId) return;
    let cancelled = false;
    let rounds = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      rounds += 1;
      try {
        const status = await fetchNotificationStatus(revisionId);
        if (cancelled) return;
        setNotifications(status);
        setNotificationsFailed(false);
        if (status.state === "processing" && rounds < POLL_LIMIT) timer = setTimeout(() => void poll(), POLL_MS);
      } catch {
        if (cancelled) return;
        setNotificationsFailed(true);
        if (rounds < POLL_LIMIT) timer = setTimeout(() => void poll(), POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, revisionId]);

  const retryFailedNotifications = useCallback(async () => {
    if (!revisionId) return;
    try {
      await retryNotifications(revisionId);
      setNotifications((held) => (held ? { ...held, state: "processing" } : held));
      setNotificationsFailed(false);
      const status = await fetchNotificationStatus(revisionId);
      if (mounted.current) setNotifications(status);
    } catch {
      if (mounted.current) setNotificationsFailed(true);
    }
  }, [revisionId]);

  return { phase, review, result, failure, notifications, notificationsFailed, reload, publish: attempt, retryUnconfirmed: attempt, retryFailedNotifications };
}
