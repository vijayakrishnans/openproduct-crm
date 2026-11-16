import { CRM } from "@/components/atomic-crm/root/CRM";
import {
  authProvider,
  dataProvider,
} from "@/components/atomic-crm/providers/fakerest";
import { memoryStore } from "ra-core";

// The public demo: the whole CRM in the browser on generated, fake data.
// Telemetry is off: OpenProduct CRM sends nothing to third parties.
const App = () => (
  <CRM
    title="OpenProduct CRM"
    dataProvider={dataProvider}
    authProvider={authProvider}
    store={memoryStore()}
    disableTelemetry
  />
);

export default App;
