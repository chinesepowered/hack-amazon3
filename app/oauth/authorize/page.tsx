import { SCOPES } from "@/lib/oauth";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

export default async function Authorize({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const val = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const fields = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource"];
  const scopes = (val("scope") || SCOPES.join(" ")).split(" ");
  const labels: Record<string, string> = { "refill.read": "See supply levels and prescriptions at Walter’s house", "refill.order": "Draft orders and refill requests for you to approve" };

  return (
    <main className="min-h-screen grid place-items-center bg-[#f4ede2] p-6" data-testid="consent">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-xl border border-[#eadfcc] p-8">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-[#1d5c58] text-white grid place-items-center font-serif text-xl">R</div>
          <div>
            <div className="font-serif text-2xl text-[#2a2119]">Link Refill</div>
            <div className="text-sm text-[#7c6c5c]">to your Alexa+ display</div>
          </div>
        </div>
        <p className="mt-6 text-[15px] text-[#2a2119]">Refill is asking to connect to the account for <b>Walter’s house</b> (demo household, all data fictional).</p>
        <ul className="mt-4 space-y-2">
          {scopes.map((s) => (
            <li key={s} className="flex gap-2 text-[14px] text-[#2a2119]">
              <span className="text-[#1d5c58]">✓</span>
              {labels[s] ?? s}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-[#7c6c5c]">Nothing is purchased or requested without your confirmation. OAuth 2.1 authorization code with PKCE (S256).</p>
        <form method="post" action="/api/oauth/approve" className="mt-6 flex gap-3">
          {fields.map((f) => (
            <input key={f} type="hidden" name={f} value={val(f)} />
          ))}
          <button type="submit" data-testid="approve-link" className="flex-1 rounded-xl bg-[#1d5c58] py-3 font-semibold text-white">
            Allow
          </button>
          <a href="/" className="flex-1 rounded-xl border border-[#eadfcc] py-3 text-center font-semibold text-[#7c6c5c]">
            Cancel
          </a>
        </form>
      </div>
    </main>
  );
}
