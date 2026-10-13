import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { SectionHeader } from "@/components/shared/evening";
import { fetchBlockedTasks, resolveBlocker, type BlockedTaskItem } from "@/lib/api/tasks";

/* Supervisor view of "Unable to Complete" reports: who is stuck, why, for how long, and a one-tap way to
   close the report. Resolving only clears the blocker (the assignee is told); reassigning stays where it was.
   Server-authoritative: a row leaves the list only after the server confirmed the resolve. */

const NOTE_MAX = 500;

function waitingFor(reportedAt: string | null, now: number): string {
  const ms = reportedAt ? now - new Date(reportedAt).getTime() : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

interface Props {
  isOnline: boolean;
  /** Bump to reload (pull-to-refresh on the parent screen). */
  reloadToken: number;
}

export function BlockedTasksSection({ isOnline, reloadToken }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [items, setItems] = useState<BlockedTaskItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchBlockedTasks();
      setItems(result.items);
      setHasMore(result.hasMore);
      setStatus("ready");
    } catch {
      setStatus((current) => (current === "ready" ? current : "error"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const resolve = useCallback(
    async (item: BlockedTaskItem) => {
      if (busyId) return;
      setBusyId(item.blocker.id);
      setMessage(null);
      try {
        await resolveBlocker(item.task.id, item.blocker.id, note);
        setItems((prev) => prev.filter((row) => row.blocker.id !== item.blocker.id));
        setOpenId(null);
        setNote("");
        setMessage({ kind: "ok", text: t("tasks.blocked.resolved") });
      } catch {
        setMessage({ kind: "error", text: t("tasks.blocked.resolveFailed") });
        void load();
      } finally {
        setBusyId(null);
      }
    },
    [busyId, load, note, t],
  );

  if (status === "loading") return null;
  if (status === "error") {
    return (
      <View style={styles.section}>
        <Text style={[styles.meta, { color: theme.status.dirty }]} accessibilityRole="alert">
          {t("tasks.blocked.loadFailed")}
        </Text>
        <TouchableOpacity onPress={() => void load()} accessibilityRole="button" style={styles.retry}>
          <Text style={[styles.link, { color: theme.primaryAction }]}>{t("tasks.blocked.retry")}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (items.length === 0 && !message) return null;

  const now = Date.now();
  return (
    <View style={styles.section} testID="blocked-tasks-section">
      <SectionHeader title={t("tasks.blocked.title")} hint={String(items.length)} />
      {message ? (
        <Text style={[styles.meta, { color: message.kind === "ok" ? theme.status.ready : theme.status.dirty }]} accessibilityRole="alert">
          {message.text}
        </Text>
      ) : null}
      {items.map((item) => {
        const open = openId === item.blocker.id;
        const busy = busyId === item.blocker.id;
        const place = item.task.room_number ? t("tasks.blocked.room", { room: item.task.room_number }) : item.task.location_text;
        const waited = waitingFor(item.blocker.reported_at, now);
        return (
          <View
            key={item.blocker.id}
            style={[styles.card, { backgroundColor: theme.shell.surface, borderColor: theme.status.pickup }]}
            testID={`blocked-task-${item.task.id}`}
          >
            <Text style={[styles.title, { color: theme.shell.ink }]}>{item.task.title}</Text>
            <Text style={[styles.reason, { color: theme.status.pickup }]}>{t(`tasks.hk.blocker.reason.${item.blocker.reason}`)}</Text>
            {item.blocker.details ? <Text style={[styles.meta, { color: theme.shell.ink2 }]}>{item.blocker.details}</Text> : null}
            <Text style={[styles.meta, { color: theme.shell.ink3 }]}>
              {[
                place,
                item.blocker.reported_by_name ? t("tasks.blocked.reportedBy", { name: item.blocker.reported_by_name }) : null,
                item.task.assigned_to_name ? t("tasks.blocked.assignedTo", { name: item.task.assigned_to_name }) : t("tasks.blocked.unassigned"),
                waited ? t("tasks.blocked.waiting", { time: waited }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {open ? (
              <View style={styles.form}>
                <Text style={[styles.label, { color: theme.shell.ink2 }]}>{t("tasks.blocked.noteLabel")}</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.shell.line, color: theme.shell.ink }]}
                  value={note}
                  onChangeText={setNote}
                  placeholder={t("tasks.blocked.notePlaceholder")}
                  placeholderTextColor={theme.textDisabled}
                  maxLength={NOTE_MAX}
                  multiline
                  editable={!busy}
                  accessibilityLabel={t("tasks.blocked.noteLabel")}
                />
                {!isOnline ? <Text style={[styles.meta, { color: theme.status.pickup }]}>{t("tasks.blocked.offline")}</Text> : null}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.primary, { backgroundColor: theme.primaryAction }, (!isOnline || busy) && styles.disabled]}
                    onPress={() => void resolve(item)}
                    disabled={!isOnline || busy}
                    accessibilityRole="button"
                    accessibilityLabel={t("tasks.blocked.resolve")}
                    accessibilityState={{ disabled: !isOnline || busy, busy }}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={theme.onPrimary} />
                    ) : (
                      <Text style={[styles.primaryText, { color: theme.onPrimary }]}>{t("tasks.blocked.resolve")}</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.secondary, { borderColor: theme.shell.line }]}
                    onPress={() => {
                      setOpenId(null);
                      setNote("");
                    }}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={t("tasks.blocked.close")}
                  >
                    <Text style={[styles.secondaryText, { color: theme.shell.ink2 }]}>{t("tasks.blocked.close")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  setOpenId(item.blocker.id);
                  setNote("");
                  setMessage(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${t("tasks.blocked.review")}: ${item.task.title}`}
                style={styles.retry}
              >
                <Text style={[styles.link, { color: theme.primaryAction }]}>{t("tasks.blocked.review")}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
      {hasMore ? <Text style={[styles.meta, { color: theme.shell.ink3 }]}>{t("tasks.blocked.more")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 9 },
  card: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 5 },
  title: { fontSize: 14.5, fontWeight: "700" },
  reason: { fontSize: 12.5, fontWeight: "800" },
  meta: { fontSize: 12 },
  link: { fontSize: 13, fontWeight: "800" },
  retry: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  form: { gap: 8, marginTop: 6 },
  label: { fontSize: 12, fontWeight: "700" },
  input: { minHeight: 64, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5, textAlignVertical: "top" },
  actions: { flexDirection: "row", gap: 8 },
  primary: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13, fontWeight: "800" },
  secondary: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.45 },
});
