import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import {
  useConfigurationUpdater,
  type ConfigurationContextValue,
} from "./ConfigurationContext";
import { defaultConfiguration } from "./defaultConfiguration";

export const useConfigurationLoader = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const updateConfiguration = useConfigurationUpdater();

  const { data } = useQuery<ConfigurationContextValue>({
    queryKey: ["configuration"],
    queryFn: () => dataProvider.getConfiguration(),
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false,
  });

  useEffect(() => {
    // Each organization has its own configuration. One that never saved any
    // must show the defaults, not what the previous organization left behind.
    if (data) updateConfiguration({ ...defaultConfiguration, ...data });
  }, [data, updateConfiguration]);
};
