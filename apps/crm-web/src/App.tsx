import { CRM } from "@/components/atomic-crm/root/CRM";

// The CRM on the Lumen API: sign in with an email code, work in one
// organization. Data and auth providers default to the Lumen ones.
// Telemetry is off: OpenProduct CRM sends nothing to third parties.
const App = () => <CRM title="OpenProduct CRM" disableTelemetry />;

export default App;
