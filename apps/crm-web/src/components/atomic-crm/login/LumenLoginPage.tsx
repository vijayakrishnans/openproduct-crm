import { useEffect, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { useLogin, useNotify } from "ra-core";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notification } from "@/components/admin/notification";
import { useConfigurationContext } from "@/components/atomic-crm/root/ConfigurationContext.tsx";
import {
  acceptPendingInvitation,
  completeLogin,
  createOrganization,
  listOAuthProviders,
  listOrganizations,
  listPendingInvitations,
  oauthStartUrl,
  selectOrganization,
  startLogin,
  takeOAuthError,
  type LoginChallenge,
  type OAuthProvider,
  type PendingInvitation,
} from "../providers/lumen/authProvider";
import { clearSession, getSession, type Organization } from "../providers/lumen/client";

type Step =
  | { name: "email" }
  | { name: "code"; email: string; challenge: LoginChallenge }
  | { name: "invitations"; invitations: PendingInvitation[]; organizations: Organization[] }
  | { name: "organization"; organizations: Organization[] };

/**
 * Sign-in for BrokeCRM. Accounts are Lumen identities, so there is no
 * password and no separate sign-up: enter an email, enter the code sent to
 * it, then pick the organization to work in (or name a new one).
 */
export const LumenLoginPage = () => {
  const { darkModeLogo, title } = useConfigurationContext();
  const login = useLogin();
  const notify = useNotify();
  const [step, setStep] = useState<Step>({ name: "email" });
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [orgName, setOrgName] = useState("");
  const [providers, setProviders] = useState<OAuthProvider[]>([]);

  useEffect(() => {
    let live = true;
    void listOAuthProviders().then((list) => live && setProviders(list));
    const failed = takeOAuthError();
    if (failed) notify(failed, { type: "error" });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fail = (error: unknown) => {
    notify((error as Error)?.message || "ra.auth.sign_in_error", { type: "error" });
  };

  const enter = async (org: Organization) => {
    selectOrganization(org);
    await login({});
  };

  // After the code (or on return with a live session): go straight in when
  // the org is known, otherwise ask.
  const chooseOrganization = async () => {
    const organizations = await listOrganizations();
    const wanted = new URLSearchParams(window.location.search).get("org");
    const match = organizations.find((o) => o.id === wanted || o.slug === wanted);
    if (match) return enter(match);
    // An invitation is worth a stop, but must never get in the way of signing in.
    const invitations = await listPendingInvitations().catch(() => []);
    if (invitations.length > 0) {
      setStep({ name: "invitations", invitations, organizations });
      return;
    }
    await continueWith(organizations);
  };

  const continueWith = async (organizations: Organization[]) => {
    if (organizations.length === 1) return enter(organizations[0]!);
    setStep({ name: "organization", organizations });
  };

  const join = async (invitation: PendingInvitation) => {
    await acceptPendingInvitation(invitation);
    await enter(invitation.organization);
  };

  const act = (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    task()
      .catch(fail)
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    const session = getSession();
    if (!session || session.orgId) return;
    setBusy(true);
    chooseOrganization()
      .catch(() => clearSession())
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (task: () => Promise<void>) => (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    task()
      .catch(fail)
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
    await chooseOrganization();
  });

  const submitOrganization = run(async () => {
    const org = await createOrganization(orgName.trim());
    await enter(org);
  });

  return (
    <div className="min-h-screen flex">
      <div className="relative grid w-full lg:grid-cols-2">
        <div className="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">
          <div className="absolute inset-0 bg-zinc-900" />
          <div className="relative z-20 flex items-center text-lg font-medium">
            <img className="h-6 mr-2" src={darkModeLogo} alt={title} />
            {title}
          </div>
          {/* What the visitor is about to get into. A heading of level 2: the
              page's own heading is the form's. */}
          <div className="relative z-20 my-auto max-w-lg py-10">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">
              The CRM for teams with no CRM budget.
            </h2>
            <p className="mt-4 text-lg text-zinc-300">
              Your people, your pipeline and your follow-ups in one place, for the whole team.
            </p>
            <ul className="mt-8 space-y-3 text-zinc-200">
              {[
                "Free to use. No card, no trial clock.",
                "Open source under Apache 2.0, so you can read the code or run your own.",
                "Hosted for you. Nothing to install.",
              ].map((point) => (
                <li key={point} className="flex gap-3">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <div className="mt-10 overflow-hidden rounded-xl border border-white/10 shadow-2xl [@media(max-height:900px)]:hidden">
              <img
                src="./img/board.jpg"
                alt="A pipeline board: cards in columns from first contact to won."
                width={1280}
                height={760}
                loading="lazy"
                className="block h-auto w-full"
              />
            </div>
          </div>
          <p className="relative z-20 text-sm text-zinc-400">
            Built on{" "}
            <a
              href="https://github.com/marmelab/atomic-crm"
              className="underline underline-offset-2 hover:text-zinc-200"
            >
              Atomic CRM
            </a>
            . The code is on{" "}
            <a
              href="https://github.com/vijayakrishnans/openproduct-crm"
              className="underline underline-offset-2 hover:text-zinc-200"
            >
              GitHub
            </a>
            .
          </p>
        </div>
        <div className="flex flex-col justify-center w-full p-4 lg:p-8">
          <div className="w-full space-y-6 lg:mx-auto lg:w-[350px]">
            {step.name === "email" ? (
              <form className="space-y-6" onSubmit={submitEmail}>
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
                  <p className="text-sm text-muted-foreground">
                    Enter your email and we will send you a sign-in code. New here? The same
                    form creates your account.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full cursor-pointer" disabled={busy}>
                  Send code
                </Button>
                {providers.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      or
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    {providers.map((provider) => (
                      // a plain link: starting a provider sign-in is a page navigation
                      <a
                        key={provider.id}
                        href={oauthStartUrl(provider.id)}
                        className={buttonVariants({ variant: "outline", className: "w-full" })}
                      >
                        Continue with {provider.displayName}
                      </a>
                    ))}
                  </div>
                ) : null}
                <a href="?demo" className="block text-sm text-center hover:underline">
                  Just looking? Try the demo, no account needed
                </a>
                <p className="text-xs text-center text-muted-foreground">
                  By signing in you agree to the{" "}
                  <a href="/terms.html" className="underline underline-offset-2">
                    terms
                  </a>{" "}
                  and the{" "}
                  <a href="/privacy.html" className="underline underline-offset-2">
                    privacy policy
                  </a>
                  .
                </p>
              </form>
            ) : null}

            {step.name === "code" ? (
              <form className="space-y-6" onSubmit={submitCode}>
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight">Enter your code</h1>
                  <p className="text-sm text-muted-foreground">
                    {step.challenge.debugCode
                      ? "This environment shows the code instead of emailing it."
                      : `We sent a code to ${step.challenge.emailHint ?? step.email}.`}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">Sign-in code</Label>
                  <Input
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full cursor-pointer" disabled={busy}>
                  Sign in
                </Button>
                <button
                  type="button"
                  className="block w-full text-sm text-center hover:underline cursor-pointer"
                  onClick={() => setStep({ name: "email" })}
                >
                  Use a different email
                </button>
              </form>
            ) : null}

            {step.name === "invitations" ? (
              <div className="space-y-6">
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight">You have been invited</h1>
                  <p className="text-sm text-muted-foreground">
                    Join an organization to work with its members.
                  </p>
                </div>
                <ul className="space-y-2">
                  {step.invitations.map((invitation) => (
                    <li key={invitation.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-sm">
                        <span className="block truncate font-medium">{invitation.organization.name}</span>
                        <span className="text-muted-foreground">as {invitation.role}</span>
                      </span>
                      <Button
                        type="button"
                        className="cursor-pointer"
                        disabled={busy}
                        aria-label={`Join ${invitation.organization.name}`}
                        onClick={() => act(() => join(invitation))}
                      >
                        Join
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full cursor-pointer"
                  disabled={busy}
                  onClick={() => act(() => continueWith(step.organizations))}
                >
                  Not now
                </Button>
              </div>
            ) : null}

            {step.name === "organization" ? (
              <div className="space-y-6">
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {step.organizations.length > 0 ? "Choose an organization" : "Name your organization"}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Contacts, companies and deals belong to an organization and are shared with
                    its members only.
                  </p>
                </div>
                {step.organizations.length > 0 ? (
                  <ul className="space-y-2">
                    {step.organizations.map((org) => (
                      <li key={org.id}>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-start cursor-pointer"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            enter(org)
                              .catch(fail)
                              .finally(() => setBusy(false));
                          }}
                        >
                          {org.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <form className="space-y-2" onSubmit={submitOrganization}>
                  <Label htmlFor="organization">
                    {step.organizations.length > 0 ? "Or create a new one" : "Organization name"}
                  </Label>
                  <Input
                    id="organization"
                    name="organization"
                    required
                    minLength={2}
                    maxLength={80}
                    autoFocus={step.organizations.length === 0}
                    value={orgName}
                    onChange={(event) => setOrgName(event.target.value)}
                  />
                  <Button type="submit" className="w-full cursor-pointer" disabled={busy}>
                    Create organization
                  </Button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <Notification />
    </div>
  );
};
