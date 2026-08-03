import { Button } from "@heroui/react";
import { ArrowCircleUpIcon } from "@phosphor-icons/react";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { useSettingsStore } from "../stores/settings.store";

export function UpdateAvailablePill() {
  const { data: update } = useAppUpdate();
  const openSettings = useSettingsStore((state) => state.openSettings);

  if (!update) return null;

  return (
    <Button
      size="sm"
      variant="tertiary"
      className="flex items-center gap-1.5 text-xs text-accent"
      onPress={() => openSettings("updates")}
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-40" />
        <span className="relative inline-flex size-2 rounded-full bg-accent" />
      </span>
      <ArrowCircleUpIcon className="size-3.5" weight="bold" />
      Update available
    </Button>
  );
}
