import { redirect } from "next/navigation";

export default async function ContactsRedirect({
  params,
}: {
  params: Promise<{ emailAccountId: string }>;
}) {
  const { emailAccountId } = await params;
  redirect(`/${emailAccountId}/contacts?accountScope=all`);
}
