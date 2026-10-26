import { StyleSheet, View } from "react-native";
import { EmptyAction } from "@/components/supervisor/board/BoardStates";
import { Skeleton } from "@/components/supervisor/today/TodayBlocks";
import { StateBlock } from "@/components/ui/StateBlock";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Every reason the Rooms tab can have nothing to list, each with its own words and way out:
 *  - unavailable      nothing verified to show (offline / forbidden / failed) — NEVER "no rooms"
 *  - verifiedEmpty    the server answered and the hotel has no rooms today
 *  - queueDone        rooms exist, none is waiting for a person
 *  - scope            a quick view is empty (e.g. nothing unassigned)       → View all rooms
 *  - blockedOnly      nothing is ready to assign, but rooms are held back   → View blocked rooms
 *  - search / filters no match                                             → Clear search / filters
 */
export type AssignmentEmptyKind = "unavailable" | "verifiedEmpty" | "queueDone" | "scope" | "blockedOnly" | "search" | "filters";

export function AssignmentEmpty({
  kind,
  t,
  searchText,
  searching,
  staleNote,
  unavailableKey,
  offline,
  onRefresh,
  onShowAll,
  onShowBlocked,
  onClearSearch,
  onClearFilters,
}: {
  kind: AssignmentEmptyKind;
  t: Translate;
  searchText: string;
  searching: boolean;
  /** Set when the data behind a "no match" answer is not freshly verified. */
  staleNote: string | null;
  unavailableKey: string | null;
  offline: boolean;
  onRefresh: () => void;
  onShowAll: () => void;
  onShowBlocked: () => void;
  onClearSearch: () => void;
  onClearFilters: () => void;
}) {
  switch (kind) {
    case "unavailable":
      return (
        <View testID="assignments-unavailable">
          <StateBlock
            status="error"
            errorIcon={offline ? "cloud-offline-outline" : "alert-circle-outline"}
            errorMessage={t(unavailableKey ?? "assignments.v2.state.unavailableError")}
            onRetry={onRefresh}
            retryLabel={t("assignments.v2.state.retry")}
          />
        </View>
      );
    case "verifiedEmpty":
      return (
        <View testID="assignments-empty">
          <StateBlock status="empty" emptyIcon="bed-outline" emptyTitle={t("assignments.v2.empty.verifiedEmpty")} emptyBody={t("assignments.v2.empty.verifiedEmptyBody")} />
          <EmptyAction label={t("assignments.v2.header.refresh")} onPress={onRefresh} testID="assignments-empty-refresh" />
        </View>
      );
    case "queueDone":
      return (
        <View testID="assignments-queue-done">
          <StateBlock status="empty" emptyIcon="checkmark-circle-outline" emptyTitle={t("assignments.v2.empty.queueDone")} emptyBody={staleNote ?? t("assignments.v2.empty.queueDoneBody")} />
        </View>
      );
    case "scope":
      return (
        <View testID="assignments-scope-empty">
          <StateBlock status="empty" emptyIcon="checkmark-circle-outline" emptyTitle={t("assignments.v2.empty.scope")} emptyBody={staleNote ?? undefined} />
          <EmptyAction label={t("assignments.v2.empty.viewAll")} onPress={onShowAll} testID="assignments-view-all" />
        </View>
      );
    case "blockedOnly":
      return (
        <View testID="assignments-blocked-only">
          <StateBlock status="empty" emptyIcon="alert-circle-outline" emptyTitle={t("assignments.v2.empty.blockedOnly")} emptyBody={staleNote ?? undefined} />
          <EmptyAction label={t("assignments.v2.empty.viewBlocked")} onPress={onShowBlocked} testID="assignments-view-blocked" />
        </View>
      );
    case "search":
      return (
        <View testID="assignments-search-empty">
          <StateBlock status="empty" emptyIcon="search-outline" emptyTitle={t("assignments.v2.empty.search", { query: searchText })} emptyBody={staleNote ?? undefined} />
          <EmptyAction label={t("assignments.v2.search.clear")} onPress={onClearSearch} testID="assignments-search-empty-clear" />
        </View>
      );
    case "filters":
      return (
        <View testID="assignments-filters-empty">
          <StateBlock
            status="empty"
            emptyIcon="funnel-outline"
            emptyTitle={searching ? t("assignments.v2.empty.searchFilters", { query: searchText }) : t("assignments.v2.empty.filters")}
            emptyBody={staleNote ?? undefined}
          />
          <EmptyAction label={t("assignments.v2.filters.clearAll")} onPress={onClearFilters} testID="assignments-filters-empty-clear" />
          {searching ? <EmptyAction label={t("assignments.v2.search.clear")} onPress={onClearSearch} testID="assignments-filters-empty-clear-search" /> : null}
        </View>
      );
  }
}

/** Placeholder while the first answer is in flight — no counts, nothing that reads as data. */
export function AssignmentsSkeleton() {
  return (
    <View style={styles.skeleton} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="assignments-skeleton">
      <View style={styles.row}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.cell}>
            <Skeleton height={64} />
          </View>
        ))}
      </View>
      <Skeleton height={44} />
      <Skeleton height={96} />
      <Skeleton height={96} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { paddingHorizontal: 16, gap: 12 },
  row: { flexDirection: "row", gap: 8 },
  cell: { flex: 1 },
});
