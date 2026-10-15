import React from "react";
import fs from "fs";
import path from "path";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Modal } from "react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";

let mockLanguage: "en" | "es" = "en";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage), i18n: { language: mockLanguage } }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require("react-native");
    return <Text>{name}</Text>;
  },
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => "light" }));

import { SimpleConfirmSheet } from "@/components/security/SimpleConfirmSheet";
import { LockTimeoutSheet } from "@/components/security/LockTimeoutSheet";
import { PhotoActionsSheet } from "@/components/settings/PhotoActionsSheet";
import { EditFieldSheet } from "@/components/settings/EditFieldSheet";

const root = path.resolve(__dirname, "../..");

beforeEach(() => {
  mockLanguage = "en";
});

function sheetWith(ui: React.ReactElement) {
  const utils = render(ui);
  return { ...utils, modal: () => utils.UNSAFE_getByType(Modal) };
}

/** Every visible string, so a missing translation shows up as a raw key. */
function allText(utils: ReturnType<typeof render>): string[] {
  const { Text } = require("react-native");
  return utils.UNSAFE_getAllByType(Text).map((node) => [node.props.children].flat(5).filter((c) => typeof c === "string").join(""));
}

describe("shared sheet behaviour", () => {
  const sheets: [string, () => React.ReactElement, jest.Mock][] = [];
  const closers = { confirm: jest.fn(), photo: jest.fn(), lock: jest.fn(), edit: jest.fn() };
  sheets.push(
    ["confirmation", () => <SimpleConfirmSheet visible title="Sign out of other devices?" body="Body" confirmLabel="Sign out" cancelLabel="Cancel" destructive onConfirm={jest.fn()} onClose={closers.confirm} />, closers.confirm],
    ["photo actions", () => <PhotoActionsSheet visible hasPhoto onChooseLibrary={jest.fn()} onTakePhoto={jest.fn()} onRemove={jest.fn()} onClose={closers.photo} />, closers.photo],
    ["lock timeout", () => <LockTimeoutSheet visible value={60_000} onSelect={jest.fn()} onClose={closers.lock} />, closers.lock],
    ["edit field", () => <EditFieldSheet visible title="Edit" label="Name" value="Maria" maxLength={30} validate={() => null} normalize={(s) => s.trim()} onSave={jest.fn().mockResolvedValue(undefined)} onClose={closers.edit} />, closers.edit],
  );

  it.each(sheets)("%s: the Android back button closes it", (_name, make, onClose) => {
    onClose.mockClear();
    const { modal } = sheetWith(make());
    act(() => modal().props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(sheets)("%s: tapping outside the sheet closes it", (_name, make, onClose) => {
    onClose.mockClear();
    const { getAllByLabelText } = sheetWith(make());
    // The first "Close" is the backdrop; the second is the X in the header.
    fireEvent.press(getAllByLabelText("Close")[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(sheets)("%s: is announced as a modal with a heading, so focus lands inside it", (_name, make) => {
    const { UNSAFE_getByProps, getByRole } = sheetWith(make());
    expect(UNSAFE_getByProps({ accessibilityViewIsModal: true })).toBeTruthy();
    expect(getByRole("header")).toBeTruthy();
  });

  it.each(sheets)("%s: is not rendered at all when not visible", (_name, make) => {
    const element = make();
    const { queryByRole } = render(React.cloneElement(element, { visible: false } as never));
    expect(queryByRole("header")).toBeNull();
  });

  it("slides away without animation for people who reduce motion (the sheet reads the setting)", () => {
    const source = fs.readFileSync(path.join(root, "components/housekeeping/roomDetail/BottomSheet.tsx"), "utf8");
    expect(source).toMatch(/useReducedMotion/);
    expect(source).toMatch(/onRequestClose=\{onClose\}/);
  });
});

describe("destructive confirmations", () => {
  it("does nothing until the person confirms, and Cancel changes nothing", () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    const { getByTestId } = render(
      <SimpleConfirmSheet visible title="Sign out of other devices?" body="Body" confirmLabel="Sign out" cancelLabel="Cancel" destructive onConfirm={onConfirm} onClose={onClose} />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("confirm-sheet-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("confirm-sheet-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed, cancelled or repeated while the action is running", () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    const { getByTestId, UNSAFE_getByType } = render(
      <SimpleConfirmSheet visible busy title="T" body="B" confirmLabel="Sign out" cancelLabel="Cancel" destructive onConfirm={onConfirm} onClose={onClose} />,
    );
    act(() => UNSAFE_getByType(Modal).props.onRequestClose());
    fireEvent.press(getByTestId("confirm-sheet-cancel"));
    fireEvent.press(getByTestId("confirm-sheet-confirm"));
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows an error from the last attempt inside the sheet, as an alert", () => {
    const { getByTestId } = render(
      <SimpleConfirmSheet visible title="T" body="B" error="We couldn't do that." confirmLabel="Go" cancelLabel="Cancel" onConfirm={jest.fn()} onClose={jest.fn()} />,
    );
    expect(getByTestId("confirm-sheet-error").props.accessibilityRole).toBe("alert");
  });
});

describe("remove profile photo", () => {
  it("asks first, inside the same sheet, and only the confirm removes", () => {
    const onRemove = jest.fn();
    const { getByTestId, queryByTestId, getByText } = render(
      <PhotoActionsSheet visible hasPhoto onChooseLibrary={jest.fn()} onTakePhoto={jest.fn()} onRemove={onRemove} onClose={jest.fn()} />,
    );
    fireEvent.press(getByTestId("photo-remove"));
    expect(onRemove).not.toHaveBeenCalled();
    expect(getByText("Remove your profile photo?")).toBeTruthy();
    expect(queryByTestId("photo-library")).toBeNull();
    fireEvent.press(getByTestId("photo-remove-confirm"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("always reopens on the actions, never on a stale confirmation", () => {
    const props = { hasPhoto: true, onChooseLibrary: jest.fn(), onTakePhoto: jest.fn(), onRemove: jest.fn(), onClose: jest.fn() };
    const { getByTestId, rerender, queryByTestId } = render(<PhotoActionsSheet visible {...props} />);
    fireEvent.press(getByTestId("photo-remove"));
    rerender(<PhotoActionsSheet visible={false} {...props} />);
    rerender(<PhotoActionsSheet visible {...props} />);
    expect(getByTestId("photo-actions")).toBeTruthy();
    expect(queryByTestId("photo-remove-sheet")).toBeNull();
  });

  it("is in Spanish", () => {
    mockLanguage = "es";
    const { getByTestId, getByText } = render(
      <PhotoActionsSheet visible hasPhoto onChooseLibrary={jest.fn()} onTakePhoto={jest.fn()} onRemove={jest.fn()} onClose={jest.fn()} />,
    );
    fireEvent.press(getByTestId("photo-remove"));
    expect(getByText("¿Quitar tu foto de perfil?")).toBeTruthy();
    expect(getByText("Conservar foto")).toBeTruthy();
  });
});

describe("edit sheet keeps its place while saving", () => {
  it("blocks a second save and cannot be closed mid-save", async () => {
    let finish: () => void = () => undefined;
    const onSave = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onClose = jest.fn();
    const { getByTestId, UNSAFE_getByType } = render(
      <EditFieldSheet visible title="Edit" label="Name" value="Maria" maxLength={30} validate={() => null} normalize={(s) => s.trim()} onSave={onSave} onClose={onClose} />,
    );
    fireEvent.changeText(getByTestId("edit-field-input"), "Ana");
    await act(async () => {
      fireEvent.press(getByTestId("edit-field-save"));
      fireEvent.press(getByTestId("edit-field-save"));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    act(() => UNSAFE_getByType(Modal).props.onRequestClose());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("edit sheet validation messages", () => {
  const base = { visible: true, title: "Edit", label: "Name", maxLength: 10, normalize: (s: string) => s.trim(), onSave: jest.fn(), onClose: jest.fn() };
  const validate = (draft: string) => (draft.trim().length > 10 ? "Too long" : draft.trim() ? null : "Required");

  it("says nothing about an untouched valid value", () => {
    const { queryByTestId, getByTestId } = render(<EditFieldSheet {...base} value="Maria" validate={validate} />);
    expect(queryByTestId("edit-field-error")).toBeNull();
    expect(getByTestId("edit-field-save").props.accessibilityState?.disabled).toBe(true);
  });

  it("explains an untouched value that is already too long, so Save is not silently off", () => {
    const { getByTestId } = render(<EditFieldSheet {...base} value="Maria Guadalupe Hernandez" validate={validate} />);
    expect(getByTestId("edit-field-error").props.children).toBe("Too long");
    expect(getByTestId("edit-field-error").props.accessibilityRole).toBe("alert");
  });
});

describe("Spanish drawers", () => {
  it("never show a raw translation key", () => {
    mockLanguage = "es";
    const utils = render(
      <>
        <SimpleConfirmSheet visible title="x" body="y" confirmLabel="Cerrar sesión" cancelLabel="Cancelar" onConfirm={jest.fn()} onClose={jest.fn()} />
        <LockTimeoutSheet visible value={0} onSelect={jest.fn()} onClose={jest.fn()} />
        <PhotoActionsSheet visible hasPhoto onChooseLibrary={jest.fn()} onTakePhoto={jest.fn()} onRemove={jest.fn()} onClose={jest.fn()} />
      </>,
    );
    for (const line of allText(utils)) expect(line).not.toMatch(/^(settings|security|help|about|common|profile)\.[\w.]+$/);
  });
});

describe("Settings sources", () => {
  function files(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }
  const settingsFiles = [
    ...files(path.join(root, "app/(app)/profile")),
    ...files(path.join(root, "components/settings")),
    ...files(path.join(root, "components/security")),
    ...files(path.join(root, "lib/app")),
  ];
  const read = (file: string) => fs.readFileSync(file, "utf8");
  const rel = (file: string) => path.relative(root, file).replace(/\\/g, "/");

  it("uses the one shared sheet: no other modal system, no native alert dialogs", () => {
    const offenders = settingsFiles
      .filter((f) => rel(f) !== "components/security/AppLockGate.tsx")
      .filter((f) => /<Modal[\s>]|Alert\.alert|ActionSheetIOS|react-native-modal|@gorhom/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("has no placeholders, simulated successes or sample data in production screens", () => {
    const offenders = settingsFiles
      .filter((f) => /coming soon|not set up yet|lorem ipsum|TODO|FIXME|placeholder text|john doe|jane doe|example hotel|555-01\d\d/i.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("leaves no pressable without a handler on the About screens", () => {
    for (const file of ["app/(app)/profile/about.tsx", "app/(app)/profile/whats-new.tsx", "app/(app)/profile/licenses.tsx"]) {
      expect(read(path.join(root, file))).not.toMatch(/onPress=\{\s*(undefined|null|\(\)\s*=>\s*\{\s*\})\s*\}/);
    }
  });

  it("does not link anywhere private: no deployment, database or admin addresses in Settings code", () => {
    const offenders = settingsFiles.filter((f) => /railway\.app|vercel\.app|supabase\.co|supabase\.com\/dashboard|localhost/i.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});
