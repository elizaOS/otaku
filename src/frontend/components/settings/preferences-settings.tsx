"use client"

import { Label } from "@/frontend/components/ui/label"
import { Switch } from "@/frontend/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { useState } from "react"

export function PreferencesSettings() {
  const [preferences, setPreferences] = useState({
    theme: "dark",
    language: "en",
    timezone: "UTC-3",
    compactMode: false,
    animations: true,
  })

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-display mb-2">Preferences</h2>
        <p className="text-sm text-muted-foreground">Customize your dashboard experience</p>
      </div>

      <div className="bg-card ring-2 ring-border rounded-lg p-6 space-y-6">
        {/* Theme */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="text-sm uppercase text-muted-foreground">Theme</Label>
            <p className="text-xs text-muted-foreground">Choose your interface theme</p>
          </div>
          <Select value={preferences.theme} onValueChange={(value) => setPreferences({ ...preferences, theme: value })}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Language */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="text-sm uppercase text-muted-foreground">Language</Label>
            <p className="text-xs text-muted-foreground">Select your preferred language</p>
          </div>
          <Select
            value={preferences.language}
            onValueChange={(value) => setPreferences({ ...preferences, language: value })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="es">Español</SelectItem>
              <SelectItem value="pt">Português</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Timezone */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="text-sm uppercase text-muted-foreground">Timezone</Label>
            <p className="text-xs text-muted-foreground">Your local timezone</p>
          </div>
          <Select
            value={preferences.timezone}
            onValueChange={(value) => setPreferences({ ...preferences, timezone: value })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UTC-3">UTC-3 (Buenos Aires)</SelectItem>
              <SelectItem value="UTC-5">UTC-5 (New York)</SelectItem>
              <SelectItem value="UTC+0">UTC+0 (London)</SelectItem>
              <SelectItem value="UTC+1">UTC+1 (Paris)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="border-t border-border pt-6 space-y-4">
          {/* Compact Mode */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm uppercase text-muted-foreground">Compact Mode</Label>
              <p className="text-xs text-muted-foreground">Reduce spacing for more content</p>
            </div>
            <Switch
              checked={preferences.compactMode}
              onCheckedChange={(checked) => setPreferences({ ...preferences, compactMode: checked })}
            />
          </div>

          {/* Animations */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm uppercase text-muted-foreground">Animations</Label>
              <p className="text-xs text-muted-foreground">Enable interface animations</p>
            </div>
            <Switch
              checked={preferences.animations}
              onCheckedChange={(checked) => setPreferences({ ...preferences, animations: checked })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
