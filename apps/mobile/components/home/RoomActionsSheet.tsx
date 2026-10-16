import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { SheetActionRow, SheetGone, SheetNotice, SheetSection, SheetSubtitle } from "@/components/home/sheetParts";
import type { RoomActionId, RoomActionsView } from "@/lib/housekeeping/homeSheets";
import { cleanTypeLabel, locationLabel, statusLabel, type Translate } from "@/lib/housekeeping/myRoomsText";

type IconName = ComponentProps<typeof Ionicons>["name"];

const ICON: Record<RoomActionId, IconName> = {
  open: "arrow-forward-circle-outline",
  info: "information-circle-outline",
  note: "chatbubble-outline",
  issue: "build-outline",
  supplies: "cube-outline",
  exception: "hand-left-outline",
};

interface Props {
  visible: boolean;
  view: RoomActionsView;
  t: Translate;
  onSelect: (roomId: string, action: RoomActionId) => void;
  /** Ask the assistant about this room (opens the assistant; sends nothing). */
  onAsk?: () => void;
  onClose: () => void;
}

/**
 * The More menu for the room Home is showing. Every row hands off to something
 * the room screen already has (its screen, its note / maintenance / supplies /
 * access forms, its information sheet): no form logic lives here, and the form
 * rows say that nothing is sent until the form itself is submitted.
 */
export function RoomActionsSheet({ visible, view, t, onSelect, onAsk, onClose }: Props) {
  if (view.state === "missing") {
    return (
      <BottomSheet visible={visible} title={t("home.roomActions.missingTitle")} onClose={onClose} grabber testID="room-actions-sheet">
        <SheetGone
          title={t("home.roomActions.missingTitle")}
          body={t("home.roomActions.missingBody")}
          closeLabel={t("common.close")}
          onClose={onClose}
          testID="room-actions-missing"
        />
      </BottomSheet>
    );
  }

  const { room, actions, restricted, continuing } = view;
  const subtitle = [cleanTypeLabel(room, t), locationLabel(room, t), statusLabel(room.status, t)].filter(Boolean).join(" · ");
  const navigate = actions.filter((action) => action.kind === "navigate");
  const forms = actions.filter((action) => action.kind === "form");

  const copy = (action: RoomActionId) => {
    if (action === "open") {
      return {
        title: t(continuing ? "home.current.continue" : "home.current.openRoom"),
        hint: t(restricted ? "home.roomActions.openRestrictedHint" : continuing ? "home.roomActions.continueHint" : "home.roomActions.openHint"),
      };
    }
    return { title: t(`home.roomActions.rows.${action}.title`), hint: t(`home.roomActions.rows.${action}.hint`) };
  };

  return (
    <BottomSheet visible={visible} title={t("home.roomActions.title", { room: room.room_number })} onClose={onClose} grabber testID="room-actions-sheet">
      <SheetSubtitle text={subtitle || null} />
      {restricted ? <SheetNotice tone="warn" text={t("home.roomActions.restricted")} testID="room-actions-restricted" /> : null}

      <SheetSection title={t("home.roomActions.sectionGo")}>
        {navigate.map((action) => {
          const text = copy(action.id);
          return (
            <SheetActionRow
              key={action.id}
              icon={ICON[action.id]}
              title={text.title}
              hint={text.hint}
              disabledReason={action.disabledReason ? t(`rooms.work.more.disabled.${action.disabledReason}`) : null}
              onPress={() => onSelect(room.id, action.id)}
              testID={`room-action-${action.id}`}
            />
          );
        })}
      </SheetSection>

      {forms.length > 0 ? (
        <SheetSection title={t("home.roomActions.sectionReport")} hint={t("home.roomActions.formsHint")}>
          {forms.map((action) => {
            const text = copy(action.id);
            return (
              <SheetActionRow
                key={action.id}
                kind="form"
                icon={ICON[action.id]}
                title={text.title}
                hint={text.hint}
                disabledReason={action.disabledReason ? t(`rooms.work.more.disabled.${action.disabledReason}`) : null}
                onPress={() => onSelect(room.id, action.id)}
                testID={`room-action-${action.id}`}
              />
            );
          })}
        </SheetSection>
      ) : null}

      {onAsk ? (
        <SheetSection title={t("home.roomActions.sectionAssist")}>
          <SheetActionRow
            icon="sparkles-outline"
            title={t("home.roomActions.ask.title", { room: room.room_number })}
            hint={t("home.roomActions.ask.hint")}
            onPress={onAsk}
            testID="room-action-ask"
          />
        </SheetSection>
      ) : null}
    </BottomSheet>
  );
}
