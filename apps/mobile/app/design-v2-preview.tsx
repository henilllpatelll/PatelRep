import { Redirect } from "expo-router";
import { HousekeeperHomePreview } from "@/components/design-v2/HousekeeperHomePreview";
import { isDesignV2PreviewEnabled } from "@/lib/design/designV2";

/** Design System V2 reference preview (sample data only).
 *
 *  Not a product screen: it is not in any tab bar or menu, and it bounces to the app root unless
 *  the build was started with EXPO_PUBLIC_DESIGN_V2_PREVIEW=true (and is not a production env).
 *  Open it with the deep link `patelrep://design-v2-preview` or, on web, `/design-v2-preview`. */
export default function DesignV2PreviewRoute() {
  if (!isDesignV2PreviewEnabled()) return <Redirect href="/" />;
  return <HousekeeperHomePreview />;
}
