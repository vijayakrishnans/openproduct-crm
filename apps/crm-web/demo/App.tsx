import { CRM } from "@/components/atomic-crm/root/CRM";
import {
  authProvider,
  dataProvider,
} from "@/components/atomic-crm/providers/fakerest";
import { StartPage } from "@/components/atomic-crm/login/StartPage";
import { memoryStore } from "ra-core";
import { ContactCard } from "./ContactCard";

// The public demo: the whole CRM in the browser on generated, fake data.
// Telemetry is off: BrokeCRM sends nothing to third parties.
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
