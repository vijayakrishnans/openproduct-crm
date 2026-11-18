import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Welcome = () => (
  <Card>
    <CardHeader className="px-4">
      <CardTitle>Welcome to BrokeCRM</CardTitle>
    </CardHeader>
    <CardContent className="px-4">
      <p className="text-sm mb-4">
        BrokeCRM is an open-source, multi-tenant CRM that runs at the
        edge on Cloudflare Workers.
      </p>
      <p className="text-sm mb-4">
        This demo runs in your browser on generated, fake data. You can explore
        and change anything; it resets on reload.
      </p>
      <p className="text-sm">
        It is based on{" "}
        <a
          href="https://github.com/marmelab/atomic-crm"
          className="underline hover:no-underline"
        >
          Atomic CRM
        </a>{" "}
        (MIT) and built with{" "}
        <a
          href="https://marmelab.com/shadcn-admin-kit"
          className="underline hover:no-underline"
        >
          shadcn-admin-kit
        </a>
        . The code is at{" "}
        <a
          href="https://github.com/vijayakrishnans/openproduct-crm"
          className="underline hover:no-underline"
        >
          vijayakrishnans/openproduct-crm
        </a>
        .
      </p>
    </CardContent>
  </Card>
);
