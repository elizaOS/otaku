"use client"

import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
// Image component removed - using img tag instead
import { useState } from "react"

export function ProfileSettings() {
  const [formData, setFormData] = useState({
    name: "KRIMSON",
    email: "krimson@joyco.studio",
    handle: "@KRIMSON",
    bio: "Rebel developer building the future of the web.",
  })

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-display mb-2">Profile Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your public profile information</p>
      </div>

      <div className="bg-card ring-2 ring-border rounded-lg p-6 space-y-6">
        {/* Avatar Section */}
        <div className="space-y-4">
          <Label className="text-sm uppercase text-muted-foreground">Avatar</Label>
          <div className="flex items-center gap-6">
            <div className="size-24 rounded-lg overflow-clip bg-primary flex items-center justify-center">
              <img src="/avatars/user_krimson.png" alt="Profile" width={96} height={96} className="object-cover" />
            </div>
            <div className="space-y-2">
              <Button variant="outline" size="sm">
                Change Avatar
              </Button>
              <p className="text-xs text-muted-foreground">JPG, PNG or GIF. Max size 2MB.</p>
            </div>
          </div>
        </div>

        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm uppercase text-muted-foreground">
            Display Name
          </Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="max-w-md"
          />
        </div>

        {/* Handle */}
        <div className="space-y-2">
          <Label htmlFor="handle" className="text-sm uppercase text-muted-foreground">
            Handle
          </Label>
          <Input
            id="handle"
            value={formData.handle}
            onChange={(e) => setFormData({ ...formData, handle: e.target.value })}
            className="max-w-md"
          />
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm uppercase text-muted-foreground">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="max-w-md"
          />
        </div>

        {/* Bio */}
        <div className="space-y-2">
          <Label htmlFor="bio" className="text-sm uppercase text-muted-foreground">
            Bio
          </Label>
          <Textarea
            id="bio"
            value={formData.bio}
            onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
            className="max-w-md resize-none"
            rows={4}
          />
          <p className="text-xs text-muted-foreground">Brief description for your profile.</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <Button>Save Changes</Button>
          <Button variant="outline">Cancel</Button>
        </div>
      </div>
    </div>
  )
}
