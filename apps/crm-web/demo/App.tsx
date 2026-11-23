import { CRM } from "@/components/atomic-crm/root/CRM";
import type { AuthProvider } from "ra-core";
import {
  authProvider as fakeAuthProvider,
  dataProvider,
} from "@/components/atomic-crm/providers/fakerest";
import { StartPage } from "@/components/atomic-crm/login/StartPage";
import { memoryStore } from "ra-core";
import { ContactCard } from "./ContactCard";

// The public demo: the whole CRM in the browser on generated, fake data.
// Telemetry is off: BrokeCRM sends nothing to third parties.
// Leaving the demo leads back to the landing page. The demo has no real
// accounts, so its sign-in form (a fake email and password) is a dead end
// for a visitor; opening the demo again signs them back in as before.
const authProvider: AuthProvider = {
  ...fakeAuthProvider,
  logout: async (params) => {
    await fakeAuthProvider.logout(params);
    window.location.assign("/");
    // false: the app does not also navigate to its own sign-in page.
    return false;
  },
};

const App = () => (
  <>
    <CRM
      title="BrokeCRM"
      dataProvider={dataProvider}
      authProvider={authProvider}
      store={memoryStore()}
      loginPage={StartPage}
      disableTelemetry
    />
    <ContactCard />
  </>
);

export default App;
