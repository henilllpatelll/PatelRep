import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";
import { S } from "@/components/shared/tokens";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

export interface StateBlockProps {
  status: "loading" | "empty" | "error";
  children?: React.ReactNode;
  emptyIcon?: React.ComponentProps<typeof Ionicons>["name"];
  emptyTitle?: string;
  emptyBody?: string;
  errorIcon?: React.ComponentProps<typeof Ionicons>["name"];
  errorMessage?: string;
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function StateBlock({
  status,
  children,
  emptyIcon,
  emptyTitle,
  emptyBody,
  errorIcon,
  errorMessage,
  onRetry,
  retryLabel,
  style,
}: StateBlockProps) {
  const theme = useTheme();

  if (status === "loading") {
    return (
      <View style={[styles.loading, style]}>
        <ActivityIndicator size="large" color={theme.primaryAction} />
      </View>
    );
  }

  if (status === "empty") {
    return (
      <EmptyState
        icon={emptyIcon ?? "folder-open-outline"}
        title={emptyTitle ?? ""}
        body={emptyBody}
        style={style}
      />
    );
  }

  if (status === "error") {
    return (
      <EmptyState
        icon={errorIcon ?? "alert-circle-outline"}
        iconColor={theme.status.dirty}
        title={errorMessage ?? ""}
        style={style}
        action={
          onRetry ? (
            <Button
              label={retryLabel ?? ""}
              onPress={onRetry}
              variant="secondary"
              size="md"
            />
          ) : undefined
        }
      />
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: S.sectionGap,
  },
});
