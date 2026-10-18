import { Pressable, StyleSheet, Text, View } from "react-native";
import { R } from "@/components/shared/tokens";
import { Skeleton } from "@/components/supervisor/today/TodayBlocks";
import { StateBlock } from "@/components/ui/StateBlock";
import { GRID_GAP } from "@/lib/housekeeping/roomBoardView";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A secondary action under an empty state (Clear search, Show all, …). */
export function EmptyAction({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={[styles.action, { borderColor: theme.primaryLine, backgroundColor: theme.surface }]}
    >
      <Text style={[styles.actionText, { color: theme.primaryAction }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Every reason the board can have nothing to list, each with its own words and way out:
 *  - unavailable   nothing verified to show (offline / forbidden / failed) — NEVER "no rooms"
 *  - verifiedEmpty the server answered and the hotel has no rooms
 *  - segment       rooms match, but not in this status segment            → Show all
 *  - search        no room number matches the query                       → Clear search
 *  - filters       rooms exist but none satisfy the filters (and search)  → Clear filters (and search)
 */
export type BoardEmptyKind = "unavailable" | "verifiedEmpty" | "segment" | "search" | "filters";

export function BoardEmpty({
  kind,
  t,
  segment,
  searchText,
  searching,
  staleNote,
  unavailableKey,
  offline,
  onRefresh,
  onShowAll,
  onClearSearch,
  onClearFilters,
}: {
  kind: BoardEmptyKind;
  t: Translate;
  segment: string;
  searchText: string;
  searching: boolean;
  /** Set when the board behind a "no match" answer is not freshly verified. */
  staleNote: string | null;
  unavailableKey: string | null;
  offline: boolean;
  onRefresh: () => void;
  onShowAll: () => void;
  onClearSearch: () => void;
  onClearFilters: () => void;
}) {
  switch (kind) {
    case "unavailable":
      return (
        <StateBlock
          status="error"
          errorIcon={offline ? "cloud-offline-outline" : "alert-circle-outline"}
          errorMessage={t(unavailableKey ?? "roomBoard.state.unavailableError")}
          onRetry={onRefresh}
          retryLabel={t("roomBoard.state.retry")}
        />
      );
    case "verifiedEmpty":
      return (
        <View testID="room-board-empty">
          <StateBlock status="empty" emptyIcon="bed-outline" emptyTitle={t("roomBoard.state.verifiedEmpty")} emptyBody={t("roomBoard.state.verifiedEmptyBody")} />
          <EmptyAction label={t("roomBoard.header.refresh")} onPress={onRefresh} testID="room-board-empty-refresh" />
        </View>
      );
    case "segment":
      return (
        <View testID="room-board-segment-empty">
          <StateBlock
            status="empty"
            emptyIcon="bed-outline"
            emptyTitle={t("roomBoard.segmentEmpty")}
            emptyBody={segment === "all" ? undefined : t(`roomBoard.segmentEmptyBody.${segment}`)}
          />
          <EmptyAction label={t("roomBoard.showAll")} onPress={onShowAll} testID="room-board-show-all" />
        </View>
      );
    case "search":
      return (
        <View testID="room-board-search-empty">
          <StateBlock status="empty" emptyIcon="search-outline" emptyTitle={t("roomBoard.search.noMatch", { query: searchText })} emptyBody={staleNote ?? undefined} />
          <EmptyAction label={t("roomBoard.search.clear")} onPress={onClearSearch} testID="room-board-search-empty-clear" />
        </View>
      );
    case "filters":
      return (
        <View testID="room-board-filters-empty">
          <StateBlock
            status="empty"
            emptyIcon="funnel-outline"
            emptyTitle={searching ? t("roomBoard.empty.searchFilters", { query: searchText }) : t("roomBoard.empty.filters")}
            emptyBody={staleNote ?? undefined}
          />
          <EmptyAction label={t("roomBoard.filters.clearAll")} onPress={onClearFilters} testID="room-board-filters-empty-clear" />
          {searching ? <EmptyAction label={t("roomBoard.search.clear")} onPress={onClearSearch} testID="room-board-filters-empty-clear-search" /> : null}
        </View>
      );
  }
}

/** Lightweight placeholder while the first answer is in flight — no counts, nothing that reads as data. */
export function BoardSkeleton() {
  const theme = useTheme();
  return (
    <View style={styles.skeleton} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.skeletonCard, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
        <Skeleton height={12} width="35%" />
        <Skeleton height={34} width="55%" />
        <Skeleton height={10} />
        <Skeleton height={36} />
      </View>
      <View style={styles.skeletonRow}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} height={44} width={84} />
        ))}
      </View>
      <View style={styles.skeletonRow}>
        <View style={styles.skeletonCell}>
          <Skeleton height={116} />
        </View>
        <View style={styles.skeletonCell}>
          <Skeleton height={116} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: "center", minHeight: 48, paddingHorizontal: 22, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center", marginTop: 8 },
  actionText: { fontSize: 14, fontWeight: "700" },
  skeleton: { paddingHorizontal: 16, gap: 14 },
  skeletonCard: { borderWidth: 1, borderRadius: R.xl, padding: 16, gap: 12 },
  skeletonRow: { flexDirection: "row", gap: GRID_GAP },
  skeletonCell: { flex: 1 },
});
