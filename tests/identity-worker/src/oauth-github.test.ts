import { githubProvider } from "../../../apps/identity-worker/src/oauth/github";

describe("github provider", () => {
  it("builds an authorize URL that always shows the account picker", () => {
    const url = new URL(
      githubProvider.buildAuthorizeUrl({
        clientId: "Ov23example",
        redirectUri: "https://api.example.com/v1/auth/oauth/github/callback",
        state: "signed-state",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Ov23example");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.example.com/v1/auth/oauth/github/callback");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(url.searchParams.get("state")).toBe("signed-state");
    // Without this, a returning user already signed in to GitHub is sent
    // straight back with no screen.
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });
});
