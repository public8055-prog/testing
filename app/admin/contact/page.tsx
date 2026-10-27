import { isAdminRole } from "@/lib/roles";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listContacts } from "@/lib/contact";
import { WorkspaceShell, PageHeading } from "@/components/platform/shell";
import { ContactInbox } from "@/components/platform/contact-inbox";
export default async function ContactAdmin() {
  const user = await getCurrentUser(); if (!user || !isAdminRole(user.role)) notFound();
  return <WorkspaceShell admin name={user.name}><PageHeading eyebrow="Customer contact" title="Public support requests" description="Review service, privacy and refund queries submitted through the contact form."/><ContactInbox initial={await listContacts(1)}/></WorkspaceShell>;
}
