import { useState, useRef, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Modal, Button, TextField, Label, Input, FieldError, Select, ListBox, Switch, Spinner } from "@heroui/react";
// @ts-ignore - ignore red squigly line on uuid
import { v4 as uuidv4 } from "uuid";
import { connectionSchema, type ConnectionFormData, type SavedConnection } from "../types/connection";
import { parseConnectionUrl } from "../utils/parseConnectionUrl";
import { useSaveConnection, useTestConnection } from "../hooks/useConnections";

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DB_TYPES = [
  { id: "postgres", label: "PostgreSQL", color: "#378ADD" },
  { id: "mysql", label: "MySQL / MariaDB", color: "#EF9F27" },
];

const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432,
  mysql: 3306,
};

export function ConnectionModal({ isOpen, onClose }: ConnectionModalProps) {
  const [urlInput, setUrlInput] = useState("");
  const [urlExpanded, setUrlExpanded] = useState(false);
  const [urlImported, setUrlImported] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const testResultRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (testResult) {
      testResultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [testResult]);

  const saveConnection = useSaveConnection();
  const testConnection = useTestConnection();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ConnectionFormData>({
    resolver: standardSchemaResolver(connectionSchema),
    defaultValues: {
      type: "postgres",
      host: "localhost",
      port: 5432,
      ssl: false,
    },
  });

  const dbType = watch("type");

  const handleTypeChange = (type: "postgres" | "mysql") => {
    setValue("type", type);
    setValue("port", DEFAULT_PORTS[type]);
  };

  const handleImportUrl = () => {
    setUrlError(null);
    try {
      const parsed = parseConnectionUrl(urlInput);
      Object.entries(parsed).forEach(([key, value]) => {
        if (value !== undefined) setValue(key as keyof ConnectionFormData, value as never);
      });
      setUrlImported(true);
      setTimeout(() => setUrlImported(false), 3000);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Invalid URL");
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    try {
      await testConnection.mutateAsync(watch());
      setTestResult({ ok: true, message: "Connection successful" });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "Connection failed",
      });
    }
  };

  const handleSave = async (data: ConnectionFormData) => {
    const connection: SavedConnection = {
      ...data,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    await saveConnection.mutateAsync(connection);
    handleClose();
  };

  const handleClose = () => {
    reset();
    setUrlInput("");
    setUrlExpanded(false);
    setUrlImported(false);
    setUrlError(null);
    setTestResult(null);
    onClose();
  };

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="max-w-md w-full flex flex-col max-h-[90vh]">
            <>
              <Modal.Header className="border-b border-separator shrink-0 pb-3 px-1">
                <Modal.Heading className="text-base font-medium">New connection</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>

              <Modal.Body className="flex flex-col gap-4 py-3 overflow-y-auto scrollbar-hide px-1">
                {/* URL import section */}
                <div className="rounded-lg border border-separator bg-surface-secondary">
                  <button
                    type="button"
                    onClick={() => setUrlExpanded((v) => !v)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                  >
                    <svg
                      className="w-3.5 h-3.5 text-default-400 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    <span className="text-xs font-medium text-default-500 flex-1">Import from connection URL</span>
                    <svg
                      className={`w-3 h-3 text-default-300 transition-transform ${urlExpanded ? "rotate-90" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>

                  {urlExpanded && (
                    <div className="border-t border-separator px-3 py-2.5 flex gap-2">
                      <input
                        className="flex-1 bg-surface border border-separator rounded-md px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-default-400 focus:outline-none focus:ring-1 focus:ring-accent"
                        placeholder="postgres://user:password@host:5432/dbname"
                        value={urlInput}
                        onChange={(e) => {
                          setUrlInput(e.target.value);
                          setUrlError(null);
                          setUrlImported(false);
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onPress={handleImportUrl}
                        isDisabled={!urlInput.trim()}
                        className={urlImported ? "text-success bg-success/10" : ""}
                      >
                        {urlImported ? "✓ Imported" : "Import"}
                      </Button>
                    </div>
                  )}
                  {urlError && <p className="px-3 pb-2 text-xs text-danger">{urlError}</p>}
                </div>

                {/* OR divider */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-separator" />
                  <span className="text-xs text-default-400">or fill in manually</span>
                  <div className="flex-1 h-px bg-separator" />
                </div>

                {/* Connection name */}
                <TextField isInvalid={!!errors.name}>
                  <Label className="text-xs font-medium text-default-500">Connection name</Label>
                  <Input
                    placeholder="e.g. Work server"
                    className="mt-1 border border-separator  px-3 py-1.5 w-full"
                    {...register("name")}
                  />
                  <FieldError className="text-xs mt-1">{errors.name?.message}</FieldError>
                </TextField>

                {/* DB type — v3 Select compound component */}
                <Controller
                  name="type"
                  control={control}
                  render={({ field }) => (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-default-500">Database type</label>
                      <Select
                        value={field.value}
                        onChange={(key) => handleTypeChange(key as "postgres" | "mysql")}
                        aria-label="Database type"
                      >
                        <Select.Trigger className="w-full border border-separator  px-3 py-1.5">
                          <Select.Value>
                            {(_) => {
                              const t = DB_TYPES.find((d) => d.id === field.value);
                              return t ? (
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
                                  <span>{t.label}</span>
                                </div>
                              ) : null;
                            }}
                          </Select.Value>
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {DB_TYPES.map((t) => (
                              <ListBox.Item key={t.id} id={t.id} textValue={t.label}>
                                <div className="flex items-center gap-2 px-2 py-1.5">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
                                  <span className="text-sm">{t.label}</span>
                                </div>
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                  )}
                />

                {/* Host + Port */}
                <div className="flex gap-3">
                  <TextField className="flex-1" isInvalid={!!errors.host}>
                    <Label className="text-xs font-medium text-default-500">Host</Label>
                    <Input
                      placeholder="localhost"
                      className="mt-1 border border-separator px-3 py-1.5 w-full"
                      {...register("host")}
                    />
                    <FieldError className="text-xs mt-1">{errors.host?.message}</FieldError>
                  </TextField>
                  <TextField className="w-24" isInvalid={!!errors.port}>
                    <Label className="text-xs font-medium text-default-500">Port</Label>
                    <Input
                      type="number"
                      className="mt-1 border border-separator px-3 py-1.5 w-full"
                      {...register("port")}
                    />
                    <FieldError className="text-xs mt-1">{errors.port?.message}</FieldError>
                  </TextField>
                </div>

                {/* Username + Password */}
                <div className="grid grid-cols-2 gap-3">
                  <TextField className="flex-1" isInvalid={!!errors.username}>
                    <Label className="text-xs font-medium text-default-500">Username</Label>
                    <Input
                      placeholder={dbType === "postgres" ? "postgres" : "root"}
                      className="mt-1 border border-separator px-3 py-1.5 w-full"
                      {...register("username")}
                    />
                    <FieldError className="text-xs mt-1">{errors.username?.message}</FieldError>
                  </TextField>
                  <TextField className="flex-1" isInvalid={!!errors.password}>
                    <Label className="text-xs font-medium text-default-500">Password</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      className="mt-1 border border-separator px-3 py-1.5 w-full"
                      {...register("password")}
                    />
                    <FieldError className="text-xs mt-1">{errors.password?.message}</FieldError>
                  </TextField>
                </div>

                {/* Default database — optional */}
                <TextField isInvalid={!!errors.defaultDatabase}>
                  <Label className="text-xs font-medium text-default-500">
                    Default database <span className="text-[10px] text-default-400 font-normal">optional</span>
                  </Label>
                  <Input
                    placeholder="Leave empty to browse all"
                    className="mt-1 border border-separator  px-3 py-1.5 w-full"
                    {...register("defaultDatabase")}
                  />
                  <FieldError className="text-xs mt-1">{errors.defaultDatabase?.message}</FieldError>
                </TextField>

                {/* SSL — v3 Switch compound */}
                <Controller
                  name="ssl"
                  control={control}
                  render={({ field }) => (
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-default-500">Use SSL</Label>
                      <Switch isSelected={field.value} onChange={field.onChange} aria-label="Use SSL">
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch>
                    </div>
                  )}
                />

                {/* Test result */}
                {testResult && (
                  <p ref={testResultRef} className={`text-xs ${testResult.ok ? "text-success" : "text-danger"}`}>
                    {testResult.ok ? "✓" : "✗"} {testResult.message}
                  </p>
                )}
              </Modal.Body>

              {/* Footer */}
              <Modal.Footer className="border-t border-separator pt-3 flex gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onPress={handleTest}
                  isDisabled={isSubmitting || saveConnection.isPending}
                >
                  {testConnection.isPending ? <Spinner size="sm" /> : "Test connection"}
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onPress={() => handleSubmit(handleSave)()}
                  isDisabled={testConnection.isPending}
                >
                  {isSubmitting || saveConnection.isPending ? <Spinner size="sm" /> : "Save connection"}
                </Button>
              </Modal.Footer>
            </>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
