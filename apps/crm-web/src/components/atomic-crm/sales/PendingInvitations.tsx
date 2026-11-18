import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "ra-core";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { api, getSession, orgPath } from "../providers/lumen/client";

type Invitation = { id: string; email: string; role: string; status: string; expiresAt: string };

const QUERY_KEY = ["lumen", "organization-invitations"];

/** People invited to this organization who have not joined yet. They have no
 *  CRM profile until they do, so the list above cannot show them. */
export const PendingInvitations = () => {
  const session = getSession();
  const isDemo = new URLSearchParams(window.location.search).has("demo");
  if (!session?.orgId || isDemo) return null;
  return <PendingInvitationsCard orgId={session.orgId} />;
};

const PendingInvitationsCard = ({ orgId }: { orgId: string }) => {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const queryKey = [...QUERY_KEY, orgId];

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await api<{ invitations: Invitation[] }>("GET", `${orgPath()}/invitations`);
      return (result.invitations ?? []).filter((invitation) => invitation.status === "pending");
    },
    meta: { persist: false },
    refetchOnMount: "always",
  });

  const revoke = useMutation({
    mutationFn: (invitation: Invitation) =>
      api("DELETE", `${orgPath()}/invitations/${encodeURIComponent(invitation.id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });

  if (!data?.length) return null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between gap-4 py-2">
              <span className="min-w-0 text-sm">
                <span className="block truncate font-medium">{invitation.email}</span>
                <span className="text-muted-foreground">
                  {invitation.role}, expires {new Date(invitation.expiresAt).toLocaleDateString()}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={revoke.isPending}
                aria-label={`Revoke invitation for ${invitation.email}`}
                onClick={() => revoke.mutate(invitation)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
