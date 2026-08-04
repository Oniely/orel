import { Button, Tooltip } from "@heroui/react";
import { GearSixIcon } from "@phosphor-icons/react";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { useSettingsStore } from "../stores/settings.store";

export function SettingsButton() {
  const { data: update } = useAppUpdate();
  const openSettings = useSettingsStore((state) => state.openSettings);
  const hasUpdate = Boolean(update);

  return (
    <Tooltip>
      <Tooltip.Trigger>
        <Button
          size="sm"
          variant="tertiary"
          onPress={() => openSettings(hasUpdate ? "updates" : "appearance")}
          aria-label={hasUpdate ? "Open settings — update available" : "Open settings"}
          className={`relative size-8 min-w-8 rounded-full p-0 transition-[color,box-shadow] ${
            hasUpdate ? "settings-update-glow text-accent" : ""
          }`}
        >
          <GearSixIcon className="size-4" weight={hasUpdate ? "fill" : "regular"} />
          {hasUpdate && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent ring-2 ring-surface"
            />
          )}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{hasUpdate ? `Update v${update?.version} available` : "Settings"}</Tooltip.Content>
    </Tooltip>
  );
}
