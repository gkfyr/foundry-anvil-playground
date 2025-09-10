import TokenBalances from "@/components/TokenBalances";
import RefreshPageButton from "@/components/RefreshPageButton";
import NFTBalances from "@/components/NFTBalances";

const ADDRESSES: string[] = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
];

const RPC_URL = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

type RpcRequest = { jsonrpc: "2.0"; id: number; method: string; params: unknown[] };
type RpcResponse<T> = { jsonrpc: "2.0"; id: number; result?: T; error?: { code: number; message: string } };

async function fetchBalances(addresses: string[]): Promise<(bigint | null)[]> {
  const reqs: RpcRequest[] = addresses.map((addr, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: "eth_getBalance",
    params: [addr, "latest"],
  }));

  try {
    const res = await fetch(RPC_URL!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqs),
      // Avoid caching between dev HMR reloads
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`RPC HTTP error: ${res.status}`);
    const data: RpcResponse<string>[] = await res.json();

    // Ensure we map back in the same order by id
    const byId = new Map<number, RpcResponse<string>>();
    for (const r of data) byId.set(r.id, r);

    return reqs.map((r) => {
      const resp = byId.get(r.id);
      if (!resp) return null;
      if (resp.error) return null;
      const hex = resp.result as string | undefined;
      if (!hex) return null;
      try {
        return BigInt(hex);
      } catch {
        return null;
      }
    });
  } catch (e) {
    // If Anvil isn't running or RPC is unreachable, return nulls
    return addresses.map(() => null);
  }
}

function formatEtherFixed18(wei: bigint): string {
  const base = BigInt(10) ** BigInt(18);
  const whole = wei / base;
  const frac = wei % base;
  const fracStr = frac.toString().padStart(18, "0");
  return `${whole.toString()}.${fracStr}`;
}

export default async function Home() {
  const balances = await fetchBalances(ADDRESSES);

  return (
    <div className="p-6 space-y-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">ETH Balances (Anvil)</h1>
        {/* Client button to refresh server-rendered balances */}
        <RefreshPageButton />
      </div>
      <div className="text-sm text-gray-500">RPC: {RPC_URL}</div>
      <ul className="divide-y rounded border">
        {ADDRESSES.map((addr, i) => {
          const wei = balances[i];
          const display = wei == null ? "N/A" : `${formatEtherFixed18(wei)} ETH`;
          return (
            <li key={addr} className="flex items-center justify-between px-4 py-3">
              <div className="font-mono">
                ({i}) {addr}
              </div>
              <div className="tabular-nums font-mono">{display}</div>
            </li>
          );
        })}
      </ul>
      {balances.every((b) => b === null) && (
        <div className="text-red-600">Could not reach Anvil at {RPC_URL}. Is it running?</div>
      )}

      <hr className="my-6" />
      {/* ERC-20 section */}
      <TokenBalances />

      <hr className="my-6" />
      {/* ERC-721 section */}
      <NFTBalances />
    </div>
  );
}
