const SOURCES = [
  ["workshop", "https://dsh-plugin.github.io/data/plugins.json", "创意工坊"],
  ["market", "https://dshmarket.com/index.json", "dshmarket"],
  ["awesome", "https://awesome-dsh-plugin.com/plugins.json", "awesome"],
  ["dshso", "https://cdn.dsh.so/plugins-index.json", "dsh.so"],
];

let controller = null;

function normTag(value) {
  return String(value || "").replace(/^W\//, "");
}

export function changedStamp(local, remote) {
  if (!local) return false;
  if (remote.modified && local.modified) return remote.modified !== local.modified;
  if (remote.etag && local.etag) return normTag(remote.etag) !== normTag(local.etag);
  if (remote.bytes && local.bytes) return Number(remote.bytes) !== Number(local.bytes);
  return false;
}

export function cancelPull() {
  controller?.abort();
}

export async function pullLive(onStatus) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const { mergeRecords } = await import("./engine/merge.js?v=20261029zk");
  const { fromDsh, fromAwesome, fromMarket, fromWorkshop } = await import("./engine/sources.js?v=20261029zk");
  const make = { dshso: fromDsh, awesome: fromAwesome, market: fromMarket, workshop: fromWorkshop };
  onStatus?.("正在同时读取四个源站…");
  const loaded = await Promise.all(SOURCES.map(async ([key, url, label]) => {
    const response = await fetch(url, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`${label} ${response.status}`);
    return {
      key,
      stamp: {
        etag: response.headers.get("etag"),
        bytes: Number(response.headers.get("content-length") || 0) || null,
        modified: response.headers.get("last-modified"),
      },
      data: await response.json(),
    };
  }));
  const records = [];
  const stamps = {};
  for (const { key, stamp, data } of loaded) {
    stamps[key] = stamp;
    for (const plugin of data.plugins || []) {
      const record = make[key](plugin);
      if (record) records.push(record);
    }
  }
  onStatus?.(`正在合并 ${records.length.toLocaleString("zh-CN")} 条…`);
  const items = mergeRecords(records);
  controller = null;
  return { items, stamps };
}

export async function probeSources(upstream) {
  const changed = [];
  await Promise.all(SOURCES.map(async ([key, url, label]) => {
    const local = upstream?.[key];
    if (!local) return;
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!response.ok) return;
      const remote = {
        etag: response.headers.get("etag"),
        bytes: Number(response.headers.get("content-length") || 0) || null,
        modified: response.headers.get("last-modified"),
      };
      if (changedStamp(local, remote)) changed.push(label);
    } catch {
      // A failed check is not an update.
    }
  }));
  return changed;
}
