import { PageHeader } from "@/components/page-header"
import { AccountForm } from "@/app/dashboard/account/account-form"
import { requireUser } from "@/lib/auth"

export const metadata = { title: "Account" }

export default async function AccountPage() {
  const user = await requireUser()
  return <><PageHeader title="Account" description="Manage your dashboard administrator credentials." /><AccountForm email={user.email} /></>
}
