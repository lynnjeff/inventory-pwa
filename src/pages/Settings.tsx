import { Header } from '../components/Header'
import { LegacySettingsCard } from '../components/LegacyRescue'

export default function Settings() {
  return (
    <div className="min-h-screen">
      <Header title="Settings" back />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-24">
        <LegacySettingsCard />
      </main>
    </div>
  )
}
