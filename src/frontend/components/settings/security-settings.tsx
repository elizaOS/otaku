"use client"

import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Switch } from "@/frontend/components/ui/switch"
import { useState } from "react"
import LockIcon from "@/frontend/components/icons/lock"

export function SecuritySettings() {
  const [security, setSecuritySettings] = useState({
    twoFactor: true,
    sessionTimeout: true,
  })

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-display mb-2">Security</h2>
        <p className="text-sm text-muted-foreground">Manage your account security settings</p>
      </div>

      {/* Password */}
      <div className="bg-card ring-2 ring-border rounded-lg p-6 space-y-6">
        <div>
          <h3 className="text-lg font-display mb-1">Change Password</h3>
          <p className="text-xs text-muted-foreground">Update your password regularly for better security</p>
        </div>

        <div className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="current" className="text-sm uppercase text-muted-foreground">
              Current Password
            </Label>
            <Input id="current" type="password" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new" className="text-sm uppercase text-muted-foreground">
              New Password
            </Label>
            <Input id="new" type="password" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm" className="text-sm uppercase text-muted-foreground">
              Confirm Password
            </Label>
            <Input id="confirm" type="password" />
          </div>

          <Button className="mt-4">Update Password</Button>
        </div>
      </div>

      {/* Two-Factor Authentication */}
      <div className="bg-card ring-2 ring-border rounded-lg p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-display mb-1 flex items-center gap-2">
              <LockIcon className="size-5" />
              Two-Factor Authentication
            </h3>
            <p className="text-xs text-muted-foreground">Add an extra layer of security to your account</p>
          </div>
          <Switch
            checked={security.twoFactor}
            onCheckedChange={(checked) => setSecuritySettings({ ...security, twoFactor: checked })}
          />
        </div>

        {security.twoFactor && (
          <div className="pt-4 border-t border-border">
            <p className="text-sm mb-4">
              Two-factor authentication is currently <span className="text-success font-medium">enabled</span>
            </p>
            <Button variant="outline" size="sm">
              Manage 2FA Settings
            </Button>
          </div>
        )}
      </div>

      {/* Session Management */}
      <div className="bg-card ring-2 ring-border rounded-lg p-6 space-y-6">
        <div>
          <h3 className="text-lg font-display mb-1">Session Management</h3>
          <p className="text-xs text-muted-foreground">Control your active sessions</p>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="text-sm uppercase text-muted-foreground">Auto Logout</Label>
            <p className="text-xs text-muted-foreground">Automatically log out after 30 minutes of inactivity</p>
          </div>
          <Switch
            checked={security.sessionTimeout}
            onCheckedChange={(checked) => setSecuritySettings({ ...security, sessionTimeout: checked })}
          />
        </div>

        <div className="pt-4 border-t border-border">
          <Button variant="destructive" size="sm">
            Log Out All Devices
          </Button>
        </div>
      </div>
    </div>
  )
}
