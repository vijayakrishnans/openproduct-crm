import { useEffect, useState, type FormEvent } from "react";
import { useLogin, useNotify } from "ra-core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notification } from "@/components/admin/notification";
import { useConfigurationContext } from "@/components/atomic-crm/root/ConfigurationContext.tsx";
import {
  completeLogin,
  createOrganization,
  listOrganizations,
  selectOrganization,
  startLogin,
  type LoginChallenge,
} from "../providers/lumen/authProvider";
import { clearSession, getSession, type Organization } from "../providers/lumen/client";

type Step =
  | { name: "email" }
  | { name: "code"; email: string; challenge: LoginChallenge }
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
    if (organizations.length === 1) return enter(organizations[0]!);
    setStep({ name: "organization", organizations });
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
                <a href="?demo" className="block text-sm text-center hover:underline">
                  Just looking? Try the demo, no account needed
                </a>
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
