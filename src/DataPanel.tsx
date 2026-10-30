import ConfirmationDialog from "./components/ConfirmationDialog";
import Dialog from "./components/Dialog";
import EmptyState from "./components/EmptyState";
import SectionHeading from "./components/SectionHeading";
import Button from "./components/Button";
import { message } from "./message";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ArrowUp,
  ChevronRight,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  Copy,
  HardDrive,
  House,
  Link2,
  FolderOpen,
  Download,
  Upload,
  RefreshCw,
  Search,
  SearchX,
  X,
  type LucideIcon,
} from "lucide-react";

type Entry = {
  name: string;
  path: string;
  kind: string;
  size: number;
  modified: number | null;
};
function sizeLabel(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}
const SORTS = [
  ["name", "名称"],
  ["modified", "最近修改"],
  ["size", "大小"],
] as const;
type Sort = (typeof SORTS)[number][0];

const EXTENSION_ICONS: Record<string, LucideIcon> = {
  json: FileJson,
  yaml: FileCode,
  yml: FileCode,
  toml: FileCode,
  log: FileText,
  txt: FileText,
  md: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  webp: FileImage,
  gif: FileImage,
  zip: FileArchive,
  db: FileArchive,
};
function entryIcon(entry: Entry): LucideIcon {
  if (entry.kind === "directory") return Folder;
  if (entry.kind === "link") return Link2;
  const ext = entry.name.includes(".")
    ? (entry.name.split(".").pop()?.toLowerCase() ?? "")
    : "";
  return EXTENSION_ICONS[ext] ?? File;
}
const nameCollator = new Intl.Collator("zh-CN", { numeric: true });
const modifiedFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
function modifiedLabel(seconds: number | null) {
  return seconds === null ? "—" : modifiedFormat.format(seconds * 1000);
}

export default function DataPanel({
  dataDir,
  disabled,
  running,
  onBusyChange,
}: {
  dataDir: string;
  disabled: boolean;
  running: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [copying, setCopying] = useState(false);
  const [transfer, setTransfer] = useState<"import" | "export">("export");
  const [confirmation, setConfirmation] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [sort, setSort] = useState<Sort>("name");
  const [transferOpen, setTransferOpen] = useState(false);
  const inFlight = useRef(false);
  const phrase = transfer === "import" ? "确认覆盖导入" : "确认导出";
  const blocked = disabled || running || transferring || !isTauri();

  async function transferData(event: React.FormEvent) {
    event.preventDefault();
    if (blocked || inFlight.current || confirmation !== phrase) return;
    inFlight.current = true;
    setTransferring(true);
    onBusyChange(true);
    try {
      const result = await invoke<string | null>("transfer_storage", {
        importing: transfer === "import",
        confirmation,
      });
      if (result) {
        message.success(result);
        navigate("");
      } else message.info("已取消，数据未修改。");
      setTransferOpen(false);
    } catch (reason) {
      message.error(String(reason));
    } finally {
      inFlight.current = false;
      setTransferring(false);
      onBusyChange(false);
    }
  }
  async function locationAction(copy: boolean) {
    if (copy) {
      setCopying(true);
      try {
        await navigator.clipboard.writeText(dataDir);
        message.success("路径已复制");
      } catch {
        message.error("复制失败，请手动选择目录路径复制。");
      } finally {
        setCopying(false);
      }
      return;
    }
    try {
      await invoke("open_storage");
      message.success("已打开存储目录。");
    } catch {
      message.error("无法打开存储目录，请检查目录权限。");
    }
  }
  function showTransfer(mode: "import" | "export") {
    setTransfer(mode);
    setConfirmation("");
    setTransferOpen(true);
  }
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Entry | null>(null);
  const [preview, setPreview] = useState("");
  const native = isTauri();
  useEffect(() => {
    let active = true;
    if (!native) return;
    void invoke<Entry[]>("list_storage", { path })
      .then((result) => {
        if (active) setEntries(result);
      })
      .catch((reason) => {
        if (active) {
          setError("目录暂不可用，请刷新重试。");
          message.error(String(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, revision, native]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    void invoke<string>("preview_storage", { path: selected.path })
      .then((text) => {
        if (active) setPreview(text || "（空文件）");
      })
      .catch((reason) => {
        if (active) {
          setPreview("无法预览此文件，请关闭后重试。");
          message.error(String(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [selected]);
  function navigate(next: string) {
    setPath(next);
    setQuery("");
    setError("");
    setEntries([]);
    setLoading(true);
    setRevision((r) => r + 1);
  }
  const parts = path.split("/").filter(Boolean);
  const visible = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase();
    return entries
      .filter((entry) =>
        entry.name.toLocaleLowerCase().includes(normalizedQuery),
      )
      .sort((a, b) => {
        const folders =
          Number(a.kind !== "directory") - Number(b.kind !== "directory");
        if (folders) return folders;
        if (sort === "modified") return (b.modified ?? 0) - (a.modified ?? 0);
        if (sort === "size") return b.size - a.size;
        return nameCollator.compare(a.name, b.name);
      });
  }, [entries, query, sort]);
  return (
    <section className="data-panel">
      <section className="data-card" aria-labelledby="storage-heading">
        <div className="data-card-row">
          <div className="data-card-copy">
            <SectionHeading id="storage-heading" icon={HardDrive}>
              存储目录
            </SectionHeading>
            <code title={dataDir || undefined}>
              {dataDir || "请在桌面应用中查看"}
            </code>
          </div>
          <div className="data-actions">
            <Button
              disabled={!native || !dataDir || transferring}
              onClick={() => void locationAction(false)}
              icon={FolderOpen}
              iconSize={15}
            >
              打开目录
            </Button>
            <Button
              className="storage-copy"
              disabled={!native || !dataDir || copying}
              onClick={() => void locationAction(true)}
              icon={Copy}
              iconSize={15}
            >
              复制路径
            </Button>
          </div>
        </div>
      </section>
      <section className="data-card" aria-labelledby="backup-heading">
        <div className="data-card-row">
          <div className="data-card-copy">
            <SectionHeading id="backup-heading" icon={FileArchive}>
              数据备份
            </SectionHeading>
            <p>将角色、聊天、配置和日志打包为 ZIP，或从备份恢复。</p>
          </div>
          <div className="data-actions">
            <Button
              disabled={blocked}
              onClick={() => showTransfer("export")}
              icon={Download}
              iconSize={15}
            >
              导出 ZIP
            </Button>
            <Button
              disabled={blocked}
              onClick={() => showTransfer("import")}
              icon={Upload}
              iconSize={15}
            >
              导入 ZIP
            </Button>
          </div>
        </div>
        {running && (
          <p className="data-hint">请先在侧栏停止酒馆，再导入或导出。</p>
        )}
      </section>
      <section className="file-browser" aria-label="本地数据文件">
        <div className="browser-toolbar">
          <Button
            aria-label="返回上级文件夹"
            title="返回上级"
            disabled={!path || !native}
            onClick={() => navigate(parts.slice(0, -1).join("/"))}
            icon={ArrowUp}
            iconSize={17}
          ></Button>
          <nav className="file-breadcrumbs" aria-label="文件夹路径">
            <Button
              className="crumb"
              disabled={!native}
              onClick={() => navigate("")}
              aria-current={parts.length ? undefined : "location"}
              icon={House}
              iconSize={14}
            >
              本地数据
            </Button>
            {parts.map((part, index) => (
              <span key={parts.slice(0, index + 1).join("/")}>
                <ChevronRight size={14} aria-hidden="true" />
                <Button
                  className="crumb"
                  onClick={() => navigate(parts.slice(0, index + 1).join("/"))}
                  aria-current={
                    index === parts.length - 1 ? "location" : undefined
                  }
                >
                  {part}
                </Button>
              </span>
            ))}
          </nav>
          <Button
            aria-label="刷新文件夹"
            title="刷新"
            disabled={!native || loading}
            onClick={() => navigate(path)}
            icon={RefreshCw}
            iconSize={16}
            iconClassName={loading && native ? "spin" : ""}
          ></Button>
        </div>
        <div className="browser-filter">
          <div className="file-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="搜索当前文件夹"
              placeholder="搜索当前文件夹"
              value={query}
              disabled={!native}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <Button
                type="button"
                className="search-clear"
                aria-label="清除搜索"
                onClick={() => setQuery("")}
                icon={X}
                iconSize={13}
              ></Button>
            )}
          </div>
          <select
            className="file-sort"
            aria-label="文件排序"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label === "名称"
                  ? "名称排序"
                  : label === "大小"
                    ? "大小排序"
                    : label}
              </option>
            ))}
          </select>
        </div>
        {!native ? (
          <EmptyState icon={HardDrive}>请在桌面应用中浏览本地文件。</EmptyState>
        ) : error ? (
          <EmptyState
            role="alert"
            action={<Button onClick={() => navigate(path)}>重试</Button>}
          >
            {error}
          </EmptyState>
        ) : loading ? (
          <div className="browser-skeleton" role="status">
            <span className="sr-only">正在读取文件夹…</span>
            {[0, 1, 2, 3, 4].map((row) => (
              <span key={row} aria-hidden="true" />
            ))}
          </div>
        ) : (
          <>
            {visible.length > 0 && (
              <div className="file-table-wrap">
                <table className="file-table">
                  <thead>
                    <tr>
                      <th scope="col">名称</th>
                      <th scope="col" className="col-size">
                        大小
                      </th>
                      <th scope="col" className="col-modified">
                        修改时间
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((entry) => {
                      const Icon = entryIcon(entry);
                      return (
                        <tr key={entry.path}>
                          <td>
                            <Button
                              disabled={
                                entry.kind !== "directory" &&
                                entry.kind !== "file"
                              }
                              title={
                                entry.kind === "link"
                                  ? "链接不可打开"
                                  : entry.name
                              }
                              onClick={() => {
                                if (entry.kind === "directory")
                                  navigate(entry.path);
                                else {
                                  setPreview("正在读取…");
                                  setSelected(entry);
                                }
                              }}
                            >
                              <span className="file-icon" aria-hidden="true">
                                <Icon size={16} strokeWidth={1.7} />
                              </span>
                              <span className="file-name">{entry.name}</span>
                              {entry.kind === "link" && <small>链接</small>}
                              {entry.kind === "directory" && (
                                <ChevronRight
                                  className="row-chevron"
                                  size={14}
                                  aria-hidden="true"
                                />
                              )}
                            </Button>
                          </td>
                          <td className="col-size">
                            {entry.kind === "file"
                              ? sizeLabel(entry.size)
                              : "—"}
                          </td>
                          <td className="col-modified">
                            {modifiedLabel(entry.modified)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!visible.length && (
              <EmptyState
                icon={query ? SearchX : FolderOpen}
                action={
                  query ? (
                    <Button onClick={() => setQuery("")}>清除搜索</Button>
                  ) : undefined
                }
              >
                {query ? "没有匹配的文件或文件夹" : "这个文件夹还是空的"}
              </EmptyState>
            )}
            <div className="browser-footer">
              <span>
                {query
                  ? `${visible.length} / ${entries.length}`
                  : entries.length}{" "}
                个项目
              </span>
              <span>点击文件夹进入 · 点击文件预览</span>
            </div>
          </>
        )}
      </section>
      <ConfirmationDialog
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSubmit={(event) => void transferData(event)}
        busy={transferring}
        blocked={blocked}
        phrase={phrase}
        value={confirmation}
        onChange={setConfirmation}
        titleId="transfer-title"
        warningId="transfer-warning"
        inputId="transfer-confirmation"
        className="transfer-dialog"
        actionsClassName="transfer-actions"
        header={
          <div className="transfer-heading">
            <span className="transfer-icon" aria-hidden="true">
              {transfer === "import" ? (
                <Upload size={20} />
              ) : (
                <Download size={20} />
              )}
            </span>
            <div>
              <h2 id="transfer-title">
                {transfer === "import" ? "从 ZIP 恢复数据" : "导出 ZIP 备份"}
              </h2>
              <p>
                {transfer === "import"
                  ? "使用备份替换本地数据"
                  : "将本地数据保存为备份文件"}
              </p>
            </div>
          </div>
        }
        warning={
          <>
            {transfer === "import"
              ? "导入会清理并替换当前角色、聊天、配置、启动设置和日志，同时清除本地运行副本。此操作不会合并数据，请先导出当前备份。只导入你信任的 25小厨备份，确认后选择 ZIP 文件。"
              : "ZIP 可能包含私人聊天、角色资料、账号信息、API 密钥和日志。备份不会自动脱敏，也没有加密，请妥善保管，勿直接公开分享。运行环境不包含在内，确认后选择保存位置。"}
          </>
        }
        warningClassName="transfer-notice"
        placeholder={phrase}
        actionClassName={transfer === "import" ? "danger-button" : "primary"}
        actionLabel={
          transferring
            ? "正在处理…"
            : transfer === "import"
              ? "选择 ZIP 并覆盖导入"
              : "选择位置并导出"
        }
      >
        {transferring && (
          <p role="status">请选择文件并等待处理完成，请勿关闭应用。</p>
        )}
      </ConfirmationDialog>
      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        className="file-preview"
        labelledBy="preview-title"
      >
        <div className="preview-heading">
          <h3 id="preview-title">{selected?.name}</h3>
          <Button
            aria-label="关闭预览"
            onClick={() => setSelected(null)}
            icon={X}
            iconSize={18}
          ></Button>
        </div>
        <p>文本预览 · {selected && sizeLabel(selected.size)}</p>
        <pre>{preview}</pre>
      </Dialog>
    </section>
  );
}
