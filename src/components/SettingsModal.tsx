import { Modal } from "@heroui/react";
import { THEMES, getPreviewColors } from "../lib/themes";
import { useThemeStore } from "../stores/theme.store";
import { CheckIcon } from "@phosphor-icons/react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { themeId, setTheme } = useThemeStore();

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="max-w-2xl w-full flex flex-col max-h-[85vh]">
            <>
              <Modal.Header className="border-b border-separator shrink-0 pb-3 px-1">
                <Modal.Heading className="text-base font-medium">Settings</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>

              <Modal.Body className="py-4 overflow-y-auto scrollbar-hide px-1">
                {/* Appearance section */}
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Appearance</h3>
                  <p className="text-xs text-muted mb-4">Choose a theme for the application</p>

                  <div className="grid grid-cols-3 gap-3">
                    {THEMES.map((theme) => {
                      const isActive = themeId === theme.id;
                      const swatches = getPreviewColors(theme);

                      return (
                        <button
                          key={theme.id}
                          onClick={() => setTheme(theme.id)}
                          className="relative rounded-lg border-2 p-3 text-left transition-all cursor-pointer"
                          style={{
                            background: theme.colors.background,
                            borderColor: isActive ? theme.colors.accent : theme.colors.separator,
                            boxShadow: isActive
                              ? `0 0 0 1px ${theme.colors.accent}`
                              : "none",
                          }}
                        >
                          {/* Active check */}
                          {isActive && (
                            <div
                              className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                              style={{ background: theme.colors.accent }}
                            >
                              <CheckIcon
                                size={12}
                                weight="bold"
                                style={{ color: theme.colors["accent-foreground"] }}
                              />
                            </div>
                          )}

                          {/* Theme name */}
                          <span
                            className="text-xs font-semibold block mb-2.5"
                            style={{ color: theme.colors.foreground }}
                          >
                            {theme.name}
                          </span>

                          {/* Color swatches */}
                          <div className="flex gap-1.5">
                            {swatches.map((color, i) => (
                              <div
                                key={i}
                                className="w-6 h-6 rounded-md"
                                style={{ background: color }}
                              />
                            ))}
                          </div>

                          {/* Surface preview bar */}
                          <div
                            className="mt-2.5 h-2 rounded-sm"
                            style={{ background: theme.colors.surface }}
                          />
                          <div className="flex gap-1 mt-1">
                            <div
                              className="flex-1 h-1.5 rounded-sm"
                              style={{ background: theme.colors["surface-secondary"] }}
                            />
                            <div
                              className="flex-1 h-1.5 rounded-sm"
                              style={{ background: theme.colors.muted, opacity: 0.4 }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Modal.Body>
            </>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
