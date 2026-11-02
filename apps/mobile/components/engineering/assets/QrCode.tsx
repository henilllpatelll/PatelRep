import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { buildQrMatrix, rowRuns } from "@/lib/engineering/assetLabel";

interface Props {
  payload: string;
  /** Rendered edge length in dp, quiet zone included. */
  size: number;
  /** Spoken description (translated by the caller). Drawn black on white always: scanners need the contrast in any theme. */
  label: string;
  testID?: string;
}

const QUIET_MODULES = 2;

/**
 * A scannable QR code drawn with plain views (no graphics library): each row is a few boxes, one per run of same-colour
 * modules. Always black on white with a quiet zone, because that is what a label looks like and what scanners read.
 */
export function QrCode({ payload, size, label, testID }: Props) {
  const matrix = useMemo(() => buildQrMatrix(payload), [payload]);
  const total = matrix.size + QUIET_MODULES * 2;
  const cell = Math.floor((size / total) * 100) / 100;
  const edge = cell * total;
  return (
    <View
      style={[styles.frame, { width: edge, height: edge, padding: cell * QUIET_MODULES }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={testID}
    >
      {matrix.rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {rowRuns(row).map((run, i) => (
            <View key={i} style={{ width: run.length * cell, height: cell, backgroundColor: run.dark ? "#000000" : "#FFFFFF" }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: "#FFFFFF" },
  row: { flexDirection: "row" },
});
