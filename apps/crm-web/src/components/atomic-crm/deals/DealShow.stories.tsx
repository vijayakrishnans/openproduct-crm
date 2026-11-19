import type { Meta } from "@storybook/react-vite";
import { ResourceContextProvider } from "ra-core";

import { DealShow } from "./DealShow";

import { StoryWrapper, buildCompany, buildDeal } from "@/test/StoryWrapper";

const meta = {
  title: "Atomic CRM/Deals/Deal Show",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

export const WithoutAmount = () => (
  <StoryWrapper
    data={{
      companies: [buildCompany()],
      // As the API and the MCP server store a deal created without one.
      deals: [buildDeal({ amount: null, contact_ids: null as never })],
    }}
  >
    <ResourceContextProvider value="deals">
      <DealShow open id="1" />
    </ResourceContextProvider>
  </StoryWrapper>
);

export const ClosingDate = ({
  expectedClosingDate = "2020-01-15",
}: {
  expectedClosingDate?: string | null;
}) => (
  <StoryWrapper
    data={{
      companies: [buildCompany()],
      deals: [buildDeal({ expected_closing_date: expectedClosingDate })],
    }}
  >
    <ResourceContextProvider value="deals">
      <DealShow open id="1" />
    </ResourceContextProvider>
  </StoryWrapper>
);
