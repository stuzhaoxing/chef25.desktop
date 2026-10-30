export type Quota = {
  occupied: number;
  limit: number;
  remaining: number;
};
export type RemoteCapacity = {
  state: "idle" | "busy" | "full" | "unknown";
  checkedAt: string;
  inventory: null | {
    tunnels: Quota;
    dns: Quota;
    checkedAt: string;
  };
  inventoryError: string | null;
  api: {
    used: number;
    limit: number;
    remaining: number;
    windowSeconds: number;
    nextRecoverySeconds: number;
  };
};

function UsageBar({
  label,
  used,
  limit,
  remaining,
}: {
  label: string;
  used: number;
  limit: number;
  remaining: number;
}) {
  const level = used >= limit ? "full" : used >= limit * 0.8 ? "busy" : "idle";
  return (
    <div className={`remote-quota-item remote-quota-${level}`}>
      <div className="remote-quota-label">
        <span>{label}</span>
        <span>
          已用 {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <progress
        aria-label={label}
        aria-valuetext={`已用 ${used}，上限 ${limit}，剩余 ${remaining}`}
        max={limit}
        value={Math.min(used, limit)}
      />
      <span className="remote-quota-remaining">
        剩余 {remaining.toLocaleString()}
      </span>
    </div>
  );
}
export default function RemoteQuota({
  value,
  loading,
}: {
  value: RemoteCapacity | null;
  loading: boolean;
}) {
  return (
    <div className="remote-quota">
      <div className="remote-quota-heading">
        <span>管理请求额度 · 全体用户共享</span>
        {value && (
          <span>
            更新于{" "}
            {new Date(value.checkedAt).toLocaleTimeString("zh-CN", {
              hour12: false,
            })}
          </span>
        )}
      </div>
      {value ? (
        <>
          <UsageBar
            label="近 5 分钟管理请求"
            used={value.api.used}
            limit={value.api.limit}
            remaining={value.api.remaining}
          />
          <p className="remote-quota-note">
            远程访问使用 Cloudflare
            免费通道，管理请求额度由所有用户共享。每笔用量在 5
            分钟后自动恢复，聊天、手机刷新和连接续期不占用此额度。额度用满时，申请或关闭远程访问可能需要等待额度恢复。
          </p>
        </>
      ) : (
        <p className="remote-quota-note" role="status">
          {loading ? "正在查询共享额度…" : "暂时无法查询额度，稍后自动重试。"}
        </p>
      )}
    </div>
  );
}
