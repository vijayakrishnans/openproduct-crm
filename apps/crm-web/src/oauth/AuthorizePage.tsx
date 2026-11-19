import { StrictMode, useEffect, useMemo, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  completeLogin,
  listOrganizations,
  startLogin,
  type LoginChallenge,
} from "@/components/atomic-crm/providers/lumen/authProvider";
import {
  api,
  clearSession,
  getSession,
  type Organization,
} from "@/components/atomic-crm/providers/lumen/client";

// The OAuth authorization endpoint of BrokeCRM's MCP server (RFC 6749 §3.1).
// An MCP client sends the person here; they sign in with their BrokeCRM
// account, pick the organization, and approve. The approval goes to the API
// (/v1/oauth/authorize), which returns where to send the browser with the
// code. Nothing redirects anywhere until the API has confirmed that the
// client and its redirect URI are registered.

type Params = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  scope: string;
  resource: string | null;
};

function readParams(): Params {
  const q = new URLSearchParams(window.location.search);
  return {
    responseType: q.get("response_type") ?? "",
    clientId: q.get("client_id") ?? "",
    redirectUri: q.get("redirect_uri") ?? "",
    codeChallenge: q.get("code_challenge") ?? "",
    codeChallengeMethod: q.get("code_challenge_method") ?? "S256",
    state: q.get("state"),
    scope: q.get("scope") ?? "crm",
    resource: q.get("resource"),
  };
}

function orgFromResource(resource: string | null): string | null {
  if (!resource) return null;
  try {
    return new URL(resource).pathname.match(/\/v1\/organizations\/(org_[0-9a-f]{32})\/crm/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Sends the browser back to the (already verified) client with an error. */
function returnError(params: Params, error: string, description: string) {
  const target = new URL(params.redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("error_description", description);
  if (params.state !== null) target.searchParams.set("state", params.state);
  window.location.assign(target.toString());
}

type Step =
  | { name: "checking" }
  | { name: "invalid"; message: string }
  | { name: "email" }
  | { name: "code"; email: string; challenge: LoginChallenge }
  | { name: "consent"; organizations: Organization[] }
  | { name: "redirecting" };

export const AuthorizePage = () => {
  const params = useMemo(readParams, []);
  const wantedOrg = orgFromResource(params.resource);
  const [clientName, setClientName] = useState("");
  const [step, setStep] = useState<Step>({ name: "checking" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [orgId, setOrgId] = useState("");

  const toConsent = async () => {
    const organizations = await listOrganizations();
    const choices = wantedOrg ? organizations.filter((o) => o.id === wantedOrg) : organizations;
    if (choices.length === 0) {
      setStep({
        name: "invalid",
        message: wantedOrg
          ? "This app asked for an organization you are not a member of. Sign in with the account that is."
          : "Your account has no organization yet. Create one in BrokeCRM first.",
      });
      return;
    }
    setOrgId(choices[0]!.id);
    setStep({ name: "consent", organizations: choices });
  };

  useEffect(() => {
    (async () => {
      if (!params.clientId || !params.redirectUri) {
        setStep({ name: "invalid", message: "The link is missing the app's details. Start again from the app." });
        return;
      }
      try {
        const data = await api<{ client: { name: string } }>(
          "GET",
          `/v1/oauth/clients/${encodeURIComponent(params.clientId)}`,
          { query: { redirect_uri: params.redirectUri }, anonymous: true },
        );
        setClientName(data.client.name);
      } catch {
        setStep({ name: "invalid", message: "This app is not registered with BrokeCRM, or its return address is not." });
        return;
      }
      // The client is known: from here on, problems go back to it.
      if (params.responseType !== "code") {
        returnError(params, "unsupported_response_type", "Only response_type=code is supported");
        return;
      }
      if (!params.codeChallenge || params.codeChallengeMethod !== "S256") {
        returnError(params, "invalid_request", "PKCE with S256 is required");
        return;
      }
      if (!getSession()) {
        setStep({ name: "email" });
        return;
      }
      await toConsent().catch(() => {
        clearSession();
        setStep({ name: "email" });
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (task: () => Promise<void>) => (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    task()
      .catch((e: unknown) => setError((e as Error)?.message || "Something went wrong"))
      .finally(() => setBusy(false));
  };

  const submitEmail = run(async () => {
    const challenge = await startLogin(email.trim());
    setCode(challenge.debugCode ?? "");
    setStep({ name: "code", email: email.trim(), challenge });
  });

  const submitCode = run(async () => {
    if (step.name !== "code") return;
    await completeLogin(step.challenge.challengeId, code.trim());
    await toConsent();
  });

  const approve = run(async () => {
    try {
      const data = await api<{ redirectTo: string }>("POST", "/v1/oauth/authorize", {
        body: {
          response_type: "code",
          client_id: params.clientId,
          redirect_uri: params.redirectUri,
          code_challenge: params.codeChallenge,
          code_challenge_method: params.codeChallengeMethod,
          state: params.state ?? undefined,
          scope: params.scope,
          resource: params.resource ?? undefined,
          org_id: orgId,
        },
      });
      setStep({ name: "redirecting" });
      window.location.assign(data.redirectTo);
    } catch (e) {
      if ((e as { status?: number })?.status === 401) {
        clearSession();
        setStep({ name: "email" });
        throw new Error("Your session ended. Sign in again.");
      }
      throw e;
    }
  });

  const deny = () => {
    setStep({ name: "redirecting" });
    returnError(params, "access_denied", "The user declined access");
  };

  const signedInAs = getSession()?.email;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-muted-foreground">BrokeCRM</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {step.name === "consent" ? `Allow ${clientName} to use your CRM?` : "Connect an app to BrokeCRM"}
          </h1>
        </div>

        {step.name === "checking" || step.name === "redirecting" ? (
          <p className="text-center text-sm text-muted-foreground">
            {step.name === "checking" ? "Checking the app…" : "Returning to the app…"}
          </p>
        ) : null}

        {step.name === "invalid" ? (
          <p role="alert" className="text-center text-sm">
            {step.message}
          </p>
        ) : null}

        {step.name === "email" ? (
          <form className="space-y-4" onSubmit={submitEmail}>
            <p className="text-sm text-muted-foreground text-center">
              {clientName} wants to connect to BrokeCRM. Sign in to choose what it can reach.
            </p>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              Send code
            </Button>
          </form>
        ) : null}

        {step.name === "code" ? (
          <form className="space-y-4" onSubmit={submitCode}>
            <p className="text-sm text-muted-foreground text-center">
              {step.challenge.debugCode
                ? "This environment shows the code instead of emailing it."
                : `We sent a code to ${step.challenge.emailHint ?? step.email}.`}
            </p>
            <div className="space-y-2">
              <Label htmlFor="code">Sign-in code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              Sign in
            </Button>
          </form>
        ) : null}

        {step.name === "consent" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {clientName} will act as you{signedInAs ? ` (${signedInAs})` : ""} in this organization's CRM: it can
              read and change contacts, companies, deals, notes and tasks. It cannot delete anything, and it loses
              access if you leave the organization.
            </p>
            <p className="text-sm text-muted-foreground">
              Afterwards you go back to <strong>{new URL(params.redirectUri).host}</strong>. Only allow apps you
              started connecting yourself.
            </p>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-1">Organization</legend>
              {step.organizations.map((org) => (
                <label key={org.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="organization"
                    value={org.id}
                    checked={orgId === org.id}
                    onChange={() => setOrgId(org.id)}
                  />
                  {org.name}
                </label>
              ))}
            </fieldset>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={deny}>
                Deny
              </Button>
              <Button type="button" className="flex-1" disabled={busy || !orgId} onClick={() => approve()}>
                Allow
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export function mountAuthorizePage(element: HTMLElement) {
  createRoot(element).render(
    <StrictMode>
      <AuthorizePage />
    </StrictMode>,
  );
}
