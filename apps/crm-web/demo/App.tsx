import { useEffect, useState } from "react";
import { CRM } from "@/components/atomic-crm/root/CRM";
import {
  authProvider,
  dataProvider,
} from "@/components/atomic-crm/providers/fakerest";
import { StartPage } from "@/components/atomic-crm/login/StartPage";
import { defaultConfiguration } from "@/components/atomic-crm/root/defaultConfiguration";
import { memoryStore } from "ra-core";
import { applyBrandColor, readDemoBrand } from "./brand";
import { ContactCard } from "./ContactCard";

// The public demo: the whole CRM in the browser on generated, fake data.
// With a brand (see ./brand.ts) it wears the visitor's name, logo and colour
// instead of BrokeCRM's. Telemetry is off: BrokeCRM sends nothing to third
// parties.
const brand = readDemoBrand();

const title = brand?.name ?? defaultConfiguration.title;
const darkModeLogo = brand?.logo ?? defaultConfiguration.darkModeLogo;
const lightModeLogo = brand?.logo ?? defaultConfiguration.lightModeLogo;

// The app reads its name and logo from the demo's stored configuration, so
// the brand goes there before the app starts; Settings can still change it.
const ready = brand
  ? dataProvider
      .updateConfiguration({
        ...defaultConfiguration,
        title,
        darkModeLogo,
        lightModeLogo,
      })
      .catch(() => undefined)
  : Promise.resolve();

if (brand?.color) applyBrandColor(brand.color);
if (brand?.name) document.title = `${brand.name} · demo`;

const App = () => {
  const [isReady, setReady] = useState(!brand);
  useEffect(() => {
    void ready.then(() => setReady(true));
  }, []);
  if (!isReady) return null;
  return (
    <>
      <CRM
        title={title}
        darkModeLogo={darkModeLogo}
        lightModeLogo={lightModeLogo}
        dataProvider={dataProvider}
        authProvider={authProvider}
        store={memoryStore()}
        loginPage={StartPage}
        disableTelemetry
      />
      <ContactCard brandName={brand?.name} />
    </>
  );
};

export default App;
