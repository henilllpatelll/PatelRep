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

type StateBlockBase = { style?: StyleProp<ViewStyle> };

export type StateBlockProps =
  | ({ status: "loading" } & StateBlockBase)
  | ({
      status: "empty";
      emptyIcon?: React.ComponentProps<typeof Ionicons>["name"];
      emptyTitle: string;
      emptyBody?: string;
    } & StateBlockBase)
  | ({
      status: "error";
      errorIcon?: React.ComponentProps<typeof Ionicons>["name"];
      errorMessage: string;
      onRetry?: () => void;
      retryLabel?: string;
    } & StateBlockBase)
  | ({ status: "ready"; children: React.ReactNode } & StateBlockBase);

export function StateBlock(props: StateBlockProps) {
  const theme = useTheme();
  const { status, style } = props;

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
        icon={props.emptyIcon ?? "folder-open-outline"}
        title={props.emptyTitle}
        body={props.emptyBody}
        style={style}
      />
    );
  }

  if (status === "error") {
    // retryLabel is required whenever onRetry is provided — enforced here since
    // the discriminated union can't express "required only if a sibling prop is set."
    if (props.onRetry && !props.retryLabel) {
      throw new Error("StateBlock: retryLabel is required when onRetry is provided");
    }
    return (
      <EmptyState
        icon={props.errorIcon ?? "alert-circle-outline"}
        iconColor={theme.status.dirty}
        title={props.errorMessage}
        style={style}
        action={
          props.onRetry ? (
            <Button
              label={props.retryLabel as string}
              onPress={props.onRetry}
              variant="secondary"
              size="md"
            />
          ) : undefined
        }
      />
    );
  }

  return <>{props.children}</>;
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: S.sectionGap,
  },
});
