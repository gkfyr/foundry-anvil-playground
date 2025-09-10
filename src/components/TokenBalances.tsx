"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RpcRequest = { jsonrpc: "2.0"; id: number; method: string; params: unknown[] };
type RpcResponse<T> = { jsonrpc: "2.0"; id: number; result?: T; error?: { code: number; message: string } };

const RPC_URL: string = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

type TokenMeta = {
  address: string;
  symbol: string;
  decimals: number;
};

type StoredToken = TokenMeta;

const STORAGE_KEY = "erc20_tokens";

function isAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

async function rpcCall<T = string>(method: string, params: unknown[]): Promise<T> {
  const req: RpcRequest = { jsonrpc: "2.0", id: Date.now(), method, params };
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`RPC HTTP error ${res.status}`);
  const body: RpcResponse<T> = await res.json();
  if (body.error) throw new Error(body.error.message);
  if (body.result === undefined) throw new Error("Empty RPC result");
  return body.result;
}

function pad32(hexNo0x: string): string {
  return hexNo0x.padStart(64, "0");
}

function encodeBalanceOf(address: string): string {
  const selector = "70a08231"; // keccak256("balanceOf(address)").slice(2, 10)
  const addr = address.toLowerCase().replace(/^0x/, "");
  return "0x" + selector + pad32(addr);
}

function encodeDecimals(): string {
  return "0x313ce567"; // decimals()
}

function encodeSymbol(): string {
  return "0x95d89b41"; // symbol()
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

function tryDecodeStringFromAbi(hex: string): string | null {
  // Attempt dynamic string decode per ABI
  if (!hex || !hex.startsWith("0x")) return null;
  const data = hex.slice(2);
  try {
    if (data.length === 64) {
      // Some tokens return bytes32 for symbol
      const bytes = data;
      const arr: number[] = [];
      for (let i = 0; i < 64; i += 2) {
        const byteHex = bytes.slice(i, i + 2);
        const v = parseInt(byteHex, 16);
        if (v === 0) break;
        arr.push(v);
      }
      return String.fromCharCode(...arr) || null;
    }

    // Dynamic string: [offset][length][data...]
    const offset = Number(BigInt("0x" + data.slice(0, 64)));
    const len = Number(BigInt("0x" + data.slice(64, 128)));
    const start = 128;
    const bytesHex = data.slice(start, start + len * 2);
    const arr: number[] = [];
    for (let i = 0; i < bytesHex.length; i += 2) {
      arr.push(parseInt(bytesHex.slice(i, i + 2), 16));
    }
    return String.fromCharCode(...arr);
  } catch {
    return null;
  }
}

async function getTokenMeta(address: string): Promise<TokenMeta> {
  // decimals
  const decimalsHex = await rpcCall<string>("eth_call", [
    { to: address, data: encodeDecimals() },
    "latest",
  ]);
  const decimals = Number(hexToBigInt(decimalsHex));

  // symbol
  let symbol = "?";
  try {
    const symbolRes = await rpcCall<string>("eth_call", [
      { to: address, data: encodeSymbol() },
      "latest",
    ]);
    const s = tryDecodeStringFromAbi(symbolRes);
    if (s) symbol = s;
  } catch {
    symbol = "?";
  }

  return { address, symbol, decimals: Number.isFinite(decimals) ? decimals : 18 };
}

async function getTokenBalance(token: string, wallet: string): Promise<bigint> {
  const data = encodeBalanceOf(wallet);
  const res = await rpcCall<string>("eth_call", [
    { to: token, data },
    "latest",
  ]);
  return hexToBigInt(res);
}

function formatUnits(wei: bigint, decimals: number): string {
  if (decimals <= 0) return wei.toString();
  const base = 10n ** BigInt(decimals);
  const whole = wei / base;
  const frac = wei % base;
  const fracStr = frac.toString().padStart(decimals, "0");
  // Trim trailing zeros for readability
  const trimmed = fracStr.replace(/0+$/g, "");
  return trimmed.length ? `${whole.toString()}.${trimmed}` : whole.toString();
}

export default function TokenBalances() {
  const [tokenInput, setTokenInput] = useState<string>("");
  const [tokens, setTokens] = useState<StoredToken[]>([]);
  const [activeAddr, setActiveAddr] = useState<string | null>(null);
  const [walletByToken, setWalletByToken] = useState<Record<string, string>>({});
  const [balances, setBalances] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Load tokens from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setTokens(JSON.parse(raw));
    } catch {}
  }, []);

  // Persist tokens
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } catch {}
  }, [tokens]);

  const activeWallet = activeAddr ? (walletByToken[activeAddr] || "") : "";
  const validWallet = useMemo(() => isAddress(activeWallet), [activeWallet]);

  const addToken = useCallback(async () => {
    setError(null);
    const addr = tokenInput.trim();
    if (!isAddress(addr)) {
      setError("올바른 토큰 주소가 아닙니다 (0x + 40 hex)");
      return;
    }
    if (tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase())) {
      setError("이미 등록된 토큰입니다");
      return;
    }
    try {
      setLoadingToken(true);
      const meta = await getTokenMeta(addr);
      setTokens((prev) => [...prev, meta]);
      setTokenInput("");
      setActiveAddr(meta.address);
    } catch (e: any) {
      setError(e?.message || "토큰 메타데이터 조회 실패");
    } finally {
      setLoadingToken(false);
    }
  }, [tokenInput, tokens]);

  const removeToken = useCallback((addr: string) => {
    setTokens((prev) => prev.filter((t) => t.address.toLowerCase() !== addr.toLowerCase()));
    setBalances((prev) => {
      const n = { ...prev };
      delete n[addr.toLowerCase()];
      return n;
    });
    setWalletByToken((prev) => {
      const n = { ...prev } as Record<string, string>;
      delete n[addr];
      return n;
    });
    setActiveAddr((cur) => (cur && cur.toLowerCase() === addr.toLowerCase() ? null : cur));
  }, []);

  const refresh = useCallback(async () => {
    let cancelled = false;
    setIsRefreshing(true);
    try {
      // Per-tab refresh: only active token's balance
      if (!activeAddr) return;
      const meta = tokens.find((t) => t.address.toLowerCase() === activeAddr.toLowerCase());
      if (!meta) return;
      if (!validWallet) {
        setBalances((prev) => ({ ...prev, [activeAddr.toLowerCase()]: null }));
        setUpdatedAt(Date.now());
        return;
      }
      try {
        const raw = await getTokenBalance(meta.address, activeWallet);
        const formatted = formatUnits(raw, meta.decimals);
        if (!cancelled) {
          setBalances((prev) => ({ ...prev, [meta.address.toLowerCase()]: formatted }));
          setUpdatedAt(Date.now());
        }
      } catch {
        if (!cancelled) {
          setBalances((prev) => ({ ...prev, [meta.address.toLowerCase()]: null }));
          setUpdatedAt(Date.now());
        }
      }
    } finally {
      if (!cancelled) setIsRefreshing(false);
    }
    return () => {
      cancelled = true;
    };
  }, [tokens, validWallet, activeWallet, activeAddr]);

  // Auto refresh when dependencies change
  useEffect(() => {
    // Ensure active tab stays valid
    if (!activeAddr && tokens.length > 0) {
      setActiveAddr(tokens[0].address);
    } else if (activeAddr && !tokens.find((t) => t.address.toLowerCase() === activeAddr.toLowerCase())) {
      setActiveAddr(tokens[0]?.address ?? null);
    }
  }, [tokens, activeAddr]);

  // Auto refresh on active token or its wallet change
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">ERC-20 Balances</h2>
      <div className="text-xs text-gray-500">RPC: {RPC_URL}</div>

      <div className="flex gap-2 items-center">
        <input
          className="flex-1 rounded border px-3 py-2 font-mono text-sm"
          placeholder="ERC-20 토큰 주소 (0x...)"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value.trim())}
        />
        <button
          onClick={addToken}
          disabled={loadingToken}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {loadingToken ? "등록 중..." : "토큰 등록"}
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}

      {/* Tabs */}
      <div className="overflow-x-auto">
        <div className="flex items-center gap-2">
          {tokens.map((t) => {
            const isActive = activeAddr && t.address.toLowerCase() === activeAddr.toLowerCase();
            return (
              <button
                key={t.address}
                onClick={() => setActiveAddr(t.address)}
                className={`px-3 py-1 rounded border text-sm whitespace-nowrap transition-colors ${
                  isActive ? "bg-black text-white" : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                }`}
              >
                {t.symbol || "TOKEN"}
              </button>
            );
          })}
        </div>
      </div>

      {tokens.length === 0 && (
        <div className="rounded border px-4 py-3 text-sm text-gray-500">등록된 토큰이 없습니다</div>
      )}

      {activeAddr && (
        (() => {
          const t = tokens.find((x) => x.address.toLowerCase() === activeAddr.toLowerCase());
          if (!t) return null;
          const bal = balances[t.address.toLowerCase()];
          const walletVal = walletByToken[t.address] || "";
          return (
            <div className="space-y-3 rounded border p-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.symbol} · {t.address}</div>
                  <div className="text-xs text-gray-500">decimals: {t.decimals}</div>
                </div>
                <button onClick={() => removeToken(t.address)} className="rounded border px-2 py-1 text-xs">삭제</button>
              </div>

              <div className="flex gap-2 items-center">
                <input
                  className="flex-1 rounded border px-3 py-2 font-mono text-sm"
                  placeholder="지갑 주소 (0x...)"
                  value={walletVal}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setWalletByToken((prev) => ({ ...prev, [t.address]: v }));
                  }}
                />
                {!validWallet && walletVal && (
                  <span className="text-xs text-red-600">주소 형식이 올바르지 않습니다</span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={refresh}
                  disabled={isRefreshing}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                >
                  {isRefreshing ? "새로고침 중..." : "잔고 새로고침"}
                </button>
                {updatedAt && (
                  <span className="text-xs text-gray-500">업데이트: {new Date(updatedAt).toLocaleTimeString()}</span>
                )}
              </div>

              <div className="tabular-nums font-mono">
                {validWallet ? (bal == null ? "N/A" : `${bal} ${t.symbol || "TOKEN"}`) : "지갑 주소 필요"}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
