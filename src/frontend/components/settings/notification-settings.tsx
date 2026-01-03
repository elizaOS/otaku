"use client"

import { Label } from "@/frontend/components/ui/label"
import { Switch } from "@/frontend/components/ui/switch"
import { useState } from "react"

export function NotificationSettings() {
  const [notifications, setNotifications] = useState({
    email: {
      security: true,
      updates: true,
      marketing: false,
    },
    push: {
      security: true,
      updates: false,
      chat: true,
    },
  })

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-display mb-2">Notifications</h2>
        <p className="text-sm text-muted-foreground">Manage how you receive notifications</p>
      </div>

      {/* Email Notifications */}
      <div className="bg-card ring-2 ring-border rounded-lg p-6 space-y-6">
        <div>
          <h3 className="text-lg font-display mb-1">Email Notifications</h3>
          <p className="text-xs text-muted-foreground">Receive notifications via email</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm uppercase text-muted-foreground">Security Alerts</Label>
              <p className="text-xs text-muted-foreground">Critical security updates and alerts</p>
            </div>
            <Switch
              checked={notifications.email.security}
              onCheckedChange={(checked) =>
                setNotifications({
                  ...notifications,
                  email: { ...notifications.email, security: checked },
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm uppercase text-muted-foreground">System Updates</Label>
              <p className="text-xs text-muted-foreground">New features and system updates</p>
            </div>
            <Switch
              checked={notifications.email.updates}
              onCheckedChange={(checked) =>
                setNotifications({
                  ...notifications,
                  email: { ...notifications.email, updates: checked },
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm uppercase text-muted-foreground">Marketing</Label>
              <p className="text-xs text-muted-foreground">Tips, offers, and product news</p>
            </div>
            <Switch
              checked={notifications.email.marketing}
              onCheckedChange={(checked) =>
                setNotifications({
                  ...notifications,
                  email: { ...notifications.email, marketing: checked },
                })
              }
            />
          </div>
        </div>
      </div>

      {/* Push Notifications */}
      <div className="bg-card ring-2 ring-border rounded-lg p-6 space-y-6">
        <div>
          <h3 className="text-lg font-display mb-1">Push Notifications</h3>
          <p className="text-xs text-muted-foreground">Receive notifications in your browser</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm uppercase text-muted-foreground">Security Alerts</Label>
              <p className="text-xs text-muted-foreground">Immediate security notifications</p>
            </div>
            <Switch
              checked={notifications.push.security}
              onCheckedChange={(checked) =>
                setNotifications({
                  ...notifications,
                  push: { ...notifications.push, security: checked },
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm uppercase text-muted-foreground">System Updates</Label>
              <p className="text-xs text-muted-foreground">Updates about system changes</p>
            </div>
            <Switch
              checked={notifications.push.updates}
              onCheckedChange={(checked) =>
                setNotifications({
                  ...notifications,
                  push: { ...notifications.push, updates: checked },
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-sm uppercase text-muted-foreground">Chat Messages</Label>
              <p className="text-xs text-muted-foreground">New messages in chat</p>
            </div>
            <Switch
              checked={notifications.push.chat}
              onCheckedChange={(checked) =>
                setNotifications({
                  ...notifications,
                  push: { ...notifications.push, chat: checked },
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
