"use client"

import { useState } from "react"
import { cn } from "@/frontend/lib/utils"
import { Bullet } from "@/frontend/components/ui/bullet"
import { ProfileSettings } from "./profile-settings"
import { PreferencesSettings } from "./preferences-settings"
import { NotificationSettings } from "./notification-settings"
import { SecuritySettings } from "./security-settings"

type SettingsSection = "profile" | "preferences" | "notifications" | "security"

const sections = [
  { id: "profile" as const, label: "Profile" },
  { id: "preferences" as const, label: "Preferences" },
  { id: "notifications" as const, label: "Notifications" },
  { id: "security" as const, label: "Security" },
]

export function SettingsContent() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile")

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
      {/* Sidebar Navigation */}
      <nav className="lg:w-64 shrink-0">
        <div className="sticky top-32 space-y-1 bg-card ring-2 ring-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4 text-xs uppercase text-muted-foreground">
            <Bullet />
            <span>Settings</span>
          </div>
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "w-full text-left px-4 py-2.5 rounded-md text-sm transition-colors",
                activeSection === section.id
                  ? "bg-primary text-primary-foreground font-medium"
                  : "hover:bg-accent text-foreground",
              )}
            >
              {section.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        {activeSection === "profile" && <ProfileSettings />}
        {activeSection === "preferences" && <PreferencesSettings />}
        {activeSection === "notifications" && <NotificationSettings />}
        {activeSection === "security" && <SecuritySettings />}
      </div>
    </div>
  )
}
