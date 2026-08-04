import { AlertDialog, Button, Modal, Spinner } from "@heroui/react";
import { ArrowClockwiseIcon, CheckIcon, DownloadSimpleIcon, PaletteIcon } from "@phosphor-icons/react";
import { BundleType } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useAppInfo, useAppUpdate, useInstallUpdate } from "../hooks/useAppUpdate";
import { THEMES, getPreviewColors } from "../lib/themes";
import { useSettingsStore, type SettingsSection } from "../stores/settings.store";
import { useThemeStore } from "../stores/theme.store";

const RELEASES_URL = "https://github.com/Oniely/orel/releases/latest";

const sections: { id: SettingsSection; label: string; icon: typeof PaletteIcon }[] = [
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "updates", label: "Updates", icon: DownloadSimpleIcon },
];

export function SettingsModal() {
  const { themeId, setTheme } = useThemeStore();
  const { isOpen, section, closeSettings, setSection } = useSettingsStore();
  const updateQuery = useAppUpdate();
  const appInfo = useAppInfo();
  const install = useInstallUpdate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const update = updateQuery.data;
  const isDeb = appInfo.data?.bundleType === BundleType.Deb;
  const checkError = updateQuery.error instanceof Error ? updateQuery.error.message : "Unable to check for updates";
  const installError = install.error instanceof Error ? install.error.message : "Unable to install the update";

  const startInstall = () => {
    if (!update) return;
    install.mutate(update, {
      onError: () => setConfirmOpen(false),
    });
  };

  return (
    <>
      <Modal>
        <Modal.Backdrop
          isOpen={isOpen}
          isDismissable={!install.isPending}
          onOpenChange={(open) => {
            if (!open && !install.isPending) closeSettings();
          }}
        >
          <Modal.Container>
            <Modal.Dialog className="flex h-[680px] max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden p-0">
              <Modal.Body className="min-h-0 flex-1 p-0">
                <div className="flex h-full min-h-0">
                  <aside className="flex w-64 shrink-0 flex-col bg-surface-secondary/55 px-5 py-5">
                    <div className="mb-5 px-2.5">
                      <p className="text-lg font-semibold tracking-tight text-foreground">Settings</p>
                      <p className="mt-0.5 text-xs text-muted">Customize Orel</p>
                    </div>

                    <nav aria-label="Settings sections" className="flex flex-col gap-2">
                      {sections.map(({ id, label, icon: Icon }) => {
                        const active = section === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setSection(id)}
                            aria-current={active ? "page" : undefined}
                            className="flex h-14 w-full cursor-pointer items-center gap-3.5 rounded-2xl px-4 text-left text-base transition-colors hover:bg-surface-secondary/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            style={{
                              color: active ? "var(--accent)" : "var(--foreground)",
                              background: active
                                ? "color-mix(in oklch, var(--accent) 10%, var(--surface-secondary))"
                                : "transparent",
                            }}
                          >
                            <Icon className="shrink-0" size={23} weight="regular" />
                            <span className="font-semibold">{label}</span>
                            {id === "updates" && update && <span className="ml-auto size-2 rounded-full bg-accent" />}
                          </button>
                        );
                      })}
                    </nav>

                    <div className="mt-auto px-2.5 pt-4 text-xs text-muted">
                      Orel {appInfo.data?.version ? `v${appInfo.data.version}` : "desktop"}
                    </div>
                  </aside>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <Modal.Header className="shrink-0 border-b border-separator px-8 py-5">
                      <div>
                        <Modal.Heading className="text-xl font-semibold tracking-tight">
                          {section === "appearance" ? "Appearance" : "Updates"}
                        </Modal.Heading>
                        <p className="mt-1 text-xs text-muted">
                          {section === "appearance"
                            ? "Choose how Orel looks across the application."
                            : "Manage application updates and release information."}
                        </p>
                      </div>
                      <Modal.CloseTrigger isDisabled={install.isPending} />
                    </Modal.Header>

                    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7 scrollbar-hide">
                      {section === "appearance" ? (
                        <section>
                          <h3 className="text-sm font-medium text-foreground">Theme</h3>
                          <p className="mb-5 mt-1 text-xs text-muted">Select a color theme for the application.</p>

                          <div className="grid grid-cols-3 gap-3">
                            {THEMES.map((theme) => {
                              const isActive = themeId === theme.id;
                              const swatches = getPreviewColors(theme);

                              return (
                                <button
                                  key={theme.id}
                                  type="button"
                                  onClick={() => setTheme(theme.id)}
                                  className="relative cursor-pointer rounded-lg border-2 p-3 text-left transition-all"
                                  style={{
                                    background: theme.colors.background,
                                    borderColor: isActive ? theme.colors.accent : theme.colors.separator,
                                    boxShadow: isActive ? `0 0 0 1px ${theme.colors.accent}` : "none",
                                  }}
                                >
                                  {isActive && (
                                    <div
                                      className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full"
                                      style={{ background: theme.colors.accent }}
                                    >
                                      <CheckIcon
                                        size={12}
                                        weight="bold"
                                        style={{ color: theme.colors["accent-foreground"] }}
                                      />
                                    </div>
                                  )}

                                  <span
                                    className="mb-2.5 block text-xs font-semibold"
                                    style={{ color: theme.colors.foreground }}
                                  >
                                    {theme.name}
                                  </span>
                                  <div className="flex gap-1.5">
                                    {swatches.map((color, index) => (
                                      <div key={index} className="size-6 rounded-md" style={{ background: color }} />
                                    ))}
                                  </div>
                                  <div className="mt-2.5 h-2 rounded-sm" style={{ background: theme.colors.surface }} />
                                  <div className="mt-1 flex gap-1">
                                    <div
                                      className="h-1.5 flex-1 rounded-sm"
                                      style={{ background: theme.colors["surface-secondary"] }}
                                    />
                                    <div
                                      className="h-1.5 flex-1 rounded-sm"
                                      style={{ background: theme.colors.muted, opacity: 0.4 }}
                                    />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      ) : (
                        <section>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="text-sm font-medium text-foreground">Update preferences</h3>
                              <p className="mt-1 text-xs text-muted">
                                Keep Orel current with the latest stable release.
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              isDisabled={updateQuery.isFetching || install.isPending}
                              onPress={() => updateQuery.refetch()}
                            >
                              {updateQuery.isFetching ? (
                                <Spinner size="sm" />
                              ) : (
                                <ArrowClockwiseIcon className="size-3.5" />
                              )}
                              Check again
                            </Button>
                          </div>

                          <div className="mt-6 rounded-xl border border-separator bg-surface-secondary/30 p-4">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="text-xs text-muted">Installed version</p>
                                <p className="mt-1 font-mono text-sm text-foreground">
                                  {appInfo.isLoading ? "Checking…" : `v${appInfo.data?.version ?? "unknown"}`}
                                </p>
                              </div>
                              {update ? (
                                <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent">
                                  v{update.version} available
                                </span>
                              ) : updateQuery.isFetching ? (
                                <span className="text-xs text-muted">Checking for updates…</span>
                              ) : updateQuery.isError ? (
                                <span className="text-xs text-danger">Check failed</span>
                              ) : (
                                <span className="flex items-center gap-1.5 text-xs text-success">
                                  <CheckIcon size={13} weight="bold" /> Up to date
                                </span>
                              )}
                            </div>
                          </div>

                          {updateQuery.isError && (
                            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                              {checkError}
                            </div>
                          )}

                          {install.isError && (
                            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                              {installError}
                            </div>
                          )}

                          {update && (
                            <div className="mt-5">
                              <h4 className="text-xs font-medium text-foreground">What’s new in v{update.version}</h4>
                              <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-separator p-3 text-xs leading-relaxed text-muted">
                                {update.body?.trim() || "See the GitHub release for details."}
                              </div>

                              {isDeb ? (
                                <div className="mt-4">
                                  <p className="mb-3 text-xs leading-relaxed text-muted">
                                    Debian packages cannot be replaced in place. Download the latest .deb package and
                                    install it with your package manager.
                                  </p>
                                  <Button size="sm" onPress={() => openUrl(RELEASES_URL)}>
                                    Open latest release
                                  </Button>
                                </div>
                              ) : (
                                <Button className="mt-4" size="sm" onPress={() => setConfirmOpen(true)}>
                                  <DownloadSimpleIcon className="size-4" />
                                  Update and restart
                                </Button>
                              )}
                            </div>
                          )}
                        </section>
                      )}
                    </div>
                  </div>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <AlertDialog>
        <AlertDialog.Backdrop
          isOpen={confirmOpen}
          isDismissable={!install.isPending}
          isKeyboardDismissDisabled={install.isPending}
          onOpenChange={(open) => {
            if (!open && !install.isPending) setConfirmOpen(false);
          }}
        >
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>Update and restart Orel?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {install.isPending ? (
                  <div>
                    <p>Downloading and installing v{update?.version}…</p>
                    <div
                      className="mt-4 h-2 overflow-hidden rounded-full bg-surface-secondary"
                      role="progressbar"
                      aria-label="Update download progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={install.progress}
                    >
                      <div
                        className={`h-full rounded-full bg-accent ${
                          install.progress < 100 ? "transition-[width] duration-200" : ""
                        }`}
                        style={{ width: `${install.progress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-right font-mono text-xs text-muted">{install.progress}%</p>
                  </div>
                ) : (
                  <p>
                    Orel will close the current session after downloading the update. Save any SQL and apply or discard
                    queued database edits before continuing.
                  </p>
                )}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="outline" isDisabled={install.isPending} onPress={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button isDisabled={install.isPending} onPress={startInstall}>
                  {install.isPending ? <Spinner size="sm" /> : "Download, install, and restart"}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </>
  );
}
