import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNotify } from "ra-core";
import { Building2, Check, ChevronsUpDown, Mail, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  acceptPendingInvitation,
  createOrganization,
  listOrganizations,
  listPendingInvitations,
  openOrganization,
  type PendingInvitation,
} from "../providers/lumen/authProvider";
import { getSession, type Organization } from "../providers/lumen/client";

/**
 * The organization the CRM is showing, and the way to another one. Absent in
 * the demo, which has no organizations, even for someone who is signed in.
 */
export const OrganizationSwitcher = ({ compact = false }: { compact?: boolean }) => {
  const session = getSession();
  const isDemo = new URLSearchParams(window.location.search).has("demo");
  if (!session?.orgId || isDemo) return null;
  return (
    <Switcher
      currentId={session.orgId}
      currentName={session.orgName ?? "Organization"}
      compact={compact}
    />
  );
};

const Switcher = ({
  currentId,
  currentName,
  compact,
}: {
  currentId: string;
  currentName: string;
  compact: boolean;
}) => {
  const notify = useNotify();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const organizations = useQuery({
    queryKey: ["lumen", "organizations"],
    queryFn: listOrganizations,
    meta: { persist: false },
  });
  const invitations = useQuery({
    queryKey: ["lumen", "pending-invitations"],
    queryFn: listPendingInvitations,
    meta: { persist: false },
    retry: false,
  });
  const pending = invitations.data ?? [];

  const onError = (error: Error) => notify(error.message, { type: "error" });
  const join = useMutation({
    mutationFn: async (invitation: PendingInvitation) => {
      await acceptPendingInvitation(invitation);
      openOrganization(invitation.organization);
    },
    onError,
  });
  const create = useMutation({
    mutationFn: async (organizationName: string) => {
      openOrganization(await createOrganization(organizationName));
    },
    onError,
  });

  const switchTo = (organization: Organization) => {
    if (organization.id !== currentId) openOrganization(organization);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!create.isPending) create.mutate(name.trim());
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size={compact ? "icon" : "sm"}
              className="relative min-w-0 max-w-48 text-secondary-foreground"
              aria-label={`Organization: ${currentName}`}
            />
          }
        >
          {compact ? (
            <Building2 />
          ) : (
            <>
              <span className="truncate">{currentName}</span>
              <ChevronsUpDown className="opacity-60" />
            </>
          )}
          {pending.length > 0 ? (
            <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-primary" />
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {(organizations.data ?? []).map((organization) => (
              <DropdownMenuItem key={organization.id} onClick={() => switchTo(organization)}>
                <span className="truncate">{organization.name}</span>
                {organization.id === currentId ? <Check className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {pending.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Invitations</DropdownMenuLabel>
                {pending.map((invitation) => (
                  <DropdownMenuItem
                    key={invitation.id}
                    disabled={join.isPending}
                    onClick={() => join.mutate(invitation)}
                  >
                    <Mail />
                    <span className="truncate">Join {invitation.organization.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <Plus />
            Create organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form className="space-y-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="new-organization">Organization name</Label>
              <Input
                id="new-organization"
                required
                minLength={2}
                maxLength={80}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
